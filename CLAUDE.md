# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CANU Grow is a volunteer/member scheduling web app for the University of Manitoba greenhouse program. It's a static single-page app (no build step) backed by Supabase for auth, database, and RLS.

## Architecture

- **Static SPA**: `index.html` loads `config.js` → `api.js` → `app.js` plus `styles.css`
- **Auth**: Supabase magic link (email OTP) with a join code gate for new members
- **Database**: Supabase (PostgreSQL) with Row Level Security
- **Hosting**: GitHub Pages (or any static host)

### Key Files

| File | Purpose |
|------|---------|
| `config.js` | Supabase URL and anon key |
| `api.js` | All Supabase queries (auth, members, jobs, shifts, signups, config) |
| `app.js` | UI logic, view rendering, event handlers |
| `index.html` | SPA shell with all views and modals |
| `styles.css` | Full design system (CSS variables, greenhouse aesthetic) |
| `supabase-schema.sql` | PostgreSQL schema, RLS policies, helper functions |

### Data Model

- **members**: users (email, display_name, is_admin, total_shifts)
- **jobs**: reusable templates (title, category, description, default_capacity)
- **shifts**: scheduled instances of jobs (date, start_time, end_time, capacity)
- **signups**: members assigned to shifts (member_id, shift_id, status)
- **config**: key-value settings (join_code, org_name)

### Roles

- **Admin**: can create jobs, schedule shifts, assign members, view all members, edit/delete shifts
- **Member**: can browse job board, sign up for open shifts, view own schedule

### Categories

watering, planting, harvesting, maintenance, monitoring — used across jobs, shifts, and CSS color coding.

## Development

No build step. Open `index.html` in a browser or serve with any static server:

```
python3 -m http.server 8000
```

Update `config.js` with real Supabase credentials before testing.

## Conventions

- Terminology: "Members" (not volunteers/employees)
- All API calls use async/await via the Supabase JS SDK (loaded from CDN)
- UI updates go through render functions (e.g., `renderWeekGrid()`, `renderJobBoard()`)
- Toast notifications via `showToast(message, type)`
- Confirm dialogs via `showConfirm(title, message, callback)`
