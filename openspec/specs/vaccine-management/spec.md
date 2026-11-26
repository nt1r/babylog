# vaccine-management Specification

## Purpose

Manages a baby's immunization schedule, progress tracking, appointment booking, vaccination records, calendar visualization, and medical risk notices based on the Baby Profile birth date and local timezone.

## Requirements

### Requirement: Authenticated access to vaccine endpoints
The system MUST require an active User session with `must_change_password: false` and an owned `:babyId` path parameter for all `/api/babies/:babyId/vaccines*` endpoints, rejecting unauthenticated requests with HTTP 401, pending-password-change requests with HTTP 403, and unknown or foreign `:babyId` with HTTP 404.

#### Scenario: Reject unauthenticated vaccine request
- **WHEN** an unauthenticated client sends `GET /api/babies/:babyId/vaccines` or any `/api/babies/:babyId/vaccines/*` write request
- **THEN** the server responds with HTTP 401 and a structured Chinese JSON error message

#### Scenario: Reject vaccine request before baby onboarding
- **WHEN** an authenticated User with no owned Baby Profile sends `GET /api/babies/:babyId/vaccines`
- **THEN** the server responds with HTTP 404 and a Chinese error message without seeding any dose

#### Scenario: Reject vaccine request for foreign baby ID
- **WHEN** User B sends `GET /api/babies/:babyId/vaccines` or any vaccine mutation using a `babyId` owned by User A
- **THEN** the server responds with HTTP 404 and a Chinese error message without seeding, reading, or modifying User A's vaccine doses

### Requirement: Idempotent NIP schedule initialization and overview retrieval
The system SHALL lazily and idempotently seed China's current National Immunization Program (NIP) baseline doses (8 vaccine types, 22 doses including the 2025 DTaP schedule at 2/4/6/18 months and 6 years) for `:babyId` on first access to `GET /api/babies/:babyId/vaccines?tz=<IANA>`, returning all doses enriched with reference knowledge, timezone-aware derived dates and alert states, progress summary, next-action focus, the Baby Profile's `default_clinic_name`, and top 3 recent clinic names.

#### Scenario: Auto-seed NIP baseline on first retrieval
- **WHEN** an authenticated User requests `GET /api/babies/:babyId/vaccines?tz=Asia/Shanghai` for the first time for an owned Baby Profile
- **THEN** the server persists the 22 default NIP doses with status `pending` for `:babyId`, responds with HTTP 200, and returns all 22 doses along with `default_clinic_name` without creating duplicates on subsequent calls or affecting other babies

#### Scenario: Compute effective due dates with month-end clamping
- **WHEN** a baby is born on `2026-01-31` and a pending dose has `age_months: 1` with no manual `planned_date`
- **THEN** the server computes its `effective_date` as `2026-02-28` rather than overflowing into March

