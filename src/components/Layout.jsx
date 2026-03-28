import React from "react";
import { NavLink, useLocation, useSearchParams } from "react-router-dom";
import "../styles/app.css";
import { useSchedule } from "../state/scheduleStore.js";

export default function Layout({ title, subtitle, children }) {
  const { generated } = useSchedule();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const hasSchedule = Boolean(generated?.scheduleByDate);
  const isScheduleRoute = location.pathname === "/schedule";
  const isExportRoute = location.pathname === "/export";
  const isHistoryView = isScheduleRoute && Boolean(searchParams.get("history"));

  const canOpenCalendar = hasSchedule || isHistoryView || isScheduleRoute;
  const canOpenDownload = hasSchedule || isExportRoute;

  return (
    <div className="app">
      <header className="top">
        <div className="brandCentered">
          <div className="appName">Shift Scheduler</div>
          <nav className="steps" aria-label="Pages">
          <NavLink
            to="/holidays"
            className={({ isActive }) => (isActive ? "step active" : "step")}
          >
            Holidays
          </NavLink>
            {canOpenCalendar ? (
              <NavLink
                to="/schedule"
                className={({ isActive }) => (isActive ? "step active" : "step")}
              >
                Calendar
              </NavLink>
            ) : (
              <span className="step disabled" aria-disabled="true" title="Generate a schedule first">
                Calendar
              </span>
            )}

            {canOpenDownload ? (
              <NavLink
                to="/export"
                className={({ isActive }) => (isActive ? "step active" : "step")}
              >
                Download
              </NavLink>
            ) : (
              <span className="step disabled" aria-disabled="true" title="Generate a schedule first">
                Download
              </span>
            )}
          </nav>
        </div>
      </header>

      <main className="main">
        {title || subtitle ? (
          <div className="pageHead">
            {title ? <h1 className="pageTitle">{title}</h1> : null}
            {subtitle ? <p className="sub">{subtitle}</p> : null}
          </div>
        ) : null}
        {children}
      </main>

      <footer className="footer">
        <span>Rules-driven, best-effort scheduling with warnings.</span>
      </footer>
    </div>
  );
}
