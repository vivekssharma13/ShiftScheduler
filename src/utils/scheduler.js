import { addDays, getDay, startOfWeek } from "date-fns";
import { EMPLOYEES, isLeadOrSenior, ROLE, WEEKLY_OFF, WEEKLY_OFF_BY_DAY } from "../constants/employees.js";
import { MAX_STAFFING, MIN_STAFFING, SHIFT, TARGET_STAFFING } from "../constants/shifts.js";
import { eachDayOfMonth, toISODate } from "./date.js";
import { validateSchedule } from "./validation.js";

const MAX_NIGHT_DAYS = {
  // Based on your rules:
  // - Lead: 6 night shifts (1 week)
  // - Others: 12 night shifts (2 weeks)
  [ROLE.LEAD]: 6,
  [ROLE.SENIOR]: 12,
  [ROLE.JUNIOR]: 12,
};

const MIN_NIGHT_DAYS_TARGET = 6;

function weekKey(date) {
  const start = startOfWeek(date, { weekStartsOn: 0 }); // Sunday
  return toISODate(start);
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function without(arr, id) {
  return arr.filter((x) => x !== id);
}

function pickTwoForNight({
  candidateIds,
  plannedNightCounts,
  employeeById,
  historyStatsByEmployeeId,
  plannedNightDays,
  disallowIds,
  preferId,
}) {
  const sorted = [...candidateIds].sort((a, b) => {
    const aPlanned = plannedNightCounts[a] ?? 0;
    const bPlanned = plannedNightCounts[b] ?? 0;
    if (aPlanned !== bPlanned) return aPlanned - bPlanned;

    const aHistNight = historyStatsByEmployeeId?.[a]?.C ?? 0;
    const bHistNight = historyStatsByEmployeeId?.[b]?.C ?? 0;
    if (aHistNight !== bHistNight) return aHistNight - bHistNight;

    const aHistComp = historyStatsByEmployeeId?.[a]?.compOffs ?? 0;
    const bHistComp = historyStatsByEmployeeId?.[b]?.compOffs ?? 0;
    if (aHistComp !== bHistComp) return aHistComp - bHistComp;

    return a.localeCompare(b);
  });

  const disallowed = new Set(disallowIds ?? []);

  // Prefer employees still within their night limit.
  const picked = [];

  if (preferId && !disallowed.has(preferId) && sorted.includes(preferId)) {
    const employee = employeeById.get(preferId);
    if (employee) {
      const used = plannedNightCounts[preferId] ?? 0;
      const max = MAX_NIGHT_DAYS[employee.role] ?? 12;
      if (used + plannedNightDays <= max) {
        picked.push(preferId);
      }
    }
  }

  for (const id of sorted) {
    if (disallowed.has(id)) continue;
    if (picked.includes(id)) continue;
    const employee = employeeById.get(id);
    if (!employee) continue;
    const used = plannedNightCounts[id] ?? 0;
    const max = MAX_NIGHT_DAYS[employee.role] ?? 12;
    if (used + plannedNightDays > max) continue;
    picked.push(id);
    if (picked.length === 2) return picked;
  }

  // Best-effort fallback: exceed limits (with warnings later) but never return <2.
  for (const id of sorted) {
    if (disallowed.has(id)) continue;
    if (picked.includes(id)) continue;
    picked.push(id);
    if (picked.length === 2) break;
  }

  return picked;
}

function pickOneForNight({
  candidateIds,
  plannedNightCounts,
  employeeById,
  historyStatsByEmployeeId,
  plannedNightDays,
  disallowIds,
  preferId,
}) {
  const sorted = [...candidateIds].sort((a, b) => {
    const aPlanned = plannedNightCounts[a] ?? 0;
    const bPlanned = plannedNightCounts[b] ?? 0;
    if (aPlanned !== bPlanned) return aPlanned - bPlanned;

    const aHistNight = historyStatsByEmployeeId?.[a]?.C ?? 0;
    const bHistNight = historyStatsByEmployeeId?.[b]?.C ?? 0;
    if (aHistNight !== bHistNight) return aHistNight - bHistNight;

    const aHistComp = historyStatsByEmployeeId?.[a]?.compOffs ?? 0;
    const bHistComp = historyStatsByEmployeeId?.[b]?.compOffs ?? 0;
    if (aHistComp !== bHistComp) return aHistComp - bHistComp;

    return a.localeCompare(b);
  });

  const disallowed = new Set(disallowIds ?? []);

  if (preferId && !disallowed.has(preferId) && sorted.includes(preferId)) {
    const employee = employeeById.get(preferId);
    if (employee) {
      const used = plannedNightCounts[preferId] ?? 0;
      const max = MAX_NIGHT_DAYS[employee.role] ?? 12;
      if (used + plannedNightDays <= max) return preferId;
    }
  }

  for (const id of sorted) {
    if (disallowed.has(id)) continue;
    const employee = employeeById.get(id);
    if (!employee) continue;
    const used = plannedNightCounts[id] ?? 0;
    const max = MAX_NIGHT_DAYS[employee.role] ?? 12;
    if (used + plannedNightDays > max) continue;
    return id;
  }

  // Best-effort fallback: allow exceeding limits, but keep weekly plan stable.
  for (const id of sorted) {
    if (disallowed.has(id)) continue;
    return id;
  }

  return null;
}

function pickOneForA({ candidateIds, lastWeekShiftByEmployeeId, plannedShiftCounts, historyStatsByEmployeeId }) {
  const sorted = [...candidateIds].sort((a, b) => {
    const aPlanned = plannedShiftCounts?.[a]?.[SHIFT.A] ?? 0;
    const bPlanned = plannedShiftCounts?.[b]?.[SHIFT.A] ?? 0;
    if (aPlanned !== bPlanned) return aPlanned - bPlanned;

    const aHist = historyStatsByEmployeeId?.[a]?.A ?? 0;
    const bHist = historyStatsByEmployeeId?.[b]?.A ?? 0;
    if (aHist !== bHist) return aHist - bHist;
    return a.localeCompare(b);
  });

  for (const id of sorted) {
    const last = lastWeekShiftByEmployeeId[id];
    if (last === SHIFT.A) continue; // rule 5
    return id;
  }

  // Best-effort fallback
  return sorted[0] ?? null;
}

function buildWeeklyShiftPlan({ monthDays, year, monthIndex, historyStatsByEmployeeId }) {
  const employeeById = new Map(EMPLOYEES.map((e) => [e.id, e]));
  const weekStarts = uniq(monthDays.map((d) => weekKey(d))).map((iso) => new Date(iso));

  const lastWeekShiftByEmployeeId = {};
  const plannedNightCounts = {}; // planned night-day count within this month
  const plannedShiftCounts = {}; // planned shift-day count within this month
  const weekPlanByWeekStartIso = {};

  let partialSunOffNightId = null;
  let partialSatOffNightId = null;

  function isInMonth(d) {
    return d.getFullYear() === year && d.getMonth() === monthIndex;
  }

  function countDaysInMonthForWeek(weekStart) {
    let count = 0;
    for (let i = 0; i < 7; i += 1) {
      const d = addDays(weekStart, i);
      if (isInMonth(d)) count += 1;
    }
    return count;
  }

  function hasDowInMonthForWeek(weekStart, dow) {
    // dow: 0=Sun, 6=Sat
    for (let i = 0; i < 7; i += 1) {
      const d = addDays(weekStart, i);
      if (isInMonth(d) && getDay(d) === dow) return true;
    }
    return false;
  }

  function plannedNightDaysForWeekAndGroup(weekStart, weeklyOffDay) {
    // weeklyOffDay: 'Saturday' or 'Sunday'
    const daysInMonth = countDaysInMonthForWeek(weekStart);
    if (daysInMonth === 0) return 0;
    const offDow = weeklyOffDay === WEEKLY_OFF.SATURDAY ? 6 : 0;
    const offDayIsInMonth = hasDowInMonthForWeek(weekStart, offDow);
    return Math.max(0, daysInMonth - (offDayIsInMonth ? 1 : 0));
  }

  for (const employee of EMPLOYEES) {
    plannedShiftCounts[employee.id] = { [SHIFT.A]: 0, [SHIFT.B]: 0, [SHIFT.C]: 0 };
  }

  for (let i = 0; i < weekStarts.length; i += 1) {
    const start = weekStarts[i];
    const weekStartIso = toISODate(start);

    // Two fixed weekend groups (because weekly-off is Sat or Sun).
    // Saturday-working group = Sunday-off employees
    // Sunday-working group = Saturday-off employees
    const saturdayWorking = WEEKLY_OFF_BY_DAY[WEEKLY_OFF.SUNDAY];
    const sundayWorking = WEEKLY_OFF_BY_DAY[WEEKLY_OFF.SATURDAY];

    // For our fixed weekly-off model, all employees in the same group have the same number of
    // in-month working days for this week.
    // - saturdayWorking = Sunday-off employees
    // - sundayWorking = Saturday-off employees
    const sunOffNightDays = plannedNightDaysForWeekAndGroup(start, WEEKLY_OFF.SUNDAY);
    const satOffNightDays = plannedNightDaysForWeekAndGroup(start, WEEKLY_OFF.SATURDAY);

    const isPartialSunOffWeek = sunOffNightDays > 0 && sunOffNightDays < MIN_NIGHT_DAYS_TARGET;
    const isPartialSatOffWeek = satOffNightDays > 0 && satOffNightDays < MIN_NIGHT_DAYS_TARGET;

    // C shift is capped at 2/day and should be continuous for the week.
    // With fixed Sat/Sun weekly-offs, having 2 people in C every weekend day may be impossible
    // without breaking weekly continuity. We pick 2 for the week: one from each weekend-off group.
    const cFromSatGroup = pickOneForNight({
      candidateIds: saturdayWorking,
      plannedNightCounts,
      employeeById,
      historyStatsByEmployeeId,
      plannedNightDays: sunOffNightDays,
      // For partial weeks (<6 in-month working days), avoid using the Lead so they can take a full 6-day
      // week of nights within their cap.
      disallowIds: isPartialSunOffWeek ? ["AZM"] : [],
      // Only "carry" across partial weeks (not into full weeks) to avoid long runs and imbalance.
      preferId: isPartialSunOffWeek ? partialSunOffNightId : null,
    });
    const cFromSunGroup = pickOneForNight({
      candidateIds: sundayWorking,
      plannedNightCounts,
      employeeById,
      historyStatsByEmployeeId,
      plannedNightDays: satOffNightDays,
      disallowIds: isPartialSatOffWeek ? ["AZM"] : [],
      preferId: isPartialSatOffWeek ? partialSatOffNightId : null,
    });

    const cIds = uniq([cFromSatGroup, cFromSunGroup].filter(Boolean));

    // Remember who handled partial weeks so we can prefer the same person on the next partial week.
    if (isPartialSunOffWeek && cFromSatGroup) partialSunOffNightId = cFromSatGroup;
    if (isPartialSatOffWeek && cFromSunGroup) partialSatOffNightId = cFromSunGroup;

    // Increment planned night counts using actual in-month night-days for this week/group.
    if (cFromSatGroup) plannedNightCounts[cFromSatGroup] = (plannedNightCounts[cFromSatGroup] ?? 0) + sunOffNightDays;
    if (cFromSunGroup) plannedNightCounts[cFromSunGroup] = (plannedNightCounts[cFromSunGroup] ?? 0) + satOffNightDays;

    // Pick 1 A from each group so weekend can be A:1 (within the 4 available)
    const aFromSatGroup = pickOneForA({
      candidateIds: without(saturdayWorking, null).filter((id) => !cIds.includes(id)),
      lastWeekShiftByEmployeeId,
      plannedShiftCounts,
      historyStatsByEmployeeId,
    });
    const aFromSunGroup = pickOneForA({
      candidateIds: without(sundayWorking, null).filter((id) => !cIds.includes(id)),
      lastWeekShiftByEmployeeId,
      plannedShiftCounts,
      historyStatsByEmployeeId,
    });

    const aIds = uniq([aFromSatGroup, aFromSunGroup].filter(Boolean));

    // Track per-shift planned day counts (used to balance future weekly picks).
    if (aFromSatGroup) plannedShiftCounts[aFromSatGroup][SHIFT.A] += sunOffNightDays;
    if (aFromSunGroup) plannedShiftCounts[aFromSunGroup][SHIFT.A] += satOffNightDays;
    for (const id of cIds) {
      // plannedNightCounts already tracks C day counts, but keep plannedShiftCounts in sync.
      const add = id === cFromSatGroup ? sunOffNightDays : satOffNightDays;
      plannedShiftCounts[id][SHIFT.C] += add;
    }

    // Remaining employees go to B.
    const bIds = EMPLOYEES.map((e) => e.id).filter((id) => !cIds.includes(id) && !aIds.includes(id));

    // Track last-week shift to avoid A two weeks in a row.
    for (const id of aIds) lastWeekShiftByEmployeeId[id] = SHIFT.A;
    for (const id of bIds) lastWeekShiftByEmployeeId[id] = SHIFT.B;
    for (const id of cIds) lastWeekShiftByEmployeeId[id] = SHIFT.C;

    weekPlanByWeekStartIso[weekStartIso] = {
      A: aIds,
      B: bIds,
      C: cIds,
      meta: {
        // Helpful for user-facing warnings.
        note:
          "C shift is planned as a continuous weekly shift (max 2 people). Weekend C may drop to 1 on the weekly-off day.",
      },
    };
  }

  return weekPlanByWeekStartIso;
}

function computeNightCounts(scheduleByDate) {
  const nightCountByEmployeeId = {};
  for (const e of EMPLOYEES) nightCountByEmployeeId[e.id] = 0;

  for (const day of Object.values(scheduleByDate)) {
    for (const id of day.assignments.C ?? []) {
      if (nightCountByEmployeeId[id] === undefined) nightCountByEmployeeId[id] = 0;
      nightCountByEmployeeId[id] += 1;
    }
  }

  return nightCountByEmployeeId;
}

function getWeeklyOffIdsForDate(date) {
  const dow = getDay(date);
  if (dow === 6) return WEEKLY_OFF_BY_DAY[WEEKLY_OFF.SATURDAY];
  if (dow === 0) return WEEKLY_OFF_BY_DAY[WEEKLY_OFF.SUNDAY];
  return [];
}

const MIN_AVAILABLE_EMPLOYEES_PER_DAY = 4;

function buildInitialSchedule({ year, monthIndex, leavesByEmployeeId, nationalHolidaySet, historyStatsByEmployeeId }) {
  const monthDays = eachDayOfMonth(year, monthIndex);
  const weekPlanByWeekStartIso = buildWeeklyShiftPlan({ monthDays, year, monthIndex, historyStatsByEmployeeId });

  const scheduleByDate = {};

  for (const dayDate of monthDays) {
    const isoDate = toISODate(dayDate);
    const weekStartIso = toISODate(startOfWeek(dayDate, { weekStartsOn: 0 }));
    const plan = weekPlanByWeekStartIso[weekStartIso];

    const weeklyOffEmployeeIds = getWeeklyOffIdsForDate(dayDate);

    const leaveIds = [];
    for (const employee of EMPLOYEES) {
      const leaves = leavesByEmployeeId[employee.id] ?? new Set();
      if (leaves.has(isoDate)) leaveIds.push(employee.id);
    }

    const unavailable = new Set([...weeklyOffEmployeeIds, ...leaveIds]);
    const availableEmployeeIds = EMPLOYEES.map((e) => e.id).filter((id) => !unavailable.has(id));

    const assignments = {
      A: (plan?.A ?? []).filter((id) => availableEmployeeIds.includes(id)),
      B: (plan?.B ?? []).filter((id) => availableEmployeeIds.includes(id)),
      C: (plan?.C ?? []).filter((id) => availableEmployeeIds.includes(id)),
    };

    scheduleByDate[isoDate] = {
      isoDate,
      assignments,
      availableEmployeeIds,
      weeklyOffEmployeeIds,
      leaveEmployeeIds: leaveIds,
      compOffEmployeeIds: [],
      nationalHoliday: nationalHolidaySet.has(isoDate),
      anyLeaveApplied: leaveIds.length > 0,
    };
  }

  return scheduleByDate;
}

function computeCompOffDates({ scheduleByDate, employeeId, holidayIso }) {
  // Candidate days: within ±3 days, same month, employee is currently working that day.
  const candidates = [];
  for (let offset = -3; offset <= 3; offset += 1) {
    if (offset === 0) continue;
    const d = addDays(new Date(holidayIso), offset);
    const iso = toISODate(d);
    const day = scheduleByDate[iso];
    if (!day) continue;

    const isWorking = day.availableEmployeeIds.includes(employeeId);
    if (!isWorking) continue;

    candidates.push(iso);
  }

  return candidates;
}

function applyCompOffs({ scheduleByDate }) {
  const warnings = [];

  function getShiftForEmployeeOnDay(day, employeeId) {
    for (const shift of [SHIFT.A, SHIFT.B, SHIFT.C]) {
      if ((day.assignments[shift] ?? []).includes(employeeId)) return shift;
    }
    return null;
  }

  function removalIsSafe({ day, employeeId }) {
    const shift = getShiftForEmployeeOnDay(day, employeeId);
    if (!shift) return false;

    const wouldBeAvailable = day.availableEmployeeIds.length - 1;
    if (wouldBeAvailable < MIN_AVAILABLE_EMPLOYEES_PER_DAY) return false;

    const currentCount = (day.assignments[shift] ?? []).length;
    const wouldBeShiftCount = currentCount - 1;
    const min = MIN_STAFFING[shift] ?? 0;
    if (wouldBeShiftCount < min) return false;

    // Also enforce caps (currently only C).
    const cMax = MAX_STAFFING[SHIFT.C];
    if (typeof cMax === "number" && shift === SHIFT.C) {
      if (wouldBeShiftCount > cMax) return false;
    }

    return true;
  }

  function applyRemoval({ day, employeeId }) {
    const shift = getShiftForEmployeeOnDay(day, employeeId);
    if (!shift) return null;
    day.compOffEmployeeIds.push(employeeId);
    day.availableEmployeeIds = day.availableEmployeeIds.filter((id) => id !== employeeId);
    day.assignments[shift] = (day.assignments[shift] ?? []).filter((id) => id !== employeeId);
    return { shift };
  }

  function undoRemoval({ day, employeeId, shift }) {
    day.compOffEmployeeIds = day.compOffEmployeeIds.filter((id) => id !== employeeId);
    if (!day.availableEmployeeIds.includes(employeeId)) day.availableEmployeeIds.push(employeeId);
    if (!day.assignments[shift].includes(employeeId)) day.assignments[shift].push(employeeId);
  }

  const holidayDates = Object.keys(scheduleByDate).filter((iso) => scheduleByDate[iso].nationalHoliday);

  for (const holidayIso of holidayDates) {
    const holidayDay = scheduleByDate[holidayIso];

    // Who worked on the national holiday?
    const workedIds = EMPLOYEES.map((e) => e.id).filter((id) => {
      const assigned =
        holidayDay.assignments.A.includes(id) ||
        holidayDay.assignments.B.includes(id) ||
        holidayDay.assignments.C.includes(id);
      return assigned;
    });

    const candidatesByEmployeeId = new Map();
    for (const employeeId of workedIds) {
      const candidates = computeCompOffDates({ scheduleByDate, employeeId, holidayIso });
      candidatesByEmployeeId.set(employeeId, candidates);
    }

    const employeesNeedingCompOff = workedIds
      .filter((id) => (candidatesByEmployeeId.get(id) ?? []).length > 0)
      .sort((a, b) => (candidatesByEmployeeId.get(a) ?? []).length - (candidatesByEmployeeId.get(b) ?? []).length);

    for (const employeeId of workedIds) {
      if ((candidatesByEmployeeId.get(employeeId) ?? []).length === 0) {
        warnings.push(
          `${holidayIso}: ${employeeId} worked on a national holiday, but no comp-off day was available within ±3 days.`
        );
      }
    }

    function candidateScore({ day, employeeId }) {
      const shift = getShiftForEmployeeOnDay(day, employeeId);
      if (!shift) return -Infinity;
      const currentCount = (day.assignments[shift] ?? []).length;
      const hardMin = MIN_STAFFING[shift] ?? 0;
      const target = TARGET_STAFFING[shift] ?? hardMin;
      const slackToTarget = currentCount - target;
      const slackToMin = currentCount - hardMin;
      // Prefer removals that keep us above target and far from minimum.
      return slackToTarget * 10 + slackToMin;
    }

    // Compute the best set of safe comp-offs (maximize #assigned, then score).
    function backtrackBest(idx) {
      if (idx >= employeesNeedingCompOff.length) {
        return { count: 0, score: 0, plan: [] };
      }

      const employeeId = employeesNeedingCompOff[idx];
      const candidates = (candidatesByEmployeeId.get(employeeId) ?? []).slice();

      candidates.sort((aIso, bIso) => {
        const aDay = scheduleByDate[aIso];
        const bDay = scheduleByDate[bIso];
        return candidateScore({ day: bDay, employeeId }) - candidateScore({ day: aDay, employeeId });
      });

      // Option 1: skip this employee (no comp-off assigned safely).
      let best = backtrackBest(idx + 1);

      // Option 2: try assigning a safe comp-off day.
      for (const iso of candidates) {
        const day = scheduleByDate[iso];
        if (!day) continue;
        if (!removalIsSafe({ day, employeeId })) continue;

        const scoreHere = candidateScore({ day, employeeId });
        const applied = applyRemoval({ day, employeeId });
        if (!applied) continue;

        const next = backtrackBest(idx + 1);
        const option = {
          count: 1 + next.count,
          score: scoreHere + next.score,
          plan: [{ iso, employeeId }, ...next.plan],
        };

        undoRemoval({ day, employeeId, shift: applied.shift });

        if (option.count > best.count || (option.count === best.count && option.score > best.score)) {
          best = option;
        }
      }

      return best;
    }

    const best = backtrackBest(0);
    const assignedSet = new Set(best.plan.map((p) => p.employeeId));

    // Apply chosen safe removals.
    for (const { iso, employeeId } of best.plan) {
      const day = scheduleByDate[iso];
      if (!day) continue;
      // Defensive: re-check safety against current state.
      if (!removalIsSafe({ day, employeeId })) continue;
      applyRemoval({ day, employeeId });
    }

    for (const employeeId of employeesNeedingCompOff) {
      if (!assignedSet.has(employeeId)) {
        warnings.push(
          `${holidayIso}: Could not assign a comp-off for ${employeeId} within ±3 days without breaking minimum staffing. Please adjust manually.`
        );
      }
    }
  }

  return { warnings };
}

export function generateSchedule({ year, monthIndex, leavesByEmployeeId, nationalHolidays, history }) {
  const nationalHolidaySet = new Set(nationalHolidays);

  // Normalize leaves sets
  const normalizedLeaves = {};
  for (const employee of EMPLOYEES) {
    const value = leavesByEmployeeId?.[employee.id];
    normalizedLeaves[employee.id] = value instanceof Set ? value : new Set(value ?? []);
  }

  const scheduleByDate = buildInitialSchedule({
    year,
    monthIndex,
    leavesByEmployeeId: normalizedLeaves,
    nationalHolidaySet,
    historyStatsByEmployeeId: history?.statsByEmployeeId ?? {},
  });

  const compOffResult = applyCompOffs({ scheduleByDate });

  const validation = validateSchedule(scheduleByDate);

  const nightCounts = computeNightCounts(scheduleByDate);
  const shortNightWarnings = [];
  for (const employee of EMPLOYEES) {
    const used = nightCounts[employee.id] ?? 0;
    if (used > 0 && used < MIN_NIGHT_DAYS_TARGET) {
      shortNightWarnings.push(
        `${employee.id}: assigned only ${used} night shift day(s) this month. The scheduler tries to keep night shifts in ~${MIN_NIGHT_DAYS_TARGET}-day weekly chunks, but month edges/leaves/comp-offs can reduce it.`
      );
    }
  }

  const nightLimitErrors = [];
  for (const employee of EMPLOYEES) {
    const used = nightCounts[employee.id] ?? 0;
    const max = MAX_NIGHT_DAYS[employee.role] ?? 12;
    if (used > max) {
      nightLimitErrors.push(
        `${employee.id}: assigned ${used} night shifts in this month (limit ${max}). This happened to keep C shift staffed.`
      );
    }
  }

  // Add a top-level warning if user expects A2/B4/C2 but rules imply C>=4 to cover weekend.
  const warnings = [
    ...compOffResult.warnings,
    ...validation.warnings,
    ...shortNightWarnings,
    "Note: The scheduler keeps shifts continuous for the full week per employee. If comp-off choices would break minimum staffing, it warns so you can adjust manually.",
  ];

  const errors = [...validation.errors, ...nightLimitErrors];

  return {
    scheduleByDate,
    warnings,
    errors,
  };
}
