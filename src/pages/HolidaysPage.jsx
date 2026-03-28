import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import { EMPLOYEES } from "../constants/employees.js";
import { useSchedule } from "../state/scheduleStore.js";
import { eachDayOfMonth, toISODate } from "../utils/date.js";
import { deleteHistoryMonth, saveHistoryCsv } from "../utils/historyDb.js";

function formatMonthInput({ year, monthIndex }) {
  const mm = String(monthIndex + 1).padStart(2, "0");
  return `${year}-${mm}`;
}

function sortIsoDates(set) {
  return Array.from(set).sort();
}

function dayName(isoDate) {
  return new Date(isoDate).toLocaleDateString(undefined, { weekday: "short" });
}

function MonthGrid({ month, selectedSet, onToggle, ariaLabel }) {
  const gridDays = useMemo(() => {
    const monthDays = eachDayOfMonth(month.year, month.monthIndex);
    const firstDow = new Date(month.year, month.monthIndex, 1).getDay(); // 0=Sun
    const days = [];
    for (let i = 0; i < firstDow; i += 1) days.push(null);
    for (const d of monthDays) days.push(toISODate(d));
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [month.year, month.monthIndex]);

  return (
    <div className="miniCal" role="grid" aria-label={ariaLabel}>
      <div className="miniCalHeader" role="row">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="miniCalDow" role="columnheader">
            {d}
          </div>
        ))}
      </div>

      <div className="miniCalGrid">
        {gridDays.map((iso, idx) => {
          if (!iso) return <div key={`blank-${idx}`} className="miniDay blank" role="gridcell" />;
          const dayNum = Number(iso.slice(8));
          const selected = selectedSet?.has(iso);
          const cls = ["miniDay", selected ? "selected" : null].filter(Boolean).join(" ");
          return (
            <button
              key={iso}
              type="button"
              className={cls}
              onClick={() => onToggle(iso)}
              title={`${iso} (${dayName(iso)})`}
              aria-pressed={selected}
            >
              {dayNum}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function HolidaysPage() {
  const nav = useNavigate();
  const {
    month,
    setMonthFromInput,
    nationalHolidays,
    addNationalHoliday,
    removeNationalHoliday,
    leavesByEmployeeId,
    addEmployeeLeave,
    removeEmployeeLeave,
    generate,
    generated,
    history,
    historyStatus,
    historyLibraryMonths,
    refreshHistory,
  } = useSchedule();

  const [historyMonthInput, setHistoryMonthInput] = useState("");
  const [historyFile, setHistoryFile] = useState(null);
  const [historyMsg, setHistoryMsg] = useState(null);
  const [holidaysCalOpen, setHolidaysCalOpen] = useState(false);
  const [leavesCalOpenByEmployeeId, setLeavesCalOpenByEmployeeId] = useState({});

  const holidaysSorted = useMemo(() => sortIsoDates(nationalHolidays), [nationalHolidays]);

  useEffect(() => {
    setHolidaysCalOpen(false);
    setLeavesCalOpenByEmployeeId({});
  }, [month.year, month.monthIndex]);

  function isValidMonthKey(value) {
    return /^\d{4}-\d{2}$/.test(String(value ?? ""));
  }

  return (
    <Layout
      title="1) Select holidays"
      subtitle="Add national holidays and employee leaves for the selected month."
    >
      <section className="panel">
        <div className="row">
          <label className="label">
            Month
            <input
              className="input"
              type="month"
              value={formatMonthInput(month)}
              onChange={(e) => setMonthFromInput(e.target.value)}
            />
          </label>

          <div className="muted" style={{ alignSelf: "end" }}>
            History: {historyStatus.loading ? "loading…" : `${historyLibraryMonths.length} uploaded`}
          </div>

          <div className="actions">
            <button
              className="btn primary"
              onClick={async () => {
                const result = await generate();
                if (result.scheduleByDate) nav("/schedule");
              }}
            >
              Generate Schedule
            </button>
          </div>
        </div>

        <div className="split">
          <div>
            <h2 className="h">National holidays</h2>
            <details
              className="dropdown"
              open={holidaysCalOpen}
              onToggle={(e) => setHolidaysCalOpen(Boolean(e.currentTarget.open))}
            >
              <summary className="dropdownSummary">
                {holidaysCalOpen ? "Hide calendar" : "Show calendar"}
              </summary>
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={nationalHolidays.size === 0}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const all = Array.from(nationalHolidays);
                    for (const iso of all) removeNationalHoliday(iso);
                  }}
                  title="Clear all selected holiday dates"
                >
                  Clear
                </button>
              </div>
              <MonthGrid
                month={month}
                selectedSet={nationalHolidays}
                ariaLabel="National holidays calendar"
                onToggle={(iso) => {
                  if (nationalHolidays.has(iso)) removeNationalHoliday(iso);
                  else addNationalHoliday(iso);
                }}
              />
            </details>

            {holidaysSorted.length === 0 ? (
              <p className="muted">No national holidays selected yet.</p>
            ) : (
              <ul className="list">
                {holidaysSorted.map((iso) => (
                  <li key={iso} className="listItem">
                    <span>{iso}</span>
                    <button className="link" onClick={() => removeNationalHoliday(iso)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h2 className="h">Employee leaves</h2>
            <p className="muted">
              Add leave dates per employee. (Weekly offs are already fixed on Saturday/Sunday.)
            </p>

            <div className="leaveGrid">
              {EMPLOYEES.map((e) => {
                const leaves = leavesByEmployeeId[e.id] ?? new Set();
                const sorted = sortIsoDates(leaves);

                return (
                  <div key={e.id} className="leaveCard">
                    <div className="leaveTop">
                      <div>
                        <div className="who">{e.id}</div>
                        <div className="role">{e.role}</div>
                      </div>
                      <div className="tag">Weekly off: {e.weeklyOff}</div>
                    </div>

                    <details
                      className="dropdown"
                      open={Boolean(leavesCalOpenByEmployeeId[e.id])}
                      onToggle={(ev) => {
                        const open = Boolean(ev.currentTarget.open);
                        setLeavesCalOpenByEmployeeId((prev) => ({ ...prev, [e.id]: open }));
                      }}
                    >
                      <summary className="dropdownSummary">
                        {leavesCalOpenByEmployeeId[e.id] ? "Hide calendar" : "Show calendar"}
                      </summary>
                      <div className="row" style={{ marginTop: 10 }}>
                        <button
                          type="button"
                          className="btn"
                          disabled={leaves.size === 0}
                          onClick={(ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            const all = Array.from(leaves);
                            for (const iso of all) removeEmployeeLeave(e.id, iso);
                          }}
                          title="Clear all selected leave dates"
                        >
                          Clear
                        </button>
                      </div>
                      <MonthGrid
                        month={month}
                        selectedSet={leaves}
                        ariaLabel={`${e.id} leave calendar`}
                        onToggle={(iso) => {
                          if (leaves.has(iso)) removeEmployeeLeave(e.id, iso);
                          else addEmployeeLeave(e.id, iso);
                        }}
                      />
                    </details>

                    {sorted.length === 0 ? (
                      <p className="muted">No leave dates.</p>
                    ) : (
                      <ul className="list">
                        {sorted.map((iso) => (
                          <li key={iso} className="listItem">
                            <span>{iso}</span>
                            <button
                              className="link"
                              onClick={() => removeEmployeeLeave(e.id, iso)}
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h2 className="h">History uploads</h2>
            <p className="muted">
              Upload prior month CSVs to balance future schedules. Files are stored in this browser
              (survive refresh).
            </p>

            <div className="row">
              <label className="label">
                Month
                <input
                  className="input"
                  type="month"
                  value={historyMonthInput}
                  onChange={(e) => setHistoryMonthInput(e.target.value)}
                />
              </label>

              <label className="label">
                CSV
                <input
                  className="input"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => setHistoryFile(e.target.files?.[0] ?? null)}
                />
              </label>

              <div className="actions" style={{ alignSelf: "end" }}>
                <button
                  className="btn"
                  onClick={async () => {
                    setHistoryMsg(null);
                    const mk = String(historyMonthInput ?? "");
                    if (!isValidMonthKey(mk)) {
                      setHistoryMsg("Pick a valid month for this CSV.");
                      return;
                    }
                    if (!historyFile) {
                      setHistoryMsg("Pick a CSV file to upload.");
                      return;
                    }

                    try {
                      const csvText = await historyFile.text();
                      await saveHistoryCsv({ monthKey: mk, csvText });
                      await refreshHistory();
                      setHistoryMsg(`Saved ${mk}. You can view it below.`);
                      setHistoryFile(null);
                    } catch (err) {
                      setHistoryMsg(String(err?.message ?? err));
                    }
                  }}
                >
                  Upload
                </button>
              </div>
            </div>

            {historyMsg ? (
              <div className="alert" style={{ marginTop: 12 }}>
                <div className="muted" style={{ marginTop: 0 }}>
                  {historyMsg}
                </div>
              </div>
            ) : null}

            {historyLibraryMonths.length === 0 ? (
              <p className="muted">No history months uploaded.</p>
            ) : (
              <ul className="list">
                {historyLibraryMonths.map((mk) => (
                  <li key={mk} className="listItem">
                    <span>{mk}</span>
                    <div className="actions">
                      <button className="btn" onClick={() => nav(`/schedule?history=${mk}`)}>
                        View
                      </button>
                      <button
                        className="btn danger"
                        onClick={async () => {
                          await deleteHistoryMonth(mk);
                          await refreshHistory();
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <p className="muted" style={{ marginTop: 10 }}>
              For balancing this month, the scheduler uses up to 6 uploaded months before the
              selected month.
              {(history?.monthsUsed?.length ?? 0) > 0
                ? ` Used: ${history.monthsUsed.join(", ")}.`
                : " No eligible uploaded months found."}
            </p>
          </div>
        </div>

        {(generated.errors?.length ?? 0) > 0 ? (
          <div className="alert danger">
            <strong>Blocking issues</strong>
            <ul>
              {generated.errors.slice(0, 6).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            {generated.errors.length > 6 ? (
              <div className="muted">And {generated.errors.length - 6} more…</div>
            ) : null}
          </div>
        ) : null}
      </section>
    </Layout>
  );
}
