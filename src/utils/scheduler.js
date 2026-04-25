import { addDays, getDay, startOfWeek } from "date-fns";
import { EMPLOYEES, isLeadOrSenior, ROLE, WEEKLY_OFF, WEEKLY_OFF_BY_DAY } from "../constants/employees.js";
import { MAX_STAFFING, MIN_STAFFING, SHIFT, TARGET_STAFFING } from "../constants/shifts.js";
import { eachDayOfRange, monthsInRange, monthKeyOf, toISODate } from "./date.js";
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

function sortByFairness({
  candidateIds,
  cumulativeNightCounts,
  monthlyNightCounts,
  primaryMonthKey,
  historyStatsByEmployeeId,
  lastNightWeekIndexByEmployeeId,
}) {
  return [...candidateIds].sort((a, b) => {
    const aCum = cumulativeNightCounts?.[a] ?? 0;
    const bCum = cumulativeNightCounts?.[b] ?? 0;
    if (aCum !== bCum) return aCum - bCum;

    const aMonth = monthlyNightCounts?.[primaryMonthKey]?.[a] ?? 0;
    const bMonth = monthlyNightCounts?.[primaryMonthKey]?.[b] ?? 0;
    if (aMonth !== bMonth) return aMonth - bMonth;

    const aHistNight = historyStatsByEmployeeId?.[a]?.C ?? 0;
    const bHistNight = historyStatsByEmployeeId?.[b]?.C ?? 0;
    if (aHistNight !== bHistNight) return aHistNight - bHistNight;

    const aHistComp = historyStatsByEmployeeId?.[a]?.compOffs ?? 0;
    const bHistComp = historyStatsByEmployeeId?.[b]?.compOffs ?? 0;
    if (aHistComp !== bHistComp) return aHistComp - bHistComp;

    // Round-robin tiebreak: whoever did C shift longer ago goes first.
    // Employees who never did C in this run get -1, so they always win this tiebreak.
    const aLast = lastNightWeekIndexByEmployeeId?.[a] ?? -1;
    const bLast = lastNightWeekIndexByEmployeeId?.[b] ?? -1;
    if (aLast !== bLast) return aLast - bLast;

    return a.localeCompare(b);
  });
}

function wouldExceedMonthlyCap({ employeeId, role, monthlyNightCounts, contributionsByMonth }) {
  const max = MAX_NIGHT_DAYS[role] ?? 12;
  for (const [monthKey, days] of Object.entries(contributionsByMonth)) {
    if (days <= 0) continue;
    const used = monthlyNightCounts?.[monthKey]?.[employeeId] ?? 0;
    if (used + days > max) return true;
  }
  return false;
}

