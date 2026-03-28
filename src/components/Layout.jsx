import React from "react";
import { NavLink } from "react-router-dom";
import "../styles/app.css";

export default function Layout({ title, subtitle, children }) {
  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <div className="badge">Shift Scheduler</div>
          <div className="titles">
            <h1 className="pageTitle">{title}</h1>
            {subtitle ? <p className="sub">{subtitle}</p> : null}
          </div>
        </div>

        <nav className="steps" aria-label="Pages">
          <NavLink
            to="/holidays"
            className={({ isActive }) => (isActive ? "step active" : "step")}
          >
            1. Holidays
          </NavLink>
          <NavLink
            to="/schedule"
            className={({ isActive }) => (isActive ? "step active" : "step")}
          >
            2. Calendar
          </NavLink>
          <NavLink
            to="/export"
            className={({ isActive }) => (isActive ? "step active" : "step")}
          >
            3. Download
          </NavLink>
        </nav>
      </header>

      <main className="main">{children}</main>

      <footer className="footer">
        <span>Rules-driven, best-effort scheduling with warnings.</span>
      </footer>
    </div>
  );
}
