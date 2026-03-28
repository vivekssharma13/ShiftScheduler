import { listHistoryEntries } from "./historyDb.js";

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let i = 0;
  let inQuotes = false;

  while (i < line.length) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
      continue;
    }

    if (ch === ',') {
      out.push(cur);
      cur = "";
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    cur += ch;
    i += 1;
  }

  out.push(cur);
  return out;
}


function parseCsv(text) {
  const lines = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) return [];

  const rows = [];
  for (const line of lines) {
    rows.push(parseCsvLine(line));
  }
  return rows;
}

function splitIds(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function monthKeyFromIso(iso) {
  return iso?.slice(0, 7);
}

function monthNum(monthKey) {
  // YYYY-MM -> YYYY*12 + (MM-1)
  const [y, m] = String(monthKey).split("-").map((x) => Number(x));
  if (!y || !m) return null;
  return y * 12 + (m - 1);
}

function monthKeyFromFileName(name) {
  const m = String(name).match(/(\d{4}-\d{2})/);
  return m ? m[1] : null;
}

function monthKeyToYearMonth(monthKey) {
  const [y, m] = String(monthKey).split("-").map((x) => Number(x));
  if (!y || !m) return null;
  return { year: y, monthIndex: m - 1 };
}

function ensureDayShape(day) {
  return {
    isoDate: day.isoDate,
    assignments: day.assignments ?? { A: [], B: [], C: [] },
    availableEmployeeIds: day.availableEmployeeIds ?? [],
    weeklyOffEmployeeIds: day.weeklyOffEmployeeIds ?? [],
    leaveEmployeeIds: day.leaveEmployeeIds ?? [],
    compOffEmployeeIds: day.compOffEmployeeIds ?? [],
    nationalHoliday: Boolean(day.nationalHoliday),
    anyLeaveApplied: Boolean(day.anyLeaveApplied),
  };
}

export function parseScheduleCsvToScheduleByDate({ csvText, monthKey }) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return {};

  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const idx = (name) => header.indexOf(name);

  const dateI = idx("date");
  const aI = idx("a shift");
  const bI = idx("b shift");
  const cI = idx("c shift");
  const holidayI = idx("national holiday");
  const compI = idx("comp off");
  const weeklyI = idx("weekly off");
  const leaveI = idx("leave");

  // If this doesn't look like our schedule CSV, return empty.
  if (dateI === -1 || aI === -1 || bI === -1 || cI === -1) return {};

  const scheduleByDate = {};
  const ym = monthKeyToYearMonth(monthKey);

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const first = String(row[0] ?? "").trim().toLowerCase();
    if (first === "type") break;

    const isoDate = String(row[dateI] ?? "").trim();
    if (!isoDate) continue;

    // Optionally filter to the provided monthKey.
    if (ym) {
      const mk = monthKeyFromIso(isoDate);
      if (mk !== monthKey) continue;
    }

    const assignments = {
      A: splitIds(row[aI]),
      B: splitIds(row[bI]),
      C: splitIds(row[cI]),
    };

    const weeklyOffEmployeeIds = weeklyI !== -1 ? splitIds(row[weeklyI]) : [];
    const leaveEmployeeIds = leaveI !== -1 ? splitIds(row[leaveI]) : [];
    const compOffEmployeeIds = compI !== -1 ? splitIds(row[compI]) : [];
    const nationalHoliday =
      holidayI !== -1 ? String(row[holidayI] ?? "").trim().toLowerCase() === "yes" : false;

    const unavailable = new Set([...weeklyOffEmployeeIds, ...leaveEmployeeIds, ...compOffEmployeeIds]);
    const availableEmployeeIds = [...new Set([...assignments.A, ...assignments.B, ...assignments.C])].filter(
      (id) => !unavailable.has(id)
    );

    scheduleByDate[isoDate] = ensureDayShape({
      isoDate,
      assignments,
      availableEmployeeIds,
      weeklyOffEmployeeIds,
      leaveEmployeeIds,
      compOffEmployeeIds,
      nationalHoliday,
      anyLeaveApplied: leaveEmployeeIds.length > 0,
    });
  }

  return scheduleByDate;
}

export function computeStatsFromScheduleByDate(scheduleByDate) {
  const statsByEmployeeId = {};

  const ensure = (id) => {
    if (!statsByEmployeeId[id]) statsByEmployeeId[id] = { A: 0, B: 0, C: 0, compOffs: 0 };
    return statsByEmployeeId[id];
  };

  for (const day of Object.values(scheduleByDate ?? {})) {
    for (const id of day.assignments?.A ?? []) ensure(id).A += 1;
    for (const id of day.assignments?.B ?? []) ensure(id).B += 1;
    for (const id of day.assignments?.C ?? []) ensure(id).C += 1;
    for (const id of day.compOffEmployeeIds ?? []) ensure(id).compOffs += 1;
  }

  return statsByEmployeeId;
}

export async function loadHistoryStats({ year, monthIndex, maxMonths = 6 }) {
  // Reads history from IndexedDB uploads (persists across refresh).
  const entries = await listHistoryEntries();
  if (entries.length === 0) return { monthsUsed: [], statsByEmployeeId: {} };

  const targetMonthKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  const targetNum = monthNum(targetMonthKey);

  // Choose up to maxMonths that are strictly before the target month.
  const eligible = entries
    .map((e) => ({ monthKey: e.monthKey, num: monthNum(e.monthKey), csvText: e.csvText }))
    .filter((x) => x.num !== null && targetNum !== null && x.num < targetNum)
    .sort((a, b) => b.num - a.num)
    .slice(0, maxMonths)
    .sort((a, b) => a.num - b.num);

  const statsByEmployeeId = {};
  const monthsUsed = [];

  for (const item of eligible) {
    const scheduleByDate = parseScheduleCsvToScheduleByDate({ csvText: item.csvText, monthKey: item.monthKey });
    const mk = item.monthKey;
    if (mk && !monthsUsed.includes(mk)) monthsUsed.push(mk);

    const monthStats = computeStatsFromScheduleByDate(scheduleByDate);
    for (const [id, s] of Object.entries(monthStats)) {
      statsByEmployeeId[id] = statsByEmployeeId[id] || { A: 0, B: 0, C: 0, compOffs: 0 };
      statsByEmployeeId[id].A += s.A;
      statsByEmployeeId[id].B += s.B;
      statsByEmployeeId[id].C += s.C;
      statsByEmployeeId[id].compOffs += s.compOffs;
    }
  }

  monthsUsed.sort();
  return { monthsUsed, statsByEmployeeId };
}
