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
