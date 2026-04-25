import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import { EMPLOYEES } from "../constants/employees.js";
import { useSchedule } from "../state/scheduleStore.js";
import {
  compareMonth,
  eachDayOfMonth,
  formatMonthLabel,
  monthKeyOf,
  toISODate,
} from "../utils/date.js";
import { deleteHistoryMonth, saveHistoryCsv } from "../utils/historyDb.js";
import { parseHistoryZip } from "../utils/zipBundle.js";

function sortIsoDates(set) {
  return Array.from(set).sort();
}

function dayName(isoDate) {
  return new Date(isoDate).toLocaleDateString(undefined, { weekday: "short" });
}

function MonthGrid({ month, selectedSet, onToggle, ariaLabel }) {
  const gridDays = useMemo(() => {
    const monthDays = eachDayOfMonth(month.year, month.monthIndex);
    const firstDow = new Date(month.year, month.monthIndex, 1).getDay();
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

function MonthNavigator({ rangeMonths, activeMonth, onSelect, onStep }) {
  if (!rangeMonths.length) return null;
  const idx = rangeMonths.findIndex((m) => compareMonth(m, activeMonth) === 0);
  const safeIdx = idx >= 0 ? idx : 0;
  const canPrev = safeIdx > 0;
  const canNext = safeIdx < rangeMonths.length - 1;

  return (
    <div className="row" style={{ alignItems: "center", gap: 8 }}>
      <button type="button" className="btn" disabled={!canPrev} onClick={() => onStep(-1)}>
        ‹
      </button>
      <label className="label" style={{ marginBottom: 0 }}>
        Viewing
        <select
          className="input"
          value={monthKeyOf(activeMonth)}
          onChange={(e) => onSelect(e.target.value)}
        >
          {rangeMonths.map((m) => (
            <option key={monthKeyOf(m)} value={monthKeyOf(m)}>
              {formatMonthLabel(m)}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn" disabled={!canNext} onClick={() => onStep(1)}>
        ›
      </button>
    </div>
  );
}

export default function HolidaysPage() {
  const nav = useNavigate();
  const {
    range,
    rangeError,
    rangeMonths,
    setRangeFromInputs,
    activeMonth,
    setActiveMonthFromInput,
    stepActiveMonth,
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

  const [startInput, setStartInput] = useState(monthKeyOf(range.start));
  const [endInput, setEndInput] = useState(monthKeyOf(range.end));
  const [historyMonthInput, setHistoryMonthInput] = useState("");
  const [historyFile, setHistoryFile] = useState(null);
  const [historyMsg, setHistoryMsg] = useState(null);
  const [holidaysCalOpen, setHolidaysCalOpen] = useState(false);
  const [leavesCalOpenByEmployeeId, setLeavesCalOpenByEmployeeId] = useState({});

  const activeMonthKey = monthKeyOf(activeMonth);

  const allHolidaysSorted = useMemo(
    () => sortIsoDates(nationalHolidays),
    [nationalHolidays]
  );

  const holidaysInActiveMonth = useMemo(
    () => allHolidaysSorted.filter((iso) => iso.startsWith(activeMonthKey)),
    [allHolidaysSorted, activeMonthKey]
  );

  const totalHolidaysInRange = nationalHolidays.size;

  useEffect(() => {
    setHolidaysCalOpen(false);
    setLeavesCalOpenByEmployeeId({});
  }, [activeMonth.year, activeMonth.monthIndex]);

  useEffect(() => {
    setStartInput(monthKeyOf(range.start));
    setEndInput(monthKeyOf(range.end));
  }, [range.start.year, range.start.monthIndex, range.end.year, range.end.monthIndex]);

  function applyRangeInputs(nextStart, nextEnd) {
    setRangeFromInputs(nextStart, nextEnd);
  }

  function isValidMonthKey(value) {
    return /^\d{4}-\d{2}$/.test(String(value ?? ""));
  }

  return (
    <Layout>
      <section className="panel">
        <div className="row">
          <label className="label">
            Start month
            <input
              className="input"
              type="month"
              value={startInput}
              onChange={(e) => {
                setStartInput(e.target.value);
                applyRangeInputs(e.target.value, endInput);
              }}
            />
          </label>
          <label className="label">
            End month
            <input
              className="input"
              type="month"
              value={endInput}
              onChange={(e) => {
                setEndInput(e.target.value);
                applyRangeInputs(startInput, e.target.value);
              }}
            />
          </label>

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

        {rangeError ? (
          <div className="alert danger" style={{ marginTop: 10 }}>
            {rangeError}
          </div>
        ) : null}

        <p className="muted" style={{ marginTop: 4 }}>
          Range: {formatMonthLabel(range.start)} to {formatMonthLabel(range.end)} ({rangeMonths.length} month
          {rangeMonths.length === 1 ? "" : "s"}). Holidays across all months: {totalHolidaysInRange}.
        </p>

        <div style={{ marginTop: 10 }}>
          <MonthNavigator
            rangeMonths={rangeMonths}
            activeMonth={activeMonth}
            onSelect={setActiveMonthFromInput}
            onStep={stepActiveMonth}
          />
        </div>

        <div className="split" style={{ marginTop: 10 }}>
          <div>
            <h2 className="h">National holidays</h2>
            <p className="muted" style={{ marginTop: 4 }}>
              Picking dates in {formatMonthLabel(activeMonth)}. Selected dates from every month in the
              range are listed below.
            </p>
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
                  disabled={holidaysInActiveMonth.length === 0}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    for (const iso of holidaysInActiveMonth) removeNationalHoliday(iso);
                  }}
                  title="Clear holidays selected in this month"
                >
                  Clear this month
                </button>
              </div>
              <MonthGrid
                month={activeMonth}
                selectedSet={nationalHolidays}
                ariaLabel="National holidays calendar"
                onToggle={(iso) => {
                  if (nationalHolidays.has(iso)) removeNationalHoliday(iso);
                  else addNationalHoliday(iso);
                }}
              />
            </details>

            {allHolidaysSorted.length === 0 ? (
              <p className="muted">No national holidays selected in this range.</p>
            ) : (
              <ul className="list">
                {allHolidaysSorted.map((iso) => (
                  <li key={iso} className="listItem">
                    <span>
                      {iso} <span className="muted">({dayName(iso)})</span>
                    </span>
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
              Picking leave dates in {formatMonthLabel(activeMonth)}. Switch months above to mark leaves
              in another month — every selected date across the range is listed below each employee.
              Weekly offs are already fixed on Saturday/Sunday.
            </p>

            <div className="leaveGrid">
              {EMPLOYEES.map((e) => {
                const leaves = leavesByEmployeeId[e.id] ?? new Set();
                const allLeavesSorted = sortIsoDates(leaves);
                const leavesInActiveMonth = allLeavesSorted.filter((iso) =>
                  iso.startsWith(activeMonthKey)
                );

                return (
                  <div key={e.id} className="leaveCard">
                    <div className="leaveTop">
                      <div>
                        <div className="who">{e.id}</div>
                        <div className="role">{e.role}</div>
                      </div>
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
                          disabled={leavesInActiveMonth.length === 0}
                          onClick={(ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            for (const iso of leavesInActiveMonth) removeEmployeeLeave(e.id, iso);
                          }}
                          title="Clear leaves in this month"
                        >
                          Clear this month
                        </button>
                      </div>
                      <MonthGrid
                        month={activeMonth}
                        selectedSet={leaves}
                        ariaLabel={`${e.id} leave calendar`}
                        onToggle={(iso) => {
                          if (leaves.has(iso)) removeEmployeeLeave(e.id, iso);
                          else addEmployeeLeave(e.id, iso);
                        }}
                      />
                    </details>

                    {allLeavesSorted.length === 0 ? (
                      <p className="muted">No leave dates in this range.</p>
                    ) : (
                      <ul className="list">
                        {allLeavesSorted.map((iso) => (
                          <li key={iso} className="listItem">
                            <span>
                              {iso} <span className="muted">({dayName(iso)})</span>
                            </span>
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
            <p className="muted" style={{ marginTop: 6 }}>
              History: {historyStatus.loading ? "loading…" : `${historyLibraryMonths.length} uploaded`}
            </p>
            <p className="muted">
              Upload prior month CSVs (or a .zip bundle exported from this app) to balance future
              schedules. Files are stored in this browser and survive refresh.
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
                <span className="muted" style={{ fontSize: 12 }}>
                  Required for single-CSV uploads. Ignored for .zip bundles.
                </span>
              </label>

              <label className="label">
                File
                <input
                  className="input"
                  type="file"
                  accept=".csv,.zip,text/csv,application/zip"
                  onChange={(e) => setHistoryFile(e.target.files?.[0] ?? null)}
                />
              </label>

              <div className="actions" style={{ alignSelf: "end" }}>
                <button
                  className="btn"
                  onClick={async () => {
                    setHistoryMsg(null);
                    if (!historyFile) {
                      setHistoryMsg("Pick a CSV or ZIP file to upload.");
                      return;
                    }

                    const name = String(historyFile.name ?? "").toLowerCase();
                    try {
                      if (name.endsWith(".zip")) {
                        const { imported, skipped } = await parseHistoryZip(historyFile);
                        if (imported.length === 0) {
                          setHistoryMsg(
                            "The zip did not contain any CSV files named with a year-month (e.g. shift-schedule_2025-10.csv). Please check the bundle."
                          );
                          return;
                        }
                        for (const entry of imported) {
                          await saveHistoryCsv({ monthKey: entry.monthKey, csvText: entry.csvText });
                        }
                        await refreshHistory();
                        const monthsList = imported.map((x) => x.monthKey).sort().join(", ");
                        const skippedNote =
                          skipped && skipped.length > 0
                            ? ` Skipped ${skipped.length} file(s) without a recognizable year-month in the name.`
                            : "";
                        setHistoryMsg(`Imported ${imported.length} month(s) from bundle: ${monthsList}.${skippedNote}`);
                        setHistoryFile(null);
                        return;
                      }

                      const mk = String(historyMonthInput ?? "");
                      if (!isValidMonthKey(mk)) {
                        setHistoryMsg("Pick a valid month for this CSV (single-CSV uploads require a month).");
                        return;
                      }

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
              For balancing, the scheduler uses up to 6 uploaded months before the start of the selected
              range.
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
