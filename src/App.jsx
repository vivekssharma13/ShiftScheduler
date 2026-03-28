import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ScheduleProvider } from "./state/ScheduleContext.jsx";
import HolidaysPage from "./pages/HolidaysPage.jsx";
import SchedulePage from "./pages/SchedulePage.jsx";
import ExportPage from "./pages/ExportPage.jsx";

export default function App() {
  return (
    <ScheduleProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/holidays" replace />} />
          <Route path="/holidays" element={<HolidaysPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="*" element={<Navigate to="/holidays" replace />} />
        </Routes>
      </BrowserRouter>
    </ScheduleProvider>
  );
}
