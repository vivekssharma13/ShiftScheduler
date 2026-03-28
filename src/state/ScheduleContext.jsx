import React, { useEffect, useMemo, useState } from "react";
import { EMPLOYEES } from "../constants/employees.js";
import { generateSchedule } from "../utils/scheduler.js";
import { validateSchedule } from "../utils/validation.js";
import { loadHistoryStats } from "../utils/history.js";
import { listHistoryMonths } from "../utils/historyDb.js";
import { ScheduleContext } from "./scheduleStore.js";

function defaultMonth() {
  const now = new Date();
  return { year: now.getFullYear(), monthIndex: now.getMonth() };
}

function makeEmptyLeaves() {
  const leaves = {};
  for (const e of EMPLOYEES) leaves[e.id] = new Set();
  return leaves;
}

export function ScheduleProvider({ children }) {
  const [month, setMonth] = useState(defaultMonth());
  const [nationalHolidays, setNationalHolidays] = useState(new Set());
  const [leavesByEmployeeId, setLeavesByEmployeeId] = useState(makeEmptyLeaves());

  const [history, setHistory] = useState({ monthsUsed: [], statsByEmployeeId: {} });
  const [historyStatus, setHistoryStatus] = useState({ loading: false, error: null });
  const [historyLibraryMonths, setHistoryLibraryMonths] = useState([]);

  async function refreshHistory() {
    setHistoryStatus({ loading: true, error: null });
    try {
      const [loaded, months] = await Promise.all([
        loadHistoryStats({ year: month.year, monthIndex: month.monthIndex, maxMonths: 6 }),
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
          loadHistoryStats({ year: month.year, monthIndex: month.monthIndex, maxMonths: 6 }),
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
  }, [month.year, month.monthIndex]);

  const value = useMemo(() => {
    const selectedMonthKey = `${month.year}-${String(month.monthIndex + 1).padStart(2, "0")}`;
    function isInSelectedMonth(isoDate) {
      const iso = String(isoDate ?? "").trim();
      return iso.length >= 7 && iso.slice(0, 7) === selectedMonthKey;
    }

    function setMonthFromInput(value) {
      // HTML month input: "YYYY-MM"
      const [y, m] = value.split("-").map((x) => Number(x));
      if (!y || !Number.isFinite(m)) return;
      setMonth({ year: y, monthIndex: m - 1 });

      // Reset selections when month changes (simplest/least surprising)
      setNationalHolidays(new Set());
      setLeavesByEmployeeId(makeEmptyLeaves());
      setGenerated({ scheduleByDate: null, warnings: [], errors: [] });
    }

    function addNationalHoliday(isoDate) {
      if (!isInSelectedMonth(isoDate)) return;
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
      if (!isInSelectedMonth(isoDate)) return;
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
        year: month.year,
        monthIndex: month.monthIndex,
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

      return result;
    }

    function updateAssignment({ fromIsoDate, toIsoDate, fromShift, toShift, employeeId }) {
      setGenerated((prev) => {
        if (!prev.scheduleByDate) return prev;
        const fromDay = prev.scheduleByDate[fromIsoDate];
        const toDay = prev.scheduleByDate[toIsoDate];
        if (!fromDay || !toDay) return prev;

        const nextSchedule = { ...prev.scheduleByDate };

        const nextFromDay = {
          ...fromDay,
          assignments: { ...fromDay.assignments },
        };
        const nextToDay =
          fromIsoDate === toIsoDate
            ? nextFromDay
            : {
                ...toDay,
                assignments: { ...toDay.assignments },
              };

        for (const shift of Object.keys(nextFromDay.assignments)) {
          nextFromDay.assignments[shift] = [...(nextFromDay.assignments[shift] ?? [])];
        }
        for (const shift of Object.keys(nextToDay.assignments)) {
          nextToDay.assignments[shift] = [...(nextToDay.assignments[shift] ?? [])];
        }

        nextFromDay.assignments[fromShift] = (nextFromDay.assignments[fromShift] ?? []).filter(
          (id) => id !== employeeId
        );
        if (!(nextToDay.assignments[toShift] ?? []).includes(employeeId)) {
          nextToDay.assignments[toShift] = [...(nextToDay.assignments[toShift] ?? []), employeeId];
        }

        nextSchedule[fromIsoDate] = nextFromDay;
        nextSchedule[toIsoDate] = nextToDay;

        // Re-validate after edits (best-effort; doesn’t rebuild the weekly plan)
        // To keep it cheap, we validate the whole schedule (small dataset).
        const validation = validateSchedule(nextSchedule);

        return {
          ...prev,
          scheduleByDate: nextSchedule,
          warnings: validation.warnings,
          errors: validation.errors,
        };
      });
    }

    return {
      month,
      setMonthFromInput,
      nationalHolidays,
      addNationalHoliday,
      removeNationalHoliday,
      leavesByEmployeeId,
      addEmployeeLeave,
      removeEmployeeLeave,
      generated,
      generate,
      updateAssignment,
      history,
      historyStatus,
      historyLibraryMonths,
      refreshHistory,
    };
  }, [month, nationalHolidays, leavesByEmployeeId, generated, history, historyStatus, historyLibraryMonths]);

  return <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>;
}
