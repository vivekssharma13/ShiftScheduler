import React, { useEffect, useMemo, useState } from "react";
import { EMPLOYEES } from "../constants/employees.js";
import { generateSchedule } from "../utils/scheduler.js";
import { validateSchedule } from "../utils/validation.js";
import { loadHistoryStats } from "../utils/history.js";
import { listHistoryMonths } from "../utils/historyDb.js";
import { ScheduleContext } from "./scheduleStore.js";
import {
  MAX_RANGE_MONTHS,
  compareMonth,
  isInRange,
  monthKeyOf,
  monthsInRange,
  monthsInRangeCount,
  parseMonthKey,
} from "../utils/date.js";

function defaultMonth() {
  const now = new Date();
  return { year: now.getFullYear(), monthIndex: now.getMonth() };
}

function defaultRange() {
  const m = defaultMonth();
  return { start: m, end: m };
}

function makeEmptyLeaves() {
  const leaves = {};
  for (const e of EMPLOYEES) leaves[e.id] = new Set();
  return leaves;
}

function clampActiveMonth(activeMonth, range) {
  if (!range?.start || !range?.end) return activeMonth;
  if (compareMonth(activeMonth, range.start) < 0) return range.start;
  if (compareMonth(activeMonth, range.end) > 0) return range.end;
  return activeMonth;
}

