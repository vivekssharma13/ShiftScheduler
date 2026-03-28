# Shift Scheduler

A small React (Vite) app to generate and review monthly shift schedules (A/B/C) with fixed weekly-offs.

## What it does

- Step 1: Pick the target month, add national holidays, and add employee leave dates.
- Step 2: Generate a schedule and review it in a calendar view (drag & drop to edit assignments).
- Step 3: Export the final schedule as CSV.

## History uploads

You can upload prior months’ schedule CSVs to help the scheduler balance future months.
Uploads are stored in the browser (IndexedDB) so they persist across refresh.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
