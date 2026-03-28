import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import { buildScheduleCsv, downloadCsv } from "../utils/csv.js";
import { useSchedule } from "../state/scheduleStore.js";

function monthLabel({ year, monthIndex }) {
  const mm = String(monthIndex + 1).padStart(2, "0");
  return `${year}-${mm}`;
}

export default function ExportPage() {
  const nav = useNavigate();
  const { month, generated } = useSchedule();

  const canDownload = Boolean(generated.scheduleByDate);

  const summary = useMemo(() => {
    const warningCount = generated.warnings?.length ?? 0;
    const errorCount = generated.errors?.length ?? 0;
    return { warningCount, errorCount };
  }, [generated]);

  return (
    <Layout
      title="3) Download"
      subtitle="Review the final schedule summary and export to CSV."
    >
      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="h">Schedule for {monthLabel(month)}</div>
            <p className="muted" style={{ marginTop: 6 }}>
              Warnings: {summary.warningCount} · Errors: {summary.errorCount}
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

                const { csvText, monthLabel } = buildScheduleCsv({
                  scheduleByDate: generated.scheduleByDate,
                  year: month.year,
                  monthIndex: month.monthIndex,
                  warnings: generated.warnings,
                  errors: generated.errors,
                });

                downloadCsv({ csvText, fileName: `Shift-Schedule-${monthLabel}.csv` });
              }}
            >
              Download CSV
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
