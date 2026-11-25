# daily-records Specification

## Purpose

Manages authenticated structured persistence, filtering, pagination, editing, deletion, and smart default suggestions for BabyLog daily feeding, sleep, care, and health records.

## Requirements

### Requirement: Authenticated access and baby-profile precondition for records
The system MUST require an active User session with `must_change_password: false` and an owned `:babyId` path parameter for all `/api/babies/:babyId/records/*` endpoints, rejecting unauthenticated requests with HTTP 401, pending-password-change requests with HTTP 403, unknown or foreign `:babyId` with HTTP 404, and enforcing JSON `Content-Type`, request body size limits, and Same-Origin protection on state-changing requests.

#### Scenario: Reject unauthenticated record request
- **WHEN** an unauthenticated client calls any `/api/babies/:babyId/records/*` endpoint
- **THEN** the server responds with HTTP 401 and a Chinese error message

#### Scenario: Reject record write before baby onboarding
- **WHEN** an authenticated User with no owned Baby Profile calls `POST /api/babies/:babyId/records/feeding`
- **THEN** the server responds with HTTP 404 and a Chinese error message without saving any record

#### Scenario: Reject record access for foreign baby ID
- **WHEN** User B calls `GET` or `POST /api/babies/:babyId/records/feeding` using a `babyId` owned by User A
- **THEN** the server responds with HTTP 404 and a Chinese error message without reading or writing User A's records

#### Scenario: Reject future record timestamp beyond clock skew
- **WHEN** an authenticated User submits a record whose `recorded_at` (or sleep `ended_at`) is more than 5 minutes ahead of server UTC time
- **THEN** the server responds with HTTP 400 and a Chinese error message without saving the record

### Requirement: Feeding record CRUD and structured validation
The system SHALL provide `GET /POST /api/babies/:babyId/records/feeding` and `PUT /DELETE /api/babies/:babyId/records/feeding/:id` supporting structured subtypes `breast` (direct breastfeeding with side and duration or bottled breast milk with `amount_ml`), `formula` (with `amount_ml`), and `solid` (with food name and optional amount/acceptance).

#### Scenario: Create direct breastfeeding record
- **WHEN** an authenticated User submits `POST /api/babies/:babyId/records/feeding` with `subtype: "breast"`, `feeding_mode: "direct"`, `breast_side: "left"`, `duration_min: 15`, and a valid `recorded_at`
- **THEN** the server persists the record in UTC under `:babyId`, responds with HTTP 201, and returns the saved feeding record with its generated `id`

#### Scenario: Create bottled breast milk or formula record
- **WHEN** an authenticated User submits `POST /api/babies/:babyId/records/feeding` with `subtype: "formula"` (or `subtype: "breast"` with `feeding_mode: "bottle"`) and `amount_ml` between 1 and 1000
- **THEN** the server persists the record with `amount_ml` and responds with HTTP 201

#### Scenario: Create solid food record
- **WHEN** an authenticated User submits `POST /api/babies/:babyId/records/feeding` with `subtype: "solid"`, non-empty `solid_food`, and optional `solid_amount` and `acceptance` (`like | neutral | dislike`)
- **THEN** the server persists the record and responds with HTTP 201

#### Scenario: Reject invalid feeding payload
- **WHEN** an authenticated User submits `subtype: "formula"` without `amount_ml` or with `amount_ml <= 0`, or submits `subtype: "solid"` with blank `solid_food`
- **THEN** the server responds with HTTP 400 and a Chinese validation message

#### Scenario: Update and delete feeding record
- **WHEN** an authenticated User updates an existing feeding record via `PUT /api/babies/:babyId/records/feeding/:id` and later deletes it via `DELETE /api/babies/:babyId/records/feeding/:id`
- **THEN** the update returns HTTP 200 with updated fields, and the delete returns HTTP 200 and removes the record from subsequent queries

### Requirement: Sleep record CRUD with backfill validation
The system SHALL provide `GET /POST /api/babies/:babyId/records/sleep` and `PUT /DELETE /api/babies/:babyId/records/sleep/:id` for backfilled sleep records with subtype `nap` or `night`, valid `started_at` and `ended_at` (`ended_at > started_at`), and server-computed `duration_min`.

#### Scenario: Create sleep record from start and end times
- **WHEN** an authenticated User submits `POST /api/babies/:babyId/records/sleep` with `subtype: "nap"`, `started_at`, and `ended_at` 45 minutes later
- **THEN** the server computes `duration_min: 45`, persists the record, and responds with HTTP 201

#### Scenario: Reject invalid sleep time interval
- **WHEN** an authenticated User submits `POST /api/babies/:babyId/records/sleep` where `ended_at` is earlier than or equal to `started_at`, or duration exceeds 24 hours
- **THEN** the server responds with HTTP 400 and a Chinese error message

### Requirement: Care record CRUD and structured validation
The system SHALL provide `GET /POST /api/babies/:babyId/records/care` and `PUT /DELETE /api/babies/:babyId/records/care/:id` supporting subtypes `diaper` (pee, poop, or both, with optional stool consistency and color when poop is present), `bath`, and `other`.

#### Scenario: Create diaper record with optional stool details
- **WHEN** an authenticated User submits `POST /api/babies/:babyId/records/care` with `subtype: "diaper"`, `diaper_kind: "poop"`, `stool_consistency: "soft"`, `stool_color: "yellow"`, and a valid `recorded_at`
- **THEN** the server persists the record and responds with HTTP 201

