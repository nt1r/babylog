## MODIFIED Requirements

### Requirement: Idempotent NIP schedule initialization and overview retrieval
The system SHALL lazily and idempotently seed China's current National Immunization Program (NIP) baseline doses (8 vaccine types, 22 doses including the 2025 DTaP schedule at 2/4/6/18 months and 6 years) for the baby on first access to `GET /api/vaccines?tz=<IANA>`, returning all doses enriched with reference knowledge, timezone-aware derived dates and alert states, progress summary, next-action focus, the Baby Profile's `default_clinic_name`, and top 3 recent clinic names.

#### Scenario: Auto-seed NIP baseline on first retrieval
- **WHEN** an authenticated administrator with a Baby Profile requests `GET /api/vaccines?tz=Asia/Shanghai` for the first time
- **THEN** the server persists the 22 default NIP doses with status `pending`, responds with HTTP 200, and returns all 22 doses along with `default_clinic_name` without creating duplicates on subsequent calls

#### Scenario: Compute effective due dates with month-end clamping
- **WHEN** a baby is born on `2026-01-31` and a pending dose has `age_months: 1` with no manual `planned_date`
- **THEN** the server computes its `effective_date` as `2026-02-28` rather than overflowing into March

#### Scenario: Reject invalid IANA timezone parameter
- **WHEN** a client sends `GET /api/vaccines?tz=Invalid/Zone`
- **THEN** the server responds with HTTP 400 and a Chinese error message

### Requirement: Dose status transitions and record updates
The system SHALL allow updating a single dose via `PUT /api/vaccines/:id` across the three statuses (`pending`, `scheduled`, `completed`) and adjusting `age_months` on optional/custom doses, validating status-specific fields (`birth_date <= vaccinated_at <= today`), clearing obsolete nullable fields, and atomically updating `default_clinic_name` on explicit pin or first non-birth-hospital clinic entry.

#### Scenario: Book an appointment for a pending dose
- **WHEN** an authenticated administrator updates a dose to `status: "scheduled"` with a valid `scheduled_date` and optional `scheduled_time` and `clinic_name`
- **THEN** the server persists the appointment, clears `vaccinated_at`, `site`, `manufacturer`, `batch_no`, and `reaction`, and responds with HTTP 200

#### Scenario: Record a completed vaccination
- **WHEN** an authenticated administrator updates a dose to `status: "completed"` with a valid `vaccinated_at` between the baby's birth date and today's local date and optional clinic, site, manufacturer, batch number, and reaction
- **THEN** the server persists the vaccination record, clears `scheduled_date` and `scheduled_time`, updates progress counts, and responds with HTTP 200

#### Scenario: Auto-remember first non-birth clinic and respect explicit default clinic pin
- **WHEN** a baby has an empty `default_clinic_name` and the administrator saves a birth-hospital dose (HepB dose 1 or BCG) with `"市妇幼保健院"`, then saves a routine dose with `"阳光街道社区卫生服务中心"`, then saves another dose with `"儿童医院"` without `set_default_clinic`, and finally saves a dose with `"高新社区卫生服务中心"` and `set_default_clinic: true`
- **THEN** the birth-hospital dose leaves `default_clinic_name` empty, the first routine clinic auto-populates `default_clinic_name` to `"阳光街道社区卫生服务中心"`, the one-off `"儿童医院"` visit preserves `"阳光街道社区卫生服务中心"`, and the explicit `set_default_clinic: true` updates `default_clinic_name` to `"高新社区卫生服务中心"`

#### Scenario: Revert a dose back to pending
- **WHEN** an authenticated administrator updates a scheduled or completed dose back to `status: "pending"`
- **THEN** the server clears appointment and completion fields (`scheduled_date`, `scheduled_time`, `vaccinated_at`, `site`, `manufacturer`, `batch_no`, `reaction`) in SQLite and responds with HTTP 200

#### Scenario: Reject completion with out-of-bounds vaccination date
- **WHEN** a client updates a dose to `status: "completed"` with `vaccinated_at` earlier than the baby's birth date or later than today's local date
- **THEN** the server responds with HTTP 400 and a Chinese error message

### Requirement: Batch appointment booking and historical completion
The system SHALL provide `POST /api/vaccines/batch` to atomically book multiple doses for the same visit or mark multiple doses as completed on the same date in a single transaction, and SHALL apply the same atomic default clinic auto-remember and explicit `set_default_clinic` rules when a non-empty `clinic_name` is supplied.

#### Scenario: Batch-mark multiple same-stage doses as completed
- **WHEN** an authenticated administrator sends `POST /api/vaccines/batch` with `action: "complete"`, a list of dose IDs, and a valid `vaccinated_at` between the baby's birth date and today's local date
- **THEN** the server marks all specified doses as `completed` atomically in a single transaction and responds with HTTP 200

#### Scenario: Roll back batch update when any dose ID is invalid
- **WHEN** a client sends `POST /api/vaccines/batch` including a non-existent dose ID
- **THEN** the server rolls back the transaction without modifying any dose and responds with HTTP 404

#### Scenario: Batch update rolls back default clinic change on invalid dose ID
- **WHEN** a client sends `POST /api/vaccines/batch` with a valid `clinic_name`, `set_default_clinic: true`, and a non-existent dose ID
- **THEN** the server rolls back the transaction without modifying any dose or `default_clinic_name` and responds with HTTP 404

### Requirement: Web vaccination workspace, calendar export, and mandatory risk notices
The web application SHALL provide `/vaccines` under `健康与成长` with persistent disclaimers, per-dose birth confirmation, calendar with `.ics` export (falling back to `default_clinic_name`), next-focus/progress card (with batch completion for multi-dose scheduled visits), age-stage timeline, smart clinic/manufacturer/site prefill, and post-vaccination temperature entry. `/dashboard` SHALL surface vaccine alerts via cached `/api/vaccines`.

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
- **THEN** the dashboard fetches `/api/vaccines` independently of the 60-second summary poll, triggering idempotent NIP schedule seeding and displaying the birth-hospital confirmation or next-focus alert banner and `疫苗接种计划` card linking to `/vaccines`

## ADDED Requirements

### Requirement: Explicit default vaccination clinic management
The system SHALL provide `PUT /api/vaccines/default-clinic` allowing an authenticated administrator with an initialized Baby Profile to set or clear `default_clinic_name` (trimmed, maximum 80 characters) directly from the vaccination workspace.

#### Scenario: Set and clear default vaccination clinic
- **WHEN** an authenticated administrator sends `PUT /api/vaccines/default-clinic` with `{ "clinic_name": "  阳光街道社区卫生服务中心  " }` and later with `{ "clinic_name": "" }`
- **THEN** the first request responds with HTTP 200 and `{ "default_clinic_name": "阳光街道社区卫生服务中心" }` persisted in SQLite, and the second request clears it to `""`

#### Scenario: Reject oversized default clinic name
- **WHEN** an authenticated administrator sends `PUT /api/vaccines/default-clinic` with `clinic_name` longer than 80 characters
- **THEN** the server responds with HTTP 400 with a Chinese validation error message without modifying the stored value