#### Scenario: Reject invalid IANA timezone parameter
- **WHEN** a client sends `GET /api/babies/:babyId/vaccines?tz=Invalid/Zone`
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
The system SHALL expose the built-in optional self-paid vaccine template catalog (including each template's default dose schedule and added count for `:babyId`) on `GET /api/babies/:babyId/vaccines/catalog`, allow adding an optional template via `POST /api/babies/:babyId/vaccines/from-template` without duplicating an already-added template for that baby, and allow creating single- or multi-dose custom vaccine series via `POST /api/babies/:babyId/vaccines`.

#### Scenario: Add an optional vaccine template once with default or customized doses
- **WHEN** an authenticated User sends `POST /api/babies/:babyId/vaccines/from-template` with `{ "template_code": "pcv13" }` (optionally supplying a customized `doses` array of `age_months` and optional `planned_date`)
- **THEN** the server persists sequentially numbered doses (`1..N`, `total_doses: N`) for `:babyId` and responds with HTTP 201, and a second request for the same `template_code` on the same baby responds with HTTP 409 while another baby can still add `pcv13`

#### Scenario: Create a custom vaccine series
- **WHEN** an authenticated User sends valid custom vaccine fields (`vaccine_name`, `category`, `doses` containing 1 to 10 items with `age_months` and optional `planned_date`, plus optional `note`) to `POST /api/babies/:babyId/vaccines`
- **THEN** the server persists sequentially numbered custom doses (`1..N`, `total_doses: N`, `template_code: null`) atomically for `:babyId` and responds with HTTP 201

#### Scenario: Reject invalid custom vaccine payload
- **WHEN** a client sends `POST /api/babies/:babyId/vaccines` with an empty `vaccine_name`, an empty or oversized `doses` list, invalid `category`, out-of-range `age_months`, or malformed `planned_date`
- **THEN** the server responds with HTTP 400 and a Chinese error message without persisting any row

### Requirement: Dose status transitions and record updates
The system SHALL update a single dose owned by `:babyId` via `PUT /api/babies/:babyId/vaccines/:id` across `pending`, `scheduled`, and `completed` (and `age_months` on optional/custom doses), enforcing `birth_date <= vaccinated_at <= today`, clearing obsolete nullable fields, atomically syncing `:babyId`'s `default_clinic_name`, and returning HTTP 404 when `:id` belongs to another baby or User.

#### Scenario: Book an appointment for a pending dose
- **WHEN** an authenticated User updates an owned dose via `PUT /api/babies/:babyId/vaccines/:id` to `status: "scheduled"` with a valid `scheduled_date` and optional `scheduled_time` and `clinic_name`
- **THEN** the server persists the appointment, clears `vaccinated_at`, `site`, `manufacturer`, `batch_no`, and `reaction`, and responds with HTTP 200

#### Scenario: Record a completed vaccination
- **WHEN** an authenticated User updates an owned dose to `status: "completed"` with a valid `vaccinated_at` between the baby's birth date and today's local date and optional clinic, site, manufacturer, batch number, and reaction
- **THEN** the server persists the vaccination record, clears `scheduled_date` and `scheduled_time`, updates progress counts, and responds with HTTP 200

#### Scenario: Auto-remember first non-birth clinic and respect explicit default clinic pin
- **WHEN** a baby has an empty `default_clinic_name` and the User saves a birth-hospital dose (HepB dose 1 or BCG) with `"市妇幼保健院"`, then saves a routine dose with `"阳光街道社区卫生服务中心"`, then saves another dose with `"儿童医院"` without `set_default_clinic`, and finally saves a dose with `"高新社区卫生服务中心"` and `set_default_clinic: true`
- **THEN** the birth-hospital dose leaves `default_clinic_name` empty, the first routine clinic auto-populates `default_clinic_name` to `"阳光街道社区卫生服务中心"`, the one-off `"儿童医院"` visit preserves `"阳光街道社区卫生服务中心"`, and the explicit `set_default_clinic: true` updates `default_clinic_name` to `"高新社区卫生服务中心"`

#### Scenario: Revert a dose back to pending
- **WHEN** an authenticated User updates a scheduled or completed dose back to `status: "pending"`
- **THEN** the server clears appointment and completion fields (`scheduled_date`, `scheduled_time`, `vaccinated_at`, `site`, `manufacturer`, `batch_no`, `reaction`) in SQLite and responds with HTTP 200

#### Scenario: Reject completion with out-of-bounds vaccination date
- **WHEN** a client updates a dose to `status: "completed"` with `vaccinated_at` earlier than the baby's birth date or later than today's local date
- **THEN** the server responds with HTTP 400 and a Chinese error message

#### Scenario: Reject updating dose belonging to another baby or user
- **WHEN** an authenticated User sends `PUT /api/babies/:babyId/vaccines/:id` where `:id` belongs to a sibling baby or another User's baby
- **THEN** the server responds with HTTP 404 and a Chinese error message without modifying the target dose

### Requirement: Batch appointment booking and historical completion
The system SHALL provide `POST /api/babies/:babyId/vaccines/batch` to atomically book multiple doses for the same visit or mark multiple doses as completed on the same date in a single transaction, applying atomic default clinic auto-remember and explicit `set_default_clinic` rules and rolling back with HTTP 404 if any dose ID does not belong to `:babyId`.

#### Scenario: Batch-mark multiple same-stage doses as completed
- **WHEN** an authenticated User sends `POST /api/babies/:babyId/vaccines/batch` with `action: "complete"`, a list of dose IDs owned by `:babyId`, and a valid `vaccinated_at` between the baby's birth date and today's local date
- **THEN** the server marks all specified doses as `completed` atomically in a single transaction and responds with HTTP 200

#### Scenario: Roll back batch update when any dose ID is invalid
- **WHEN** a client sends `POST /api/babies/:babyId/vaccines/batch` including a non-existent dose ID, a sibling baby's dose ID, or another User's dose ID
- **THEN** the server rolls back the transaction without modifying any dose and responds with HTTP 404

#### Scenario: Batch update rolls back default clinic change on invalid dose ID
- **WHEN** a client sends `POST /api/babies/:babyId/vaccines/batch` with a valid `clinic_name`, `set_default_clinic: true`, and a non-existent or foreign dose ID
- **THEN** the server rolls back the transaction without modifying any dose or `default_clinic_name` and responds with HTTP 404

### Requirement: Controlled deletion, automatic renumbering, and template removal
The system SHALL allow deleting a single custom or optional template dose belonging to `:babyId` via `DELETE /api/babies/:babyId/vaccines/:id` while atomically renumbering remaining sibling doses sequentially (`1..N-1`, `total_doses: N-1`), SHALL allow removing an entire optional template series via `DELETE /api/babies/:babyId/vaccines/template/:code`, and SHALL reject deleting built-in NIP baseline doses with HTTP 400.

#### Scenario: Delete a middle dose and renumber subsequent siblings
- **WHEN** an authenticated User sends `DELETE /api/babies/:babyId/vaccines/:id` for dose 2 of a 4-dose optional or custom vaccine
- **THEN** the server removes dose 2 and atomically updates the remaining doses to `1/3`, `2/3`, and `3/3` in SQLite, responding with HTTP 200

#### Scenario: Remove an entire optional template series
- **WHEN** an authenticated User sends `DELETE /api/babies/:babyId/vaccines/template/pcv13`
- **THEN** the server deletes all doses belonging to `pcv13` for `:babyId`, marks `pcv13` as `added: false` in `:babyId`'s catalog without affecting other babies, and responds with HTTP 200

#### Scenario: Reject deletion of built-in NIP dose
- **WHEN** an authenticated User sends `DELETE /api/babies/:babyId/vaccines/:id` for a built-in NIP dose or `DELETE /api/babies/:babyId/vaccines/template/hepb`
- **THEN** the server responds with HTTP 400 with a Chinese error message without deleting any row

### Requirement: Web vaccination workspace, calendar export, and mandatory risk notices
The web application SHALL provide `/vaccines` under `健康与成长` with persistent disclaimers, per-dose birth confirmation, calendar with `.ics` export (falling back to `default_clinic_name`), next-focus/progress card (with batch completion for multi-dose scheduled visits), age-stage timeline, smart clinic/manufacturer/site prefill, and post-vaccination temperature entry. `/dashboard` SHALL surface vaccine alerts via cached `/api/babies/:babyId/vaccines`.

#### Scenario: Display persistent medical disclaimer and vaccine-specific risks
- **WHEN** an authenticated administrator opens `/vaccines` and inspects any vaccine detail drawer
- **THEN** the page displays a persistent medical disclaimer warning that app schedules are for reference only and must be verified with the official Vaccination Certificate and clinic doctor, and the drawer displays vaccine-specific precautions and risk warnings

#### Scenario: Prefill default clinic, sibling manufacturer, and alternating site hints in dose drawers
- **WHEN** the baby has a saved `default_clinic_name` (or recent clinics) and the administrator opens a pending dose and switches it to `scheduled` or `completed`
- **THEN** the clinic field automatically prefills `default_clinic_name` (or the latest recent clinic) with one-tap clear and pin-as-default controls, displays sibling vaccine manufacturer suggestions when available, and highlights opposite-side site suggestions when another dose was completed on the same day

#### Scenario: Export booked or planned doses to system calendar
- **WHEN** the parent clicks the calendar export action on the vaccination calendar for an upcoming or scheduled vaccine visit
- **THEN** the application downloads a valid RFC 5545 `.ics` file containing event date/time, clinic location (falling back to `default_clinic_name` when the dose has no per-dose clinic yet), precautions, risk warnings, and reminder alarms

#### Scenario: Surface vaccine status and trigger lazy NIP initialization from dashboard
- **WHEN** an authenticated administrator with a newly created Baby Profile opens `/dashboard` before visiting `/vaccines`
- **THEN** the dashboard fetches `/api/babies/:babyId/vaccines` independently of the 60-second summary poll, triggering idempotent NIP schedule seeding and displaying the birth-hospital confirmation or next-focus alert banner and `疫苗接种计划` card linking to `/vaccines`

### Requirement: Explicit default vaccination clinic management
The system SHALL provide `PUT /api/babies/:babyId/vaccines/default-clinic` allowing an authenticated User to set or clear `default_clinic_name` (trimmed, maximum 80 characters) for an owned Baby Profile directly from the vaccination workspace.

#### Scenario: Set and clear default vaccination clinic
- **WHEN** an authenticated User sends `PUT /api/babies/:babyId/vaccines/default-clinic` with `{ "clinic_name": "  阳光街道社区卫生服务中心  " }` and later with `{ "clinic_name": "" }`
- **THEN** the first request responds with HTTP 200 and `{ "default_clinic_name": "阳光街道社区卫生服务中心" }` persisted for `:babyId` in SQLite, and the second request clears it to `""`

#### Scenario: Reject oversized default clinic name
- **WHEN** an authenticated User sends `PUT /api/babies/:babyId/vaccines/default-clinic` with `clinic_name` longer than 80 characters
- **THEN** the server responds with HTTP 400 with a Chinese validation error message without modifying the stored value