export function ScheduleProvider({ children }) {
  const [range, setRange] = useState(defaultRange());
  const [activeMonth, setActiveMonth] = useState(() => defaultRange().start);
  const [rangeError, setRangeError] = useState(null);
  const [nationalHolidays, setNationalHolidays] = useState(new Set());
  const [leavesByEmployeeId, setLeavesByEmployeeId] = useState(makeEmptyLeaves());

  const [editPast, setEditPast] = useState([]);
  const [editFuture, setEditFuture] = useState([]);

  const [history, setHistory] = useState({ monthsUsed: [], statsByEmployeeId: {} });
  const [historyStatus, setHistoryStatus] = useState({ loading: false, error: null });
  const [historyLibraryMonths, setHistoryLibraryMonths] = useState([]);

  async function refreshHistory() {
    setHistoryStatus({ loading: true, error: null });
    try {
      const [loaded, months] = await Promise.all([
        loadHistoryStats({ year: range.start.year, monthIndex: range.start.monthIndex, maxMonths: 6 }),
        listHistoryMonths(),
      ]);
      setHistory(loaded);
      setHistoryLibraryMonths(months);
      setHistoryStatus({ loading: false, error: null });
    } catch (e) {
      setHistory({ monthsUsed: [], statsByEmployeeId: {} });
      setHistoryLibraryMonths([]);
      setHistoryStatus({ loading: false, error: String(e?.message ?? e) });
    }
  }

  const [generated, setGenerated] = useState({
    scheduleByDate: null,
    warnings: [],
    errors: [],
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setHistoryStatus({ loading: true, error: null });
      try {
        const [loaded, months] = await Promise.all([
          loadHistoryStats({ year: range.start.year, monthIndex: range.start.monthIndex, maxMonths: 6 }),
          listHistoryMonths(),
        ]);
        if (cancelled) return;
        setHistory(loaded);
        setHistoryLibraryMonths(months);
        setHistoryStatus({ loading: false, error: null });
      } catch (e) {
        if (cancelled) return;
        setHistory({ monthsUsed: [], statsByEmployeeId: {} });
        setHistoryLibraryMonths([]);
        setHistoryStatus({ loading: false, error: String(e?.message ?? e) });
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [range.start.year, range.start.monthIndex, range.end.year, range.end.monthIndex]);

  const value = useMemo(() => {
    const MAX_EDITS = 10;
    const EXTRA = {
      LEAVE: "LEAVE",
      COMPOFF: "COMPOFF",
    };

    function capEdits(arr) {
      if (arr.length <= MAX_EDITS) return arr;
      return arr.slice(arr.length - MAX_EDITS);
    }

    function resetSelectionsForNewRange() {
      setNationalHolidays(new Set());
      setLeavesByEmployeeId(makeEmptyLeaves());
      setGenerated({ scheduleByDate: null, warnings: [], errors: [] });
      setEditPast([]);
      setEditFuture([]);
    }

    function setRangeFromInputs(startYYYYMM, endYYYYMM) {
      const start = parseMonthKey(startYYYYMM);
      const end = parseMonthKey(endYYYYMM);

      if (!start || !end) {
        setRangeError("Please pick both a start month and an end month.");
        return false;
      }
      if (compareMonth(end, start) < 0) {
        setRangeError(
          `The end month (${monthKeyOf(end)}) is before the start month (${monthKeyOf(start)}). Please pick an end month on or after the start.`
        );
        return false;
      }

      const nextRange = { start, end };
      const count = monthsInRangeCount(nextRange);
      if (count > MAX_RANGE_MONTHS) {
        setRangeError(
          `Range is ${count} months; the maximum allowed is ${MAX_RANGE_MONTHS}. Please pick a shorter range.`
        );
        return false;
      }

      setRangeError(null);
      setRange(nextRange);
      setActiveMonth(start);
      resetSelectionsForNewRange();
      return true;
    }

    function setActiveMonthFromInput(yyyymm) {
      const parsed = parseMonthKey(yyyymm);
      if (!parsed) return;
      setActiveMonth(clampActiveMonth(parsed, range));
    }

    function stepActiveMonth(delta) {
      const list = monthsInRange(range);
      const idx = list.findIndex((m) => compareMonth(m, activeMonth) === 0);
      const nextIdx = Math.max(0, Math.min(list.length - 1, (idx >= 0 ? idx : 0) + delta));
      setActiveMonth(list[nextIdx] ?? range.start);
    }

    function addNationalHoliday(isoDate) {
      if (!isInRange(isoDate, range)) return;
      setNationalHolidays((prev) => {
        const next = new Set(prev);
        next.add(isoDate);
        return next;
      });
    }

    function removeNationalHoliday(isoDate) {
      setNationalHolidays((prev) => {
        const next = new Set(prev);
        next.delete(isoDate);
        return next;
      });
    }

    function addEmployeeLeave(employeeId, isoDate) {
      if (!isInRange(isoDate, range)) return;
      setLeavesByEmployeeId((prev) => {
        const next = { ...prev };
        const set = new Set(next[employeeId] ?? []);
        set.add(isoDate);
        next[employeeId] = set;
        return next;
      });
    }

    function removeEmployeeLeave(employeeId, isoDate) {
      setLeavesByEmployeeId((prev) => {
        const next = { ...prev };
        const set = new Set(next[employeeId] ?? []);
        set.delete(isoDate);
        next[employeeId] = set;
        return next;
      });
    }

    async function generate() {
      const result = generateSchedule({
        range,
        leavesByEmployeeId,
        nationalHolidays: Array.from(nationalHolidays),
        history,
      });

      const historyNote =
        (history?.monthsUsed?.length ?? 0) > 0
          ? `History balancing enabled (used ${history.monthsUsed.length} month(s): ${history.monthsUsed.join(", ")}).`
          : "History balancing not used (no prior uploaded CSVs found).";

      const warnings = [historyNote, ...(result.warnings ?? [])];

      setGenerated({
        scheduleByDate: result.scheduleByDate,
        warnings,
        errors: result.errors,
      });

      setEditPast([]);
      setEditFuture([]);

      return result;
    }

    function findBucketForEmployee(day, employeeId) {
      for (const shift of Object.keys(day.assignments ?? {})) {
        if ((day.assignments?.[shift] ?? []).includes(employeeId)) return shift;
      }
      if ((day.leaveEmployeeIds ?? []).includes(employeeId)) return EXTRA.LEAVE;
      if ((day.compOffEmployeeIds ?? []).includes(employeeId)) return EXTRA.COMPOFF;
      return null;
    }

    function recomputeDayDerived(day) {
      day.anyLeaveApplied = (day.leaveEmployeeIds ?? []).length > 0;
      const unavailable = new Set([
        ...(day.weeklyOffEmployeeIds ?? []),
        ...(day.leaveEmployeeIds ?? []),
        ...(day.compOffEmployeeIds ?? []),
      ]);
      day.availableEmployeeIds = EMPLOYEES.map((e) => e.id).filter((id) => !unavailable.has(id));
    }

    function applyIntraDayMove({ scheduleByDate, isoDate, employeeId, toBucket }) {
      const day = scheduleByDate?.[isoDate];
      if (!day) return { nextScheduleByDate: scheduleByDate, fromBucket: null, changed: false };

      const fromBucket = findBucketForEmployee(day, employeeId);
      if (fromBucket === toBucket) {
        return { nextScheduleByDate: scheduleByDate, fromBucket, changed: false };
      }

      const nextSchedule = { ...scheduleByDate };
      const nextDay = {
        ...day,
        assignments: { ...day.assignments },
        leaveEmployeeIds: [...(day.leaveEmployeeIds ?? [])],
        compOffEmployeeIds: [...(day.compOffEmployeeIds ?? [])],
        availableEmployeeIds: [...(day.availableEmployeeIds ?? [])],
      };

      for (const shift of Object.keys(nextDay.assignments)) {
        nextDay.assignments[shift] = [...(nextDay.assignments[shift] ?? [])];
      }

      for (const shift of Object.keys(nextDay.assignments)) {
        nextDay.assignments[shift] = (nextDay.assignments[shift] ?? []).filter((id) => id !== employeeId);
      }
      nextDay.leaveEmployeeIds = (nextDay.leaveEmployeeIds ?? []).filter((id) => id !== employeeId);
      nextDay.compOffEmployeeIds = (nextDay.compOffEmployeeIds ?? []).filter((id) => id !== employeeId);

      if (toBucket === EXTRA.LEAVE) {
        if (!nextDay.leaveEmployeeIds.includes(employeeId)) nextDay.leaveEmployeeIds.push(employeeId);
      } else if (toBucket === EXTRA.COMPOFF) {
        if (!nextDay.compOffEmployeeIds.includes(employeeId)) nextDay.compOffEmployeeIds.push(employeeId);
      } else {
        if (!(nextDay.assignments[toBucket] ?? []).includes(employeeId)) {
          nextDay.assignments[toBucket] = [...(nextDay.assignments[toBucket] ?? []), employeeId];
        }
      }

      recomputeDayDerived(nextDay);
      nextSchedule[isoDate] = nextDay;

      return { nextScheduleByDate: nextSchedule, fromBucket, changed: true };
    }

    function updateAssignment({ fromIsoDate, toIsoDate, fromShift, toShift, employeeId }) {
      setGenerated((prev) => {
        if (!prev.scheduleByDate) return prev;
        if (fromIsoDate !== toIsoDate) return prev;

        const isoDate = fromIsoDate;
        const result = applyIntraDayMove({
          scheduleByDate: prev.scheduleByDate,
          isoDate,
          employeeId,
          toBucket: toShift,
        });

        if (!result.changed) return prev;

        const action = {
          isoDate,
          employeeId,
          from: result.fromBucket ?? fromShift ?? null,
          to: toShift,
        };
        if (action.from && action.to) {
          setEditPast((p) => capEdits([...p, action]));
          setEditFuture([]);
        }

        const validation = validateSchedule(result.nextScheduleByDate);

        return {
          ...prev,
          scheduleByDate: result.nextScheduleByDate,
          warnings: validation.warnings,
          errors: validation.errors,
        };
      });
    }

    function undoEdit() {
      const action = editPast[editPast.length - 1];
      if (!action) return;

      setGenerated((prev) => {
        if (!prev.scheduleByDate) return prev;
        const result = applyIntraDayMove({
          scheduleByDate: prev.scheduleByDate,
          isoDate: action.isoDate,
          employeeId: action.employeeId,
          toBucket: action.from,
        });
        if (!result.changed) return prev;

        const validation = validateSchedule(result.nextScheduleByDate);
        return {
          ...prev,
          scheduleByDate: result.nextScheduleByDate,
          warnings: validation.warnings,
          errors: validation.errors,
        };
      });

      setEditPast((p) => p.slice(0, -1));
      setEditFuture((f) => capEdits([...f, action]));
    }

    function redoEdit() {
      const action = editFuture[editFuture.length - 1];
      if (!action) return;

      setGenerated((prev) => {
        if (!prev.scheduleByDate) return prev;
        const result = applyIntraDayMove({
          scheduleByDate: prev.scheduleByDate,
          isoDate: action.isoDate,
          employeeId: action.employeeId,
          toBucket: action.to,
        });
        if (!result.changed) return prev;

        const validation = validateSchedule(result.nextScheduleByDate);
        return {
          ...prev,
          scheduleByDate: result.nextScheduleByDate,
          warnings: validation.warnings,
          errors: validation.errors,
        };
      });

      setEditFuture((f) => f.slice(0, -1));
      setEditPast((p) => capEdits([...p, action]));
    }

    const rangeMonths = monthsInRange(range);

    return {
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
      generated,
      generate,
      updateAssignment,
      canUndo: editPast.length > 0,
      canRedo: editFuture.length > 0,
      undoEdit,
      redoEdit,
      history,
      historyStatus,
      historyLibraryMonths,
      refreshHistory,
    };
  }, [
    range,
    rangeError,
    activeMonth,
    nationalHolidays,
    leavesByEmployeeId,
    generated,
    history,
    historyStatus,
    historyLibraryMonths,
    editPast,
    editFuture,
  ]);

  return <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>;
}
