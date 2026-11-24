# Proposal

## Why

New parents need a clear, trustworthy, and low-friction way to track their baby's immunizations from birth through early childhood—knowing which vaccines are due, when to book them, what precautions to follow, and what has already been administered—without relying on ad-heavy commercial apps or cloud storage. BabyLog already holds the baby's birth date and daily health records, making a built-in self-hosted vaccine management module a natural next step.

## What Changes

- Introduce a dedicated **Vaccine Management** module (`/vaccines` and `/api/vaccines/*`) scoped to the single Baby Profile, using a simple three-state dose lifecycle (`pending`, `scheduled`, `completed`) with timezone-aware derived alert states (`upcoming`, `due_soon`, `overdue`, `scheduled_soon`, `scheduled_overdue`).
- Embed an authoritative built-in vaccine reference catalog covering China's current National Immunization Program (NIP, 8 vaccine types / 22 doses, including the 2025 updated DTaP schedule at 2/4/6/18 months and 6 years) plus 5 common conflict-free self-paid (optional) vaccine templates (PCV13, RV5, EV71, Varicella, Pediatric Influenza), along with support for custom vaccine doses.
- Lazily and idempotently seed the 22 default NIP doses for the baby profile on first access; provide a prominent, medically safe one-tap confirmation prompt for the two birth hospital vaccines (HepB dose 1 and BCG) rather than silently marking them completed.
- Provide vaccination progress tracking, an age-stage timeline view (with batch booking and historical batch completion), a monthly vaccination calendar view, smart clinic-name recall, RFC 5545 `.ics` calendar export for system-level reminders, and quick navigation to log post-vaccination temperature in Health records (keeping `/dashboard` dedicated to daily care insights).
- Prominently display medical reference disclaimers and vaccine-specific risk/precaution warnings reminding parents never to rely solely on this app and always to verify schedules against the official Vaccination Certificate and clinic doctor advice.

## Capabilities

### New Capabilities

- `vaccine-management`: Full immunization schedule, optional/custom dose management, appointment booking, vaccination recording, derived reminder states, progress summaries, calendar visualization, `.ics` export, and medical risk disclaimers scoped to the Baby Profile.

### Modified Capabilities

## Impact

- **Database**: Adds `00003_vaccines.sql` (`vaccine_doses` table and indexes, cascading on `baby_profiles`).
- **Backend**: Adds `backend/internal/vaccines` package (catalog, date math, validation, GORM store/service with `WithClock`) and `backend/internal/httpapi/vaccines_handler.go`; wires routes in `router.go` and `serve.go`.
- **Frontend**: Adds `/vaccines` route, `src/lib/vaccines.ts`, `src/lib/ics.ts`, `src/components/ui/checkbox.tsx`, and `src/components/vaccines/*`; adds a dedicated `成长计划` sidebar group (keeping `/dashboard` focused on daily care insights) and links `/reminders` to `/vaccines`.
- **Docs**: Updates `GLOSSARY.md` with vaccine domain terminology.
