import { startOfWeek } from "date-fns";
import { EMPLOYEES, isLeadOrSenior, WEEKLY_OFF } from "../constants/employees.js";
import { MAX_STAFFING, MIN_STAFFING, SHIFT, TARGET_STAFFING } from "../constants/shifts.js";
import { fromISODate, isSaturday, isSunday, toISODate } from "./date.js";

function hasLeadOrSenior(employeeIds) {
  const byId = new Map(EMPLOYEES.map((e) => [e.id, e]));
  return employeeIds.some((id) => {
    const employee = byId.get(id);
    return employee ? isLeadOrSenior(employee) : false;
  });
}

export function validateDay({ isoDate, day }) {
  const warnings = [];
  const errors = [];

  const a = day.assignments[SHIFT.A] ?? [];
  const b = day.assignments[SHIFT.B] ?? [];
  const c = day.assignments[SHIFT.C] ?? [];

  const availableSet = new Set(day.availableEmployeeIds);
  const assignedAll = [...a, ...b, ...c];
  for (const id of assignedAll) {
    if (!availableSet.has(id)) {
      warnings.push(
        `${isoDate}: ${id} is assigned but unavailable (weekly off / leave / comp-off).`
      );
    }
  }

  const availableCount = day.availableEmployeeIds.length;
  if (availableCount < 4) {
    errors.push(
      `${isoDate}: Only ${availableCount} employees are available. Minimum required is 4 (A:1, B:1, C:2; worst-case C:1 emergency).`
    );
  }

  for (const shift of [SHIFT.A, SHIFT.B, SHIFT.C]) {
    const assignedCount = (day.assignments[shift] ?? []).length;
    const min = MIN_STAFFING[shift];

    if (assignedCount < min) {
      errors.push(`${isoDate}: ${shift} shift needs at least ${min} employee(s).`);
    }
  }

  // Enforce hard caps (currently only C).
  const cMax = MAX_STAFFING[SHIFT.C];
  if (typeof cMax === "number" && c.length > cMax) {
    errors.push(`${isoDate}: C shift must have at most ${cMax} employee(s).`);
  }

  // Emergency warning: C=1 is allowed only when unavoidable.
  if (c.length === (MIN_STAFFING[SHIFT.C] ?? 0) && (TARGET_STAFFING[SHIFT.C] ?? 0) > (MIN_STAFFING[SHIFT.C] ?? 0)) {
    warnings.push(
      `${isoDate}: C shift is staffed with 1 employee (emergency). Target is ${TARGET_STAFFING[SHIFT.C]}.`
    );
  }

  // Warn if schedule doesn't assign everyone who is available (user asked to put remaining into B).
  const assignedSet = new Set(assignedAll);
  const unassignedAvailable = day.availableEmployeeIds.filter((id) => !assignedSet.has(id));
  if (unassignedAvailable.length > 0) {
    warnings.push(
      `${isoDate}: ${unassignedAvailable.join(", ")} are available but unassigned. They should typically be placed into B after minimum staffing is met.`
    );
  }

  // Detect duplicates across shifts.
  const seen = new Set();
  const dupes = [];
  for (const id of assignedAll) {
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  if (dupes.length > 0) {
    warnings.push(`${isoDate}: ${Array.from(new Set(dupes)).join(", ")} are assigned to multiple shifts.`);
  }

  // Senior/Lead requirement (best-effort): B and C should have at least 1 Lead or Senior.
  if (!hasLeadOrSenior(b)) {
    warnings.push(
      `${isoDate}: B shift has no Lead/Senior. Allowed only in emergency (when none are available).`
    );
  }
  if (!hasLeadOrSenior(c)) {
    warnings.push(
      `${isoDate}: C shift has no Lead/Senior. Allowed only in emergency (when none are available).`
    );
  }

  // Weekend leave constraint: if only 4 available on Sat/Sun, employees shouldn't be on leave.
  // We can't "block" leave here (user input), but we can explain why it's problematic.
  const date = fromISODate(isoDate);
  const isWeekend = isSaturday(date) || isSunday(date);
  if (isWeekend && availableCount === 4 && day.anyLeaveApplied === true) {
    warnings.push(
      `${isoDate}: Weekend has exactly 4 available employees. Rule says these employees cannot apply leave on such days.`
    );
  }

  // Weekly off constraint (Sat/Sun only) is encoded via constants; warn if schedule marks off otherwise.
  for (const id of day.weeklyOffEmployeeIds) {
    const employee = EMPLOYEES.find((e) => e.id === id);
    if (!employee) continue;
    if (employee.weeklyOff === WEEKLY_OFF.SATURDAY && !isSaturday(date)) {
      warnings.push(
        `${isoDate}: ${id} is marked as Saturday weekly-off but this date is not Saturday.`
      );
    }
    if (employee.weeklyOff === WEEKLY_OFF.SUNDAY && !isSunday(date)) {
      warnings.push(`${isoDate}: ${id} is marked as Sunday weekly-off but this date is not Sunday.`);
    }
  }

  return { warnings, errors };
}

export function validateSchedule(scheduleByDate) {
  const warnings = [];
  const errors = [];

  for (const isoDate of Object.keys(scheduleByDate)) {
    const day = scheduleByDate[isoDate];
    const result = validateDay({ isoDate, day });
    warnings.push(...result.warnings);
    errors.push(...result.errors);
  }

  // Weekly shift continuity: an employee should not switch shifts within the same week.
  // (Off days are ignored; we only look at working/assigned days.)
  const byWeek = new Map();
  const isoDates = Object.keys(scheduleByDate).slice().sort();

  for (const isoDate of isoDates) {
    const day = scheduleByDate[isoDate];
    const date = fromISODate(isoDate);
    const weekStartIso = toISODate(startOfWeek(date, { weekStartsOn: 0 }));

    if (!byWeek.has(weekStartIso)) byWeek.set(weekStartIso, new Map());
    const weekMap = byWeek.get(weekStartIso);

    for (const employee of EMPLOYEES) {
      const id = employee.id;
      let shift = null;
      for (const s of [SHIFT.A, SHIFT.B, SHIFT.C]) {
        if ((day.assignments[s] ?? []).includes(id)) {
          shift = s;
          break;
        }
      }
      if (!shift) continue;

      if (!weekMap.has(id)) weekMap.set(id, shift);
      else if (weekMap.get(id) !== shift) {
        errors.push(
          `${isoDate}: ${id} shift changed within the same week (${weekMap.get(id)} -> ${shift}). Shifts must be continuous for the full week.`
        );
      }
    }
  }

  return { warnings, errors };
}
