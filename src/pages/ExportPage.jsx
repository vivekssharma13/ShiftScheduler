import React, { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import { buildScheduleCsv } from "../utils/csv.js";
import { useSchedule } from "../state/scheduleStore.js";
import { formatMonthLabel, monthKeyOf } from "../utils/date.js";
import { buildScheduleZip, downloadBlob } from "../utils/zipBundle.js";

function sliceScheduleByMonth(scheduleByDate, monthKey) {
  const out = {};
  for (const [iso, day] of Object.entries(scheduleByDate ?? {})) {
    if (iso.startsWith(monthKey)) out[iso] = day;
  }
  return out;
}

function filterMessagesForMonth(messages, monthKey) {
  if (!messages) return [];
  // Messages that carry a YYYY-MM-DD or YYYY-MM prefix for this month go in.
  // Messages without any such token are range-level and included for every month.
  return messages.filter((m) => {
    const hasAnyMonthRef = /\b\d{4}-\d{2}\b/.test(m);
    if (!hasAnyMonthRef) return true;
    return m.includes(monthKey);
  });
}

export default function ExportPage() {
  const nav = useNavigate();
  const { range, rangeMonths, generated } = useSchedule();

  const canDownload = Boolean(generated.scheduleByDate);

  useEffect(() => {
    if (!generated?.scheduleByDate) nav("/holidays", { replace: true });
  }, [generated?.scheduleByDate, nav]);

  const summary = useMemo(() => {
    const warningCount = generated.warnings?.length ?? 0;
    const errorCount = generated.errors?.length ?? 0;
    return { warningCount, errorCount };
  }, [generated]);

  const rangeLabel =
    rangeMonths && rangeMonths.length > 0
      ? `${monthKeyOf(rangeMonths[0])} to ${monthKeyOf(rangeMonths[rangeMonths.length - 1])}`
      : "";

  return (
    <Layout
      title="Download"
      subtitle="Review the final schedule summary and export to a ZIP of per-month CSVs."
    >
      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="h">
              Schedule for {formatMonthLabel(range.start)}
              {rangeMonths && rangeMonths.length > 1 ? ` – ${formatMonthLabel(range.end)}` : ""}
            </div>
            <p className="muted" style={{ marginTop: 6 }}>
              Months in bundle: {rangeMonths?.length ?? 0} · Warnings: {summary.warningCount} · Errors:{" "}
              {summary.errorCount}
            </p>
          </div>
          <div className="actions">
            <button className="btn" onClick={() => nav("/schedule")}>
              Back
            </button>
            <button
              className="btn primary"
              disabled={!canDownload}
              onClick={async () => {
                if (!generated.scheduleByDate) return;

                const perMonthCsvs = [];
                for (const m of rangeMonths ?? []) {
                  const mk = monthKeyOf(m);
                  const sliced = sliceScheduleByMonth(generated.scheduleByDate, mk);
                  if (Object.keys(sliced).length === 0) continue;
                  const { csvText } = buildScheduleCsv({
                    scheduleByDate: sliced,
                    year: m.year,
                    monthIndex: m.monthIndex,
                    warnings: filterMessagesForMonth(generated.warnings, mk),
                    errors: filterMessagesForMonth(generated.errors, mk),
                  });
                  perMonthCsvs.push({ monthKey: mk, csvText });
                }

                const blob = await buildScheduleZip({ perMonthCsvs, rangeLabel });
                const fileName =
                  perMonthCsvs.length === 1
                    ? `Shift-Schedule-${perMonthCsvs[0].monthKey}.zip`
                    : `Shift-Schedule-${monthKeyOf(rangeMonths[0])}_to_${monthKeyOf(
                        rangeMonths[rangeMonths.length - 1]
                      )}.zip`;
                downloadBlob(blob, fileName);
              }}
            >
              Download ZIP
            </button>
          </div>
        </div>

        {!canDownload ? (
          <div className="alert">
            <strong>No schedule generated yet.</strong>
            <div className="muted">Go to page 1 and click “Generate Schedule”.</div>
          </div>
        ) : (
          <div className="split">
            <div>
              <h2 className="h">Errors</h2>
              {generated.errors.length === 0 ? (
                <p className="muted">No errors.</p>
              ) : (
                <ul className="warnList">
                  {generated.errors.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h2 className="h">Warnings</h2>
              {generated.warnings.length === 0 ? (
                <p className="muted">No warnings.</p>
              ) : (
                <ul className="warnList">
                  {generated.warnings.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>
    </Layout>
  );
}