function pickTwoForNight({
  candidateIds,
  cumulativeNightCounts,
  monthlyNightCounts,
  primaryMonthKey,
  employeeById,
  historyStatsByEmployeeId,
  lastNightWeekIndexByEmployeeId,
  contributionsByMonth,
  disallowIds,
  preferId,
}) {
  const sorted = sortByFairness({
    candidateIds,
    cumulativeNightCounts,
    monthlyNightCounts,
    primaryMonthKey,
    historyStatsByEmployeeId,
    lastNightWeekIndexByEmployeeId,
  });

  const disallowed = new Set(disallowIds ?? []);

  // Prefer employees still within their per-month night limit across every touched month.
  const picked = [];

  if (preferId && !disallowed.has(preferId) && sorted.includes(preferId)) {
    const employee = employeeById.get(preferId);
    if (employee) {
      const exceeds = wouldExceedMonthlyCap({
        employeeId: preferId,
        role: employee.role,
        monthlyNightCounts,
        contributionsByMonth,
      });
      if (!exceeds) {
        picked.push(preferId);
      }
    }
  }

  for (const id of sorted) {
    if (disallowed.has(id)) continue;
    if (picked.includes(id)) continue;
    const employee = employeeById.get(id);
    if (!employee) continue;
    const exceeds = wouldExceedMonthlyCap({
      employeeId: id,
      role: employee.role,
      monthlyNightCounts,
      contributionsByMonth,
    });
    if (exceeds) continue;
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
  cumulativeNightCounts,
  monthlyNightCounts,
  primaryMonthKey,
  employeeById,
  historyStatsByEmployeeId,
  lastNightWeekIndexByEmployeeId,
  contributionsByMonth,
  disallowIds,
  preferId,
}) {
  const sorted = sortByFairness({
    candidateIds,
    cumulativeNightCounts,
    monthlyNightCounts,
    primaryMonthKey,
    historyStatsByEmployeeId,
    lastNightWeekIndexByEmployeeId,
  });

  const disallowed = new Set(disallowIds ?? []);

  if (preferId && !disallowed.has(preferId) && sorted.includes(preferId)) {
    const employee = employeeById.get(preferId);
    if (employee) {
      const exceeds = wouldExceedMonthlyCap({
        employeeId: preferId,
        role: employee.role,
        monthlyNightCounts,
        contributionsByMonth,
      });
      if (!exceeds) return preferId;
    }
  }

  for (const id of sorted) {
    if (disallowed.has(id)) continue;
    const employee = employeeById.get(id);
    if (!employee) continue;
    const exceeds = wouldExceedMonthlyCap({
      employeeId: id,
      role: employee.role,
      monthlyNightCounts,
      contributionsByMonth,
    });
    if (exceeds) continue;
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

function buildWeeklyShiftPlan({ rangeDays, range, historyStatsByEmployeeId }) {
  const employeeById = new Map(EMPLOYEES.map((e) => [e.id, e]));
  const weekStarts = uniq(rangeDays.map((d) => weekKey(d))).map((iso) => new Date(iso));

  const rangeMonthKeys = new Set(monthsInRange(range).map(monthKeyOf));
  const rangeDaysIsoSet = new Set(rangeDays.map((d) => toISODate(d)));

  const lastWeekShiftByEmployeeId = {};
  // Cumulative night-day counts across the entire range (drives inter-month fairness).
  const cumulativeNightCounts = {};
  // Per-month night-day counts, keyed by "YYYY-MM" (drives the spec's monthly caps).
  const monthlyNightCounts = {};
  // Records the loop index of the last week each employee was placed on the C shift.
  // Used as a round-robin tiebreak so we don't fall through to alphabetical bias when
  // cumulative + monthly counts are tied at week boundaries.
  const lastNightWeekIndexByEmployeeId = {};
  const plannedShiftCounts = {};
  const weekPlanByWeekStartIso = {};

  let partialSunOffNightId = null;
  let partialSatOffNightId = null;

  function isInRangeDate(d) {
    return rangeDaysIsoSet.has(toISODate(d));
  }

  function countDaysInRangeForWeek(weekStart) {
    let count = 0;
    for (let i = 0; i < 7; i += 1) {
      const d = addDays(weekStart, i);
      if (isInRangeDate(d)) count += 1;
    }
    return count;
  }

  // Returns { totalNightDays, offDayInRange, contributionsByMonth } for a given week + weekly-off group.
  function nightDaysBreakdownForWeek(weekStart, weeklyOffDay) {
    const offDow = weeklyOffDay === WEEKLY_OFF.SATURDAY ? 6 : 0;
    const contributionsByMonth = {};
    let totalNightDays = 0;
    let offDayInRange = false;

    for (let i = 0; i < 7; i += 1) {
      const d = addDays(weekStart, i);
      if (!isInRangeDate(d)) continue;
      if (getDay(d) === offDow) {
        offDayInRange = true;
        continue;
      }
      totalNightDays += 1;
      const mk = monthKeyOf({ year: d.getFullYear(), monthIndex: d.getMonth() });
      contributionsByMonth[mk] = (contributionsByMonth[mk] ?? 0) + 1;
    }

    return { totalNightDays, offDayInRange, contributionsByMonth };
  }

  function primaryMonthKeyFor(contributionsByMonth) {
    let best = null;
    let bestCount = -1;
    for (const [mk, n] of Object.entries(contributionsByMonth)) {
      if (n > bestCount) {
        bestCount = n;
        best = mk;
      }
    }
    return best;
  }

  for (const employee of EMPLOYEES) {
    plannedShiftCounts[employee.id] = { [SHIFT.A]: 0, [SHIFT.B]: 0, [SHIFT.C]: 0 };
    cumulativeNightCounts[employee.id] = 0;
  }
  for (const mk of rangeMonthKeys) {
    monthlyNightCounts[mk] = {};
    for (const employee of EMPLOYEES) monthlyNightCounts[mk][employee.id] = 0;
  }

  for (let i = 0; i < weekStarts.length; i += 1) {
    const start = weekStarts[i];
    const weekStartIso = toISODate(start);

    // Two fixed weekend groups (because weekly-off is Sat or Sun).
    // Saturday-working group = Sunday-off employees
    // Sunday-working group = Saturday-off employees
    const saturdayWorking = WEEKLY_OFF_BY_DAY[WEEKLY_OFF.SUNDAY];
    const sundayWorking = WEEKLY_OFF_BY_DAY[WEEKLY_OFF.SATURDAY];

    const sunOff = nightDaysBreakdownForWeek(start, WEEKLY_OFF.SUNDAY);
    const satOff = nightDaysBreakdownForWeek(start, WEEKLY_OFF.SATURDAY);

    const isPartialSunOffWeek = sunOff.totalNightDays > 0 && sunOff.totalNightDays < MIN_NIGHT_DAYS_TARGET;
    const isPartialSatOffWeek = satOff.totalNightDays > 0 && satOff.totalNightDays < MIN_NIGHT_DAYS_TARGET;

    const cFromSatGroup = pickOneForNight({
      candidateIds: saturdayWorking,
      cumulativeNightCounts,
      monthlyNightCounts,
      primaryMonthKey: primaryMonthKeyFor(sunOff.contributionsByMonth),
      employeeById,
      historyStatsByEmployeeId,
      lastNightWeekIndexByEmployeeId,
      contributionsByMonth: sunOff.contributionsByMonth,
      // For partial weeks (<6 in-range working days), avoid using the Lead so they can take a full 6-day
      // week of nights within their cap.
      disallowIds: isPartialSunOffWeek ? ["AZM"] : [],
      // Only "carry" across partial weeks (not into full weeks) to avoid long runs and imbalance.
      preferId: isPartialSunOffWeek ? partialSunOffNightId : null,
    });
    const cFromSunGroup = pickOneForNight({
      candidateIds: sundayWorking,
      cumulativeNightCounts,
      monthlyNightCounts,
      primaryMonthKey: primaryMonthKeyFor(satOff.contributionsByMonth),
      employeeById,
      historyStatsByEmployeeId,
      lastNightWeekIndexByEmployeeId,
      contributionsByMonth: satOff.contributionsByMonth,
      disallowIds: isPartialSatOffWeek ? ["AZM"] : [],
      preferId: isPartialSatOffWeek ? partialSatOffNightId : null,
    });

    const cIds = uniq([cFromSatGroup, cFromSunGroup].filter(Boolean));

    // Carry-forward continuity for partial weeks: only across *adjacent* partial weeks.
    // A non-partial week breaks the chain so the next partial week (often at the other end of the
    // range) re-picks by fairness instead of locking onto the same person.
    if (isPartialSunOffWeek) {
      if (cFromSatGroup) partialSunOffNightId = cFromSatGroup;
    } else {
      partialSunOffNightId = null;
    }
    if (isPartialSatOffWeek) {
      if (cFromSunGroup) partialSatOffNightId = cFromSunGroup;
    } else {
      partialSatOffNightId = null;
    }

    // Increment night counts (cumulative across the range + per-month).
    function addNightContributions(empId, contributionsByMonth) {
      if (!empId) return;
      for (const [mk, days] of Object.entries(contributionsByMonth)) {
        if (days <= 0) continue;
        cumulativeNightCounts[empId] = (cumulativeNightCounts[empId] ?? 0) + days;
        monthlyNightCounts[mk] = monthlyNightCounts[mk] ?? {};
        monthlyNightCounts[mk][empId] = (monthlyNightCounts[mk][empId] ?? 0) + days;
      }
    }
    addNightContributions(cFromSatGroup, sunOff.contributionsByMonth);
    addNightContributions(cFromSunGroup, satOff.contributionsByMonth);

    if (cFromSatGroup) lastNightWeekIndexByEmployeeId[cFromSatGroup] = i;
    if (cFromSunGroup) lastNightWeekIndexByEmployeeId[cFromSunGroup] = i;

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

    if (aFromSatGroup) plannedShiftCounts[aFromSatGroup][SHIFT.A] += sunOff.totalNightDays;
    if (aFromSunGroup) plannedShiftCounts[aFromSunGroup][SHIFT.A] += satOff.totalNightDays;
    for (const id of cIds) {
      const add = id === cFromSatGroup ? sunOff.totalNightDays : satOff.totalNightDays;
      plannedShiftCounts[id][SHIFT.C] += add;
    }

    const bIds = EMPLOYEES.map((e) => e.id).filter((id) => !cIds.includes(id) && !aIds.includes(id));

    for (const id of aIds) lastWeekShiftByEmployeeId[id] = SHIFT.A;
    for (const id of bIds) lastWeekShiftByEmployeeId[id] = SHIFT.B;
    for (const id of cIds) lastWeekShiftByEmployeeId[id] = SHIFT.C;

    weekPlanByWeekStartIso[weekStartIso] = {
      A: aIds,
      B: bIds,
      C: cIds,
      meta: {
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

function computeNightCountsByMonth(scheduleByDate) {
  const byMonth = {};
  for (const [iso, day] of Object.entries(scheduleByDate)) {
    const monthKey = iso.slice(0, 7);
    if (!byMonth[monthKey]) {
      byMonth[monthKey] = {};
      for (const e of EMPLOYEES) byMonth[monthKey][e.id] = 0;
    }
    for (const id of day.assignments?.C ?? []) {
      byMonth[monthKey][id] = (byMonth[monthKey][id] ?? 0) + 1;
    }
  }
  return byMonth;
}

function getWeeklyOffIdsForDate(date) {
  const dow = getDay(date);
  if (dow === 6) return WEEKLY_OFF_BY_DAY[WEEKLY_OFF.SATURDAY];
  if (dow === 0) return WEEKLY_OFF_BY_DAY[WEEKLY_OFF.SUNDAY];
  return [];
}

const MIN_AVAILABLE_EMPLOYEES_PER_DAY = 4;

function buildInitialSchedule({ range, leavesByEmployeeId, nationalHolidaySet, historyStatsByEmployeeId }) {
  const rangeDays = eachDayOfRange(range);
  const weekPlanByWeekStartIso = buildWeeklyShiftPlan({ rangeDays, range, historyStatsByEmployeeId });

  const scheduleByDate = {};

  for (const dayDate of rangeDays) {
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

export function generateSchedule({ range, leavesByEmployeeId, nationalHolidays, history }) {
  const nationalHolidaySet = new Set(nationalHolidays);

  // Normalize leaves sets
  const normalizedLeaves = {};
  for (const employee of EMPLOYEES) {
    const value = leavesByEmployeeId?.[employee.id];
    normalizedLeaves[employee.id] = value instanceof Set ? value : new Set(value ?? []);
  }

  const scheduleByDate = buildInitialSchedule({
    range,
    leavesByEmployeeId: normalizedLeaves,
    nationalHolidaySet,
    historyStatsByEmployeeId: history?.statsByEmployeeId ?? {},
  });

  const compOffResult = applyCompOffs({ scheduleByDate });

  const validation = validateSchedule(scheduleByDate);

  const monthsInScope = monthsInRange(range);

  const nightCountsByMonth = computeNightCountsByMonth(scheduleByDate);
  const shortNightWarnings = [];
  const nightLimitErrors = [];

  for (const monthMeta of monthsInScope) {
    const mk = monthKeyOf(monthMeta);
    const counts = nightCountsByMonth[mk] ?? {};
    for (const employee of EMPLOYEES) {
      const used = counts[employee.id] ?? 0;
      if (used > 0 && used < MIN_NIGHT_DAYS_TARGET) {
        shortNightWarnings.push(
          `${mk}: ${employee.id} is assigned only ${used} night shift day(s). The scheduler tries to keep night shifts in ~${MIN_NIGHT_DAYS_TARGET}-day weekly chunks, but month edges/leaves/comp-offs can reduce it.`
        );
      }
      const max = MAX_NIGHT_DAYS[employee.role] ?? 12;
      if (used > max) {
        nightLimitErrors.push(
          `${mk}: ${employee.id} is assigned ${used} night shifts (limit ${max}). This happened to keep C shift staffed.`
        );
      }
    }
  }

  const rangeNote =
    monthsInScope.length > 1
      ? `Schedule generated for ${monthsInScope.length} months (${monthKeyOf(monthsInScope[0])} to ${monthKeyOf(
          monthsInScope[monthsInScope.length - 1]
        )}). Night shifts are balanced across months; per-month caps still apply.`
      : `Schedule generated for ${monthKeyOf(monthsInScope[0] ?? { year: 0, monthIndex: 0 })}.`;

  const warnings = [
    rangeNote,
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
