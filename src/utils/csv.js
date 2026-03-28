import { format } from "date-fns";

function csvEscape(value) {
  const s = String(value ?? "");
  // Quote if it contains comma, quote, or newline.
  if (/[\n\r",]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildScheduleCsv({ scheduleByDate, year, monthIndex, warnings = [], errors = [] }) {
  const monthLabel = format(new Date(year, monthIndex, 1), "yyyy-MM");

  const header = [
    "Date",
    "Day",
    "A Shift",
    "B Shift",
    "C Shift",
    "National Holiday",
    "Comp Off",
    "Weekly Off",
    "Leave",
  ];

  const rows = [header];

  const isoDates = Object.keys(scheduleByDate).sort();
  for (const isoDate of isoDates) {
    const day = scheduleByDate[isoDate];
    rows.push([
      isoDate,
      format(new Date(isoDate), "EEE"),
      (day.assignments.A ?? []).join(", "),
      (day.assignments.B ?? []).join(", "),
      (day.assignments.C ?? []).join(", "),
      day.nationalHoliday ? "Yes" : "No",
      (day.compOffEmployeeIds ?? []).join(", "),
      (day.weeklyOffEmployeeIds ?? []).join(", "),
      (day.leaveEmployeeIds ?? []).join(", "),
    ]);
  }

  // Add a blank line then notes (still same CSV format; easy to ignore when parsing history).
  rows.push([]);
  rows.push(["Type", "Message"]);
  for (const e of errors) rows.push(["Error", e]);
  for (const w of warnings) rows.push(["Warning", w]);

  const csvText = rows
    .map((r) => r.map(csvEscape).join(","))
    .join("\n");

  return { csvText, monthLabel };
}

export function downloadCsv({ csvText, fileName }) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