#### Scenario: Create bath or other care record
- **WHEN** an authenticated User submits `POST /api/babies/:babyId/records/care` with `subtype: "bath"`, or with `subtype: "other"` and non-empty `care_title`
- **THEN** the server persists the record and responds with HTTP 201

#### Scenario: Reject invalid care payload
- **WHEN** an authenticated User submits `subtype: "diaper"` without a valid `diaper_kind`, or submits `subtype: "other"` with blank `care_title`
- **THEN** the server responds with HTTP 400 and a Chinese validation message

### Requirement: Health and growth record CRUD
The system SHALL provide `GET /POST /api/babies/:babyId/records/health` and `PUT /DELETE /api/babies/:babyId/records/health/:id` supporting subtypes `temperature`, `medicine`, `growth`, and `teeth`.

#### Scenario: Create temperature record with fever status classification
- **WHEN** an authenticated User submits `POST /api/babies/:babyId/records/health` with `subtype: "temperature"` and `temperature_c: 38.6` (within 34.0 to 43.0)
- **THEN** the server persists the record and returns HTTP 201 with `temperature_c: 38.6`

#### Scenario: Create growth record with partial measurements
- **WHEN** an authenticated User submits `POST /api/babies/:babyId/records/health` with `subtype: "growth"` and at least one positive measurement among `weight_kg`, `height_cm`, and `head_cm`
- **THEN** the server persists the record and responds with HTTP 201

#### Scenario: Reject empty growth or medicine record
- **WHEN** an authenticated User submits `subtype: "growth"` with all measurements omitted, or `subtype: "medicine"` with blank `medicine_name`, or `subtype: "teeth"` with blank `tooth_note`
- **THEN** the server responds with HTTP 400 and a Chinese validation message

### Requirement: Filtered, timezone-scoped listing with pagination and daily subtotals
The system SHALL filter each `/api/babies/:babyId/records/*` list endpoint by `subtype`, local date range (`today | 7d | 30d | all`), IANA `tz` (default `Asia/Shanghai`), and pagination (`limit`, `offset`), returning reverse-chronological records scoped strictly to `:babyId` with local-date subtotals; `/health` SHALL also accept comma-separated valid subtypes and reject invalid or empty tokens with HTTP 400.

#### Scenario: Filter feeding records by subtype and date range
- **WHEN** an authenticated User requests `GET /api/babies/:babyId/records/feeding?subtype=formula&range=7d&tz=Asia/Shanghai&limit=20&offset=0`
- **THEN** the server returns HTTP 200 with matching formula records belonging strictly to `:babyId` within the past 7 local days ordered by `recorded_at DESC`, pagination metadata (`total`, `has_more`), and per-day subtotals

#### Scenario: Filter health records by comma-separated subtype group
- **WHEN** an authenticated User with temperature, medicine, growth, and teeth records requests `GET /api/babies/:babyId/records/health?subtype=temperature,medicine&range=30d&tz=Asia/Shanghai` or `GET /api/babies/:babyId/records/health?subtype=growth,teeth&range=all&tz=Asia/Shanghai`
- **THEN** the server responds with HTTP 200 containing only records belonging to `:babyId` and the requested subtypes, accurate `total` and `has_more` counts, and `daily_summaries` computed solely from the matched subtypes

#### Scenario: Reject invalid or empty token in comma-separated health subtype filter
- **WHEN** a client requests `GET /api/babies/:babyId/records/health?subtype=temperature,unknown` or `GET /api/babies/:babyId/records/health?subtype=growth,`
- **THEN** the server responds with HTTP 400 and a Chinese validation error message

#### Scenario: Reject unknown record ID on update or delete
- **WHEN** an authenticated User calls `PUT` or `DELETE` on `/api/babies/:babyId/records/:category/:id` with a non-existent record ID, a sibling baby's record ID, or another User's record ID
- **THEN** the server responds with HTTP 404 and a Chinese error message without modifying or deleting the target record

### Requirement: Smart defaults endpoint for low-friction entry
The system SHALL provide `GET /api/babies/:babyId/records/defaults` returning habit-based feeding, sleep, health, and care defaults computed strictly from recent stored records belonging to `:babyId` so the client can prefill forms and suggest next actions without cross-baby or cross-user leakage.

#### Scenario: Compute smart defaults from recent history
- **WHEN** an authenticated User with existing feeding, sleep, health, and care records for `:babyId` calls `GET /api/babies/:babyId/records/defaults`
- **THEN** the server responds with HTTP 200 containing habit defaults computed strictly from `:babyId` (latest milk volume, top 3 frequent milk amounts, `last_feeding_subtype`, `last_milk_subtype`, `last_breast_mode`, `last_breast_duration_min`, last direct breastfeeding side and suggested opposite side, deduplicated paired `recent_solids`, median-based `sleep.suggested_nap_min` and `sleep.suggested_night_min`, latest temperature, recent medicines with dosages, and recent custom care titles)

#### Scenario: Return sensible starter defaults when history is empty
- **WHEN** an authenticated User with no records yet for `:babyId` (even when other babies or Users have records) calls `GET /api/babies/:babyId/records/defaults`
- **THEN** the server responds with HTTP 200 with starter fallback presets (standard milk options, `last_milk_subtype: "formula"`, `last_breast_mode: "direct"`, `last_breast_duration_min: 15`, `recent_solids: []`, `sleep.suggested_nap_min: 60`, `sleep.suggested_night_min: 480`, and default temperature `36.6`) without error
