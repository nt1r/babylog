# vaccine-management Specification

## Purpose

Manages a baby's immunization schedule, progress tracking, appointment booking, vaccination records, calendar visualization, and medical risk notices based on the Baby Profile birth date and local timezone.

## Requirements

### Requirement: Authenticated access to vaccine endpoints
The system MUST require an active administrator session and an initialized Baby Profile for all `/api/vaccines` endpoints, rejecting unauthenticated requests with HTTP 401 and requests without a Baby Profile with HTTP 409.

#### Scenario: Reject unauthenticated vaccine request
- **WHEN** an unauthenticated client sends `GET /api/vaccines` or any `/api/vaccines/*` write request
- **THEN** the server responds with HTTP 401 and a structured Chinese JSON error message

#### Scenario: Reject vaccine request before baby onboarding
- **WHEN** an authenticated administrator with no Baby Profile sends `GET /api/vaccines`
- **THEN** the server responds with HTTP 409 with a Chinese error message indicating that baby onboarding must be completed first

### Requirement: Idempotent NIP schedule initialization and overview retrieval
The system SHALL lazily and idempotently seed China's current National Immunization Program (NIP) baseline doses (8 vaccine types, 22 doses including the 2025 DTaP schedule at 2/4/6/18 months and 6 years) for the baby on first access to `GET /api/vaccines?tz=<IANA>`, returning all doses enriched with reference knowledge, timezone-aware derived dates and alert states, progress summary, next-action focus, and top 3 recent clinic names.

#### Scenario: Auto-seed NIP baseline on first retrieval
- **WHEN** an authenticated administrator with a Baby Profile requests `GET /api/vaccines?tz=Asia/Shanghai` for the first time
- **THEN** the server persists the 22 default NIP doses with status `pending`, responds with HTTP 200, and returns all 22 doses without creating duplicates on subsequent calls

#### Scenario: Compute effective due dates with month-end clamping
- **WHEN** a baby is born on `2026-01-31` and a pending dose has `age_months: 1` with no manual `planned_date`
- **THEN** the server computes its `effective_date` as `2026-02-28` rather than overflowing into March

#### Scenario: Reject invalid IANA timezone parameter
- **WHEN** a client sends `GET /api/vaccines?tz=Invalid/Zone`
- **THEN** the server responds with HTTP 400 and a Chinese error message

### Requirement: Derived reminder states and birth vaccine quick-confirm eligibility
The system SHALL derive each dose's display alert state (`completed`, `scheduled`, `scheduled_soon`, `scheduled_overdue`, `upcoming`, `due_soon`, `overdue`) relative to today's local date in the requested timezone without persisting derived states, and SHALL indicate whether the birth hospital vaccine confirmation prompt (HepB dose 1 and BCG both still pending or either pending) is applicable.

#### Scenario: Derive due_soon and overdue states for pending doses
- **WHEN** today in `Asia/Shanghai` is `2026-06-15` and pending doses have effective dates `2026-07-10`, `2026-06-25`, and `2026-05-20`
- **THEN** the server classifies them respectively as `upcoming` (>14 days ahead), `due_soon` (within 14 days ahead or up to 14 days past), and `overdue` (>14 days past)

#### Scenario: Report birth hospital vaccines pending for explicit user confirmation
- **WHEN** HepB dose 1 and BCG have just been seeded as `pending`
- **THEN** the overview summary reports both birth doses as unconfirmed so the UI can prompt the parent to verify the Vaccination Certificate and confirm with one tap instead of silently marking them completed

