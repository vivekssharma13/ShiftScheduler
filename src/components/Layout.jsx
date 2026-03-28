import React from "react";
import { NavLink } from "react-router-dom";
import "../styles/app.css";

export default function Layout({ title, subtitle, children }) {
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
          <NavLink
            to="/schedule"
            className={({ isActive }) => (isActive ? "step active" : "step")}
          >
            Calendar
          </NavLink>
          <NavLink
            to="/export"
            className={({ isActive }) => (isActive ? "step active" : "step")}
          >
            Download
          </NavLink>
          </nav>
        </div>
      </header>

      <main className="main">
        <div className="pageHead">
          <h1 className="pageTitle">{title}</h1>
          {subtitle ? <p className="sub">{subtitle}</p> : null}
        </div>
        {children}
      </main>

      <footer className="footer">
        <span>Rules-driven, best-effort scheduling with warnings.</span>
      </footer>
    </div>
  );
}
