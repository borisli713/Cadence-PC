# Cadence — Windows Desktop Shift Reporting & Fair Scheduling (Rust + Tauri)

Cadence is a **Windows desktop application** built with **Rust** (**Tauri v2**, native Windows notifications, system tray, native `.ics` export dialogs, Rust Fairness Engine & GitHub update checker), **React + TypeScript + Tailwind CSS**, and **Firebase (Firestore + Firebase Auth)** for verified shift reporting, manager schedule change approvals, one-click Accept All, and fairness-balanced overlap scheduling.

## Features

- **Verified Authentication**: Email/password sign-in and account registration with mandatory email verification (`emailVerified`), password reset, and Google Sign-In (`GoogleAuthProvider`) with automatic role provisioning (`managers` vs `staff`).
- **Overview Dashboard**: Live KPI tiles, quick actions to log shift reports or jump to approval queues, upcoming shifts, recent change requests, and latest shift reports.
- **My Schedule**: Personal assigned shift view with **Next Upcoming Shift Spotlight**, relative day badges (`Today`, `Tomorrow`, `In Xd`), `.ics` export via native Windows save dialog, Google Calendar template export, and change requests.
- **Schedule & Fairness Engine (Rust Backend)**:
  - Weekly and monthly team calendar views, filterable shift table (`All`, `Mine`, `Open`, `Overlaps`, `Completed`), and staff availability submissions (`Next Mon–Fri` / `Next 7 Days`).
  - Rust-powered Fairness Engine (`(totalHoursWorked + scheduledHours) / weeklyHoursTarget`, shift count, and `lastAssignedAt` tie-breaker) excluding overlapping shifts and approved time off.
  - One-click **Generate Week**, **Arrange Overlaps**, **Assign Open**, **Add Shift**, **Edit Shift**, and customizable **Week Slots** (`Morning`, `Midday`, `Closing`).
- **Shift Reports**: Staff clock-in/out & handoff reporting with break deduction, automatic net hours calculation, optional linking to scheduled shifts, and manager **Verify / Flag** approval that credits verified hours to the staff ledger.
- **Manager Approvals (One-Click Accept All) & Shift History**: Individual Approve/Deny with optional review notes, one-click **Accept All** batch execution in Firestore, and searchable archive of resolved requests.
- **Time Off Requests**: Staff date-range submissions and withdrawals; manager approvals/denials that notify staff and protect approved days in fairness scheduling.
- **Team Hours Ledger**: Stacked SVG visualization of verified logged vs scheduled hours against weekly targets, roster staff additions, role toggles (`Promote to Manager` / `Set Role to Staff`), and sample workspace seeding.
- **Notifications & Windows Tray**: Real-time Firestore alerts dispatched to native Windows desktop toast notifications alongside a system tray menu (`Open Cadence`, `Check for Updates`, `Quit Cadence`).

## Tech Stack

- **Desktop Core (Rust)**: Tauri v2 (`src-tauri/src/` — `fairness.rs`, `ics.rs`, `updater.rs`, `models.rs`, `lib.rs`)
- **Frontend UI**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons
- **Backend & Security Rules**: Cloud Firestore with `firestore.rules` & Firebase Authentication

## Automated Windows Releases (`1.0.0` + `0.0.1` per update)

The GitHub Actions workflow builds and tests both the TypeScript/React frontend and Rust Fairness Engine (`cargo test`), packages Windows NSIS (`.exe`), MSI (`.msi`), and portable `.exe` artifacts via Tauri on `windows-latest`, and publishes them to the repository's **GitHub Releases** page starting at `v1.0.0` and incrementing by `+0.0.1` for each update.
