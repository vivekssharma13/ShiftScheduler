import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import Modal from "../components/Modal.jsx";
import { EMPLOYEES } from "../constants/employees.js";
import { SHIFT, SHIFT_LABEL, SHIFT_ORDER, TARGET_STAFFING } from "../constants/shifts.js";
import { eachDayOfMonth, toISODate } from "../utils/date.js";
import { useSchedule } from "../state/scheduleStore.js";
import { getHistoryCsv } from "../utils/historyDb.js";
import { parseScheduleCsvToScheduleByDate } from "../utils/history.js";

function monthTitle({ year, monthIndex }) {
  return new Date(year, monthIndex, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function dayName(isoDate) {
  return new Date(isoDate).toLocaleDateString(undefined, { weekday: "short" });
}

function ordinal(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  const mod100 = num % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${num}th`;
  const mod10 = num % 10;
  if (mod10 === 1) return `${num}st`;
  if (mod10 === 2) return `${num}nd`;
  if (mod10 === 3) return `${num}rd`;
  return `${num}th`;
}

export default function SchedulePage() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const historyMonthKey = searchParams.get("history");

  const { month, generated, generate, updateAssignment } = useSchedule();
  const [selectedDate, setSelectedDate] = useState(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [drillOpen, setDrillOpen] = useState(false);
  const [drill, setDrill] = useState({ employeeId: null, kind: null });

  const [tapMove, setTapMove] = useState(null);

  const [historySchedule, setHistorySchedule] = useState(null);
  const [historyError, setHistoryError] = useState(null);

  const readOnly = Boolean(historyMonthKey);

  useEffect(() => {
    if (readOnly) return;
    if (!generated?.scheduleByDate) nav("/holidays", { replace: true });
  }, [readOnly, generated?.scheduleByDate, nav]);

  function beginTapMove(payload) {
    if (readOnly) return;
    setTapMove(payload);
  }

  function clearTapMove() {
    setTapMove(null);
  }

  function applyMoveTo({ toIsoDate, toShift }) {
    if (!tapMove) return;
    updateAssignment({
      fromIsoDate: tapMove.isoDate,
      toIsoDate,
      fromShift: tapMove.fromShift,
      toShift,
      employeeId: tapMove.employeeId,
    });
    clearTapMove();
  }

  const activeMonth = useMemo(() => {
    if (!historyMonthKey) return month;
    const m = String(historyMonthKey).match(/^(\d{4})-(\d{2})$/);
    if (!m) return month;
    return { year: Number(m[1]), monthIndex: Number(m[2]) - 1 };
  }, [historyMonthKey, month]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!historyMonthKey) {
        setHistorySchedule(null);
        setHistoryError(null);
        return;
      }

      setHistoryError(null);
      try {
        const row = await getHistoryCsv(historyMonthKey);
        if (cancelled) return;
        if (!row?.csvText) {
          setHistorySchedule(null);
          setHistoryError(`No uploaded CSV found for ${historyMonthKey}.`);
          return;
        }
        const scheduleByDate = parseScheduleCsvToScheduleByDate({
          csvText: row.csvText,
          monthKey: historyMonthKey,
        });
        setHistorySchedule(scheduleByDate);
      } catch (e) {
        if (cancelled) return;
        setHistorySchedule(null);
        setHistoryError(String(e?.message ?? e));
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [historyMonthKey]);

  const schedule = readOnly ? historySchedule : generated?.scheduleByDate;

  function dayStatus(day) {
    if (!day) return null;
    const assignments = day.assignments ?? {};

    const hasEmptyShift = SHIFT_ORDER.some((shift) => (assignments[shift] ?? []).length === 0);
    if (hasEmptyShift) return "danger";

    const belowTarget = SHIFT_ORDER.some((shift) => {
      const target = TARGET_STAFFING?.[shift];
      if (typeof target !== "number") return false;
      return (assignments[shift] ?? []).length < target;
    });
    if (belowTarget) return "warn";

    return null;
  }

  function Chip({ employeeId, fromShift, isoDate }) {
    const active = tapMove?.employeeId === employeeId && tapMove?.fromShift === fromShift && tapMove?.isoDate === isoDate;
    return (
      <div
        className={active ? "chip active" : "chip"}
        draggable={!readOnly}
        onClick={
          readOnly
            ? undefined
            : (e) => {
                e.stopPropagation();
                beginTapMove({ employeeId, fromShift, isoDate });
              }
        }
        onDragStart={
          readOnly
            ? undefined
            : (e) => {
                e.dataTransfer.setData(
                  "application/json",
                  JSON.stringify({ employeeId, fromShift, isoDate })
                );
                e.dataTransfer.effectAllowed = "move";
              }
        }
        title={readOnly ? undefined : "Tap to select, then tap destination (or drag)"}
      >
        {employeeId}
      </div>
    );
  }

  const gridDays = useMemo(() => {
    const monthDays = eachDayOfMonth(activeMonth.year, activeMonth.monthIndex);
    const firstDow = new Date(activeMonth.year, activeMonth.monthIndex, 1).getDay(); // 0=Sun
    const days = [];

    for (let i = 0; i < firstDow; i += 1) days.push(null);
    for (const d of monthDays) days.push(toISODate(d));
    while (days.length % 7 !== 0) days.push(null);

    return days;
  }, [activeMonth.year, activeMonth.monthIndex]);

  const selected = selectedDate && schedule ? schedule[selectedDate] : null;

  const allWarnings = generated?.warnings ?? [];
  const compOffWarnings = useMemo(
    () =>
      allWarnings.filter(
        (m) =>
          m.includes("Could not assign a comp-off") ||
          m.includes("worked on a national holiday, but no comp-off day was available")
      ),
    [allWarnings]
  );
  const otherWarnings = useMemo(
    () =>
      allWarnings.filter(
        (m) =>
          !(
            m.includes("Could not assign a comp-off") ||
            m.includes("worked on a national holiday, but no comp-off day was available")
          )
      ),
    [allWarnings]
  );

  const errorCount = generated?.errors?.length ?? 0;
  const warningCount = allWarnings.length;

  const peopleStats = useMemo(() => {
    if (!schedule) return null;

    const statsById = {};
    for (const e of EMPLOYEES) {
      statsById[e.id] = {
        id: e.id,
        name: e.name,
        role: e.role,
        A: 0,
        B: 0,
        C: 0,
        compOffs: 0,
      };
    }

    for (const day of Object.values(schedule)) {
      for (const shift of SHIFT_ORDER) {
        for (const id of day.assignments?.[shift] ?? []) {
          if (!statsById[id]) {
            statsById[id] = {
              id,
              name: id,
              role: "—",
              A: 0,
              B: 0,
              C: 0,
              compOffs: 0,
            };
          }
          statsById[id][shift] += 1;
        }
      }

      for (const id of day.compOffEmployeeIds ?? []) {
        if (!statsById[id]) {
          statsById[id] = {
            id,
            name: id,
            role: "—",
            A: 0,
            B: 0,
            C: 0,
            compOffs: 0,
          };
        }
        statsById[id].compOffs += 1;
      }
    }

    return EMPLOYEES.map((e) => statsById[e.id]);
  }, [schedule]);

  const drillDates = useMemo(() => {
    if (!schedule) return [];
    if (!drill.employeeId || !drill.kind) return [];

    const employeeId = drill.employeeId;
    const kind = drill.kind;

    const out = [];
    const days = Object.values(schedule).sort((a, b) => a.isoDate.localeCompare(b.isoDate));
    for (const day of days) {
      if (kind === "COMPOFF") {
        if ((day.compOffEmployeeIds ?? []).includes(employeeId)) out.push(day.isoDate);
        continue;
      }

      if ((day.assignments?.[kind] ?? []).includes(employeeId)) out.push(day.isoDate);
    }

    return out;
  }, [schedule, drill.employeeId, drill.kind]);

  function openDrill(employeeId, kind) {
    setDrill({ employeeId, kind });
    setDrillOpen(true);
  }

  return (
    <Layout
      title="Review & edit schedule"
      subtitle={
        readOnly
          ? `Viewing uploaded history: ${historyMonthKey}`
          : "Drag employee chips between shifts/days. Warnings update automatically."
      }
    >
      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="h">{monthTitle(activeMonth)}</div>
            <p className="muted" style={{ marginTop: 6 }}>
              Shifts: A (7–3), B (3–11), C (11–7). Week starts on Sunday.
            </p>
          </div>
          <div className="actions">
            {readOnly ? (
              <button className="btn" onClick={() => nav("/holidays")}>
                Back
              </button>
            ) : null}
            <button className="btn" onClick={() => setRulesOpen(true)}>
              Rules
            </button>
            <button className="btn" onClick={() => setPeopleOpen(true)} disabled={!schedule}>
              People
            </button>
            <button
              className={errorCount > 0 ? "btn danger" : "btn"}
              onClick={() => setIssuesOpen(true)}
              title="View errors and warnings"
            >
              Issues {errorCount}/{warningCount}
            </button>
            {!readOnly ? (
              <>
                <button className="btn" onClick={async () => generate()}>
                  Re-generate
                </button>
                <button
                  className="btn primary"
                  onClick={() => nav("/export")}
                  disabled={!generated.scheduleByDate}
                >
                  Next
                </button>
              </>
            ) : null}
          </div>
        </div>

        {readOnly && historyError ? (
          <div className="alert danger">
            <strong>History view error</strong>
            <div className="muted">{historyError}</div>
          </div>
        ) : null}

        {!readOnly && compOffWarnings.length > 0 ? (
          <div className="alert" style={{ marginTop: 12 }}>
            <strong>Could not assign comp-off ({compOffWarnings.length})</strong>
            <ul className="modalIssues" style={{ marginBottom: 0 }}>
              {compOffWarnings.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {!schedule ? (
          <div className="alert">
            <strong>No schedule yet.</strong>
            <div className="muted">Go back to page 1 and click “Generate Schedule”.</div>
          </div>
        ) : (
          <div className="calendarWrap">
            <div className="calendarScroll" aria-label="Schedule calendar">
              <div className="calendar">
                {gridDays.map((isoDate, idx) => {
                  if (!isoDate) {
                    return <div key={`blank-${idx}`} className="day blank" />;
                  }
                  const day = schedule[isoDate];
                  const isSelected = selectedDate === isoDate;
                  const status = dayStatus(day);
                  const dayClass = [
                    "day",
                    isSelected ? "selected" : null,
                    status === "danger" ? "danger" : null,
                    status === "warn" ? "warn" : null,
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <div
                      key={isoDate}
                      className={dayClass}
                      onClick={() => {
                        setSelectedDate(isoDate);
                        setDayOpen(true);
                      }}
                    >
                      <div className="dayTop">
                        <div className="dateNum">{Number(isoDate.slice(8))}</div>
                        <div className="dow">{dayName(isoDate)}</div>
                        {day.nationalHoliday ? <div className="pill">Holiday</div> : null}
                      </div>

                      <div className="shifts">
                        {SHIFT_ORDER.map((shift) => {
                          const ids = day.assignments[shift] ?? [];
                          return (
                            <div
                              key={shift}
                              className={shift === SHIFT.C ? "shift night" : "shift"}
                              onClick={
                                readOnly
                                  ? undefined
                                  : (e) => {
                                      if (!tapMove) return;
                                      // Prevent opening the day modal when completing a tap-move.
                                      e.stopPropagation();
                                      applyMoveTo({ toIsoDate: isoDate, toShift: shift });
                                    }
                              }
                              onDragOver={
                                readOnly
                                  ? undefined
                                  : (e) => {
                                      e.preventDefault();
                                    }
                              }
                              onDrop={
                                readOnly
                                  ? undefined
                                  : (e) => {
                                      e.preventDefault();
                                      const raw = e.dataTransfer.getData("application/json");
                                      if (!raw) return;
                                      const payload = JSON.parse(raw);
                                      updateAssignment({
                                        fromIsoDate: payload.isoDate,
                                        toIsoDate: isoDate,
                                        fromShift: payload.fromShift,
                                        toShift: shift,
                                        employeeId: payload.employeeId,
                                      });
                                      clearTapMove();
                                    }
                              }
                            >
                              <div className="shiftTitle">{SHIFT_LABEL[shift]}</div>
                              <div className="chipRow">
                                {ids.map((id) => (
                                  <Chip
                                    key={`${isoDate}-${shift}-${id}`}
                                    employeeId={id}
                                    fromShift={shift}
                                    isoDate={isoDate}
                                  />
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="tiny">
                        Off: {day.weeklyOffEmployeeIds.join(", ") || "—"}
                        {day.leaveEmployeeIds.length ? (
                          <> · Leave: {day.leaveEmployeeIds.join(", ")}</>
                        ) : null}
                        {day.compOffEmployeeIds.length ? (
                          <> · Comp-off: {day.compOffEmployeeIds.join(", ")}</>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <Modal
          open={dayOpen}
          title={selected ? `Day details: ${selected.isoDate}` : "Day details"}
          onClose={() => setDayOpen(false)}
        >
          {!selected ? (
            <p className="muted" style={{ marginTop: 0 }}>
              Click a day first.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div className="muted">
                  Available: <strong style={{ color: "var(--text)" }}>{selected.availableEmployeeIds.length}</strong>
                </div>
                <div className="row" style={{ alignItems: "center" }}>
                  {selected.nationalHoliday ? <span className="pill">Holiday</span> : null}
                  {selected.anyLeaveApplied ? <span className="tag">Leave applied</span> : null}
                </div>
              </div>

              <div className="shifts" style={{ marginTop: 0 }}>
                {SHIFT_ORDER.map((shift) => (
                  <div
                    key={`modal-${shift}`}
                    className={shift === SHIFT.C ? "shift night" : "shift"}
                    onClick={
                      readOnly
                        ? undefined
                        : (e) => {
                            if (!tapMove) return;
                            e.stopPropagation();
                            applyMoveTo({ toIsoDate: selected.isoDate, toShift: shift });
                          }
                    }
                    onDragOver={
                      readOnly
                        ? undefined
                        : (e) => {
                            e.preventDefault();
                          }
                    }
                    onDrop={
                      readOnly
                        ? undefined
                        : (e) => {
                            e.preventDefault();
                            const raw = e.dataTransfer.getData("application/json");
                            if (!raw) return;
                            const payload = JSON.parse(raw);
                            updateAssignment({
                              fromIsoDate: payload.isoDate,
                              toIsoDate: selected.isoDate,
                              fromShift: payload.fromShift,
                              toShift: shift,
                              employeeId: payload.employeeId,
                            });
                            clearTapMove();
                          }
                    }
                  >
                    <div className="shiftTitle">{SHIFT_LABEL[shift]}</div>
                    <div className="chipRow">
                      {(selected.assignments?.[shift] ?? []).length ? (
                        (selected.assignments?.[shift] ?? []).map((id) => (
                          <Chip
                            key={`modal-${selected.isoDate}-${shift}-${id}`}
                            employeeId={id}
                            fromShift={shift}
                            isoDate={selected.isoDate}
                          />
                        ))
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="details">
                <div className="detailsLine">
                  Weekly off: {selected.weeklyOffEmployeeIds.join(", ") || "—"}
                </div>
                <div className="detailsLine">Leave: {selected.leaveEmployeeIds.join(", ") || "—"}</div>
                <div className="detailsLine">
                  Comp-off: {selected.compOffEmployeeIds.join(", ") || "—"}
                </div>
              </div>
            </div>
          )}
        </Modal>

        <Modal open={peopleOpen} title="People (month summary)" onClose={() => setPeopleOpen(false)}>
          {!peopleStats ? (
            <p className="muted" style={{ marginTop: 0 }}>
              Generate a schedule first.
            </p>
          ) : (
            <div className="peopleTable" role="table" aria-label="Monthly shift counts">
              <div className="peopleHeader" role="row">
                <div role="columnheader">Person</div>
                <div role="columnheader">Role</div>
                <div role="columnheader">A</div>
                <div role="columnheader">B</div>
                <div role="columnheader">C</div>
                <div role="columnheader">Comp-off</div>
              </div>

              {peopleStats.map((p) => (
                <div key={p.id} className="peopleRow" role="row">
                  <div role="cell" style={{ fontWeight: 700 }}>
                    {p.name}
                  </div>
                  <div role="cell" className="muted">
                    {p.role}
                  </div>
                  <div role="cell">
                    <button
                      className={p.A > 0 ? "countBtn" : "countBtn disabled"}
                      onClick={() => (p.A > 0 ? openDrill(p.id, SHIFT.A) : null)}
                      disabled={p.A <= 0}
                      title={p.A > 0 ? "Show dates" : "No days"}
                    >
                      {p.A}
                    </button>
                  </div>
                  <div role="cell">
                    <button
                      className={p.B > 0 ? "countBtn" : "countBtn disabled"}
                      onClick={() => (p.B > 0 ? openDrill(p.id, SHIFT.B) : null)}
                      disabled={p.B <= 0}
                      title={p.B > 0 ? "Show dates" : "No days"}
                    >
                      {p.B}
                    </button>
                  </div>
                  <div role="cell">
                    <button
                      className={p.C > 0 ? "countBtn" : "countBtn disabled"}
                      onClick={() => (p.C > 0 ? openDrill(p.id, SHIFT.C) : null)}
                      disabled={p.C <= 0}
                      title={p.C > 0 ? "Show dates" : "No days"}
                    >
                      {p.C}
                    </button>
                  </div>
                  <div role="cell">
                    <button
                      className={p.compOffs > 0 ? "countBtn" : "countBtn disabled"}
                      onClick={() => (p.compOffs > 0 ? openDrill(p.id, "COMPOFF") : null)}
                      disabled={p.compOffs <= 0}
                      title={p.compOffs > 0 ? "Show dates" : "No days"}
                    >
                      {p.compOffs}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>

        <Modal
          open={drillOpen}
          title={
            drill.employeeId && drill.kind
              ? `${drill.employeeId} — ${drill.kind === "COMPOFF" ? "Comp-off" : SHIFT_LABEL[drill.kind]} days`
              : "Details"
          }
          onClose={() => setDrillOpen(false)}
        >
          {drillDates.length === 0 ? (
            <p className="muted" style={{ marginTop: 0 }}>
              No days.
            </p>
          ) : (
            <div className="dateGrid" aria-label="Dates">
              {drillDates.map((iso) => (
                <button
                  key={`${drill.employeeId}-${drill.kind}-${iso}`}
                  className="dateBtn"
                  onClick={() => {
                    setSelectedDate(iso);
                    setDrillOpen(false);
                    setDayOpen(true);
                  }}
                  title="Open day details"
                >
                  {ordinal(Number(iso.slice(8)))}
                </button>
              ))}
            </div>
          )}
        </Modal>

        <Modal open={rulesOpen} title="Rules" onClose={() => setRulesOpen(false)}>
          <ul className="modalList">
            <li>3 shifts: A (7–3), B (3–11), C (11–7).</li>
            <li>Employee stays on the same shift for a full week (no mid-week change).</li>
            <li>Weekly-off is fixed: only Saturday or Sunday (per employee).</li>
            <li>Coverage: A ≥ 1, B ≥ 1; C targets 2 (max 2) and can be 1 only in emergency.</li>
            <li>Night shift caps: Lead ≤ 6 nights/month; others ≤ 12 nights/month.</li>
            <li>National holiday work earns a comp-off within ±3 days (best-effort auto-applied).</li>
            <li>B and C should include at least 1 Lead/Senior when possible.</li>
          </ul>
        </Modal>

        <Modal open={issuesOpen} title="Errors & warnings" onClose={() => setIssuesOpen(false)}>
          {errorCount > 0 ? (
            <div className="alert danger" style={{ marginTop: 0 }}>
              <strong>Errors ({errorCount})</strong>
              <ul className="modalIssues">
                {(generated?.errors ?? []).map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 0 }}>
              No errors.
            </p>
          )}

          {!readOnly && compOffWarnings.length > 0 ? (
            <div className="alert" style={{ marginTop: 12 }}>
              <strong>Could not assign comp-off ({compOffWarnings.length})</strong>
              <ul className="modalIssues">
                {compOffWarnings.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {otherWarnings.length > 0 ? (
            <div className="alert" style={{ marginTop: 12 }}>
              <strong>Warnings ({otherWarnings.length})</strong>
              <ul className="modalIssues">
                {otherWarnings.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          ) : warningCount > 0 ? null : (
            <p className="muted">No warnings.</p>
          )}
        </Modal>
      </section>
    </Layout>
  );
}
