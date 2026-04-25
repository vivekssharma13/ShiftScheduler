import { addDays, format, getDay, isSameDay, parseISO, startOfMonth } from "date-fns";

export function toISODate(date) {
  return format(date, "yyyy-MM-dd");
}

export function fromISODate(isoDate) {
  return parseISO(isoDate);
}

export function isSaturday(date) {
  return getDay(date) === 6;
}

export function isSunday(date) {
  return getDay(date) === 0;
}

export function eachDayOfMonth(year, monthIndex) {
  const first = startOfMonth(new Date(year, monthIndex, 1));
  const days = [];

  for (let d = new Date(first); d.getMonth() === monthIndex; d = addDays(d, 1)) {
    days.push(new Date(d));
  }

  return days;
}

export function sameISODate(aIso, bIso) {
  return isSameDay(parseISO(aIso), parseISO(bIso));
}

export const MAX_RANGE_MONTHS = 12;

export function monthKeyOf({ year, monthIndex }) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

export function parseMonthKey(key) {
  const [y, m] = String(key ?? "").split("-").map((x) => Number(x));
  if (!y || !m) return null;
  return { year: y, monthIndex: m - 1 };
}

export function compareMonth(a, b) {
  if (a.year !== b.year) return a.year - b.year;
  return a.monthIndex - b.monthIndex;
}

export function monthsInRange(range) {
  const out = [];
  if (!range?.start || !range?.end) return out;
  if (compareMonth(range.start, range.end) > 0) return out;
  let y = range.start.year;
  let m = range.start.monthIndex;
  while (y < range.end.year || (y === range.end.year && m <= range.end.monthIndex)) {
    out.push({ year: y, monthIndex: m });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

export function monthsInRangeCount(range) {
  return monthsInRange(range).length;
}

export function eachDayOfRange(range) {
  return monthsInRange(range).flatMap(({ year, monthIndex }) => eachDayOfMonth(year, monthIndex));
}

export function isInRange(isoDate, range) {
  const iso = String(isoDate ?? "").trim();
  if (iso.length < 7) return false;
  const key = iso.slice(0, 7);
  const parsed = parseMonthKey(key);
  if (!parsed || !range?.start || !range?.end) return false;
  return compareMonth(parsed, range.start) >= 0 && compareMonth(parsed, range.end) <= 0;
}

export function formatMonthLabel({ year, monthIndex }) {
  return format(new Date(year, monthIndex, 1), "MMMM yyyy");
}