### Requirement: Optional vaccine catalog and custom vaccine dose creation
The system SHALL expose the built-in optional self-paid vaccine template catalog (including each template's default dose schedule and added count) on `GET /api/vaccines/catalog`, allow adding an optional template (with default or user-customized dose months/counts) via `POST /api/vaccines/from-template` without duplicating an already-added template, and allow creating single- or multi-dose custom vaccine series via `POST /api/vaccines`.

#### Scenario: Add an optional vaccine template once with default or customized doses
- **WHEN** an authenticated administrator sends `POST /api/vaccines/from-template` with `{ "template_code": "pcv13" }` (optionally supplying a customized `doses` array of `age_months` and optional `planned_date`)
- **THEN** the server persists sequentially numbered doses (`1..N`, `total_doses: N`) for the baby and responds with HTTP 201, and a second request for the same `template_code` responds with HTTP 409

#### Scenario: Create a custom vaccine series
- **WHEN** an authenticated administrator sends valid custom vaccine fields (`vaccine_name`, `category`, `doses` containing 1 to 10 items with `age_months` and optional `planned_date`, plus optional `note`) to `POST /api/vaccines`
- **THEN** the server persists sequentially numbered custom doses (`1..N`, `total_doses: N`, `template_code: null`) atomically and responds with HTTP 201

#### Scenario: Reject invalid custom vaccine payload
- **WHEN** a client sends `POST /api/vaccines` with an empty `vaccine_name`, an empty or oversized `doses` list, invalid `category`, out-of-range `age_months`, or malformed `planned_date`
- **THEN** the server responds with HTTP 400 and a Chinese error message without persisting any row

### Requirement: Dose status transitions and record updates
The system SHALL allow updating a single dose via `PUT /api/vaccines/:id` across the three statuses (`pending`, `scheduled`, `completed`) and adjusting `age_months` on optional/custom doses, validating status-specific fields (`birth_date <= vaccinated_at <= today`) and clearing obsolete nullable fields in a transaction.

#### Scenario: Book an appointment for a pending dose
- **WHEN** an authenticated administrator updates a dose to `status: "scheduled"` with a valid `scheduled_date` and optional `scheduled_time` and `clinic_name`
- **THEN** the server persists the appointment, clears `vaccinated_at`, `site`, `manufacturer`, `batch_no`, and `reaction`, and responds with HTTP 200

#### Scenario: Record a completed vaccination
- **WHEN** an authenticated administrator updates a dose to `status: "completed"` with a valid `vaccinated_at` between the baby's birth date and today's local date and optional clinic, site, manufacturer, batch number, and reaction
- **THEN** the server persists the vaccination record, clears `scheduled_date` and `scheduled_time`, updates progress counts, and responds with HTTP 200

#### Scenario: Revert a dose back to pending
- **WHEN** an authenticated administrator updates a scheduled or completed dose back to `status: "pending"`
- **THEN** the server clears appointment and completion fields (`scheduled_date`, `scheduled_time`, `vaccinated_at`, `site`, `manufacturer`, `batch_no`, `reaction`) in SQLite and responds with HTTP 200

#### Scenario: Reject completion with out-of-bounds vaccination date
- **WHEN** a client updates a dose to `status: "completed"` with `vaccinated_at` earlier than the baby's birth date or later than today's local date
- **THEN** the server responds with HTTP 400 and a Chinese error message

### Requirement: Batch appointment booking and historical completion
The system SHALL provide `POST /api/vaccines/batch` to atomically book multiple doses for the same visit or mark multiple doses as completed on the same date in a single transaction (supporting same-stage appointment booking and historical stage backfill; per-dose birth-hospital confirmation with distinct HepB/BCG dates uses per-dose `PUT /api/vaccines/:id`).

#### Scenario: Batch-mark multiple same-stage doses as completed
- **WHEN** an authenticated administrator sends `POST /api/vaccines/batch` with `action: "complete"`, a list of dose IDs, and a valid `vaccinated_at` between the baby's birth date and today's local date
- **THEN** the server marks all specified doses as `completed` atomically in a single transaction and responds with HTTP 200

#### Scenario: Roll back batch update when any dose ID is invalid
- **WHEN** a client sends `POST /api/vaccines/batch` including a non-existent dose ID
- **THEN** the server rolls back the transaction without modifying any dose and responds with HTTP 404

### Requirement: Controlled deletion, automatic renumbering, and template removal
The system SHALL allow deleting a single custom or optional template dose via `DELETE /api/vaccines/:id` while atomically renumbering remaining sibling doses sequentially (`1..N-1`, `total_doses: N-1`), SHALL allow removing an entire optional template series via `DELETE /api/vaccines/template/:code`, and SHALL reject deleting built-in NIP baseline doses with HTTP 400.

#### Scenario: Delete a middle dose and renumber subsequent siblings
- **WHEN** an authenticated administrator sends `DELETE /api/vaccines/:id` for dose 2 of a 4-dose optional or custom vaccine
- **THEN** the server removes dose 2 and atomically updates the remaining doses to `1/3`, `2/3`, and `3/3` in SQLite, responding with HTTP 200

#### Scenario: Remove an entire optional template series
- **WHEN** an authenticated administrator sends `DELETE /api/vaccines/template/pcv13`
- **THEN** the server deletes all doses belonging to `pcv13` for the baby, marks `pcv13` as `added: false` in the catalog, and responds with HTTP 200

#### Scenario: Reject deletion of built-in NIP dose
- **WHEN** an authenticated administrator sends `DELETE /api/vaccines/:id` for a built-in NIP dose or `DELETE /api/vaccines/template/hepb`
- **THEN** the server responds with HTTP 400 with a Chinese error message without deleting any row

### Requirement: Web vaccination workspace, calendar export, and mandatory risk notices
The web application SHALL provide `/vaccines` under the `健康与成长` sidebar group (alongside `/health` and `/growth`) with persistent medical disclaimers, per-dose birth-hospital confirmation, side-by-side calendar (with `.ics` export) and next-focus/progress card, age-stage timeline, and post-vaccination temperature entry. `/dashboard` SHALL surface vaccine alerts and progress via cached `/api/vaccines` independently of the 60-second summary poll.

#### Scenario: Display persistent medical disclaimer and vaccine-specific risks
- **WHEN** an authenticated administrator opens `/vaccines` and inspects any vaccine detail drawer
- **THEN** the page displays a persistent medical disclaimer warning that app schedules are for reference only and must be verified with the official Vaccination Certificate and clinic doctor, and the drawer displays vaccine-specific precautions and risk warnings

#### Scenario: Export booked or planned doses to system calendar
- **WHEN** the parent clicks the calendar export action on the vaccination calendar for an upcoming or scheduled vaccine visit
- **THEN** the application downloads a valid RFC 5545 `.ics` file containing event date/time, clinic location, precautions, risk warnings, and reminder alarms

#### Scenario: Surface vaccine status and trigger lazy NIP initialization from dashboard
- **WHEN** an authenticated administrator with a newly created Baby Profile opens `/dashboard` before visiting `/vaccines`
- **THEN** the dashboard fetches `/api/vaccines` independently of the 60-second summary poll, triggering idempotent NIP schedule seeding and displaying the birth-hospital confirmation or next-focus alert banner and `疫苗接种计划` card linking to `/vaccines`
