# baby-profile Specification

## Purpose

Manages the single baby profile lifecycle including mandatory first-time onboarding, profile retrieval, and profile updates so BabyLog can compute baby age and scope all daily care records under a durable baby identifier.

## Requirements

### Requirement: Authenticated access to baby profile endpoints
The system MUST require a valid authenticated administrator session for all `/api/baby` endpoints and reject unauthenticated requests with HTTP 401.

#### Scenario: Reject unauthenticated baby profile request
- **WHEN** an unauthenticated client sends `GET /api/baby`, `POST /api/baby`, or `PUT /api/baby`
- **THEN** the server responds with HTTP 401 and a structured Chinese JSON error message

### Requirement: Baby profile retrieval and onboarding status
The system SHALL return the current baby profile on `GET /api/baby` or `{ "baby": null }` when no baby profile has been created yet, allowing the client to enforce first-time onboarding before accessing dashboard and record views.

#### Scenario: Retrieve empty profile before onboarding
- **WHEN** an authenticated administrator with no baby profile sends `GET /api/baby`
- **THEN** the server responds with HTTP 200 and `{ "baby": null }`

#### Scenario: Retrieve existing baby profile
- **WHEN** an authenticated administrator sends `GET /api/baby` after a baby profile has been created
- **THEN** the server responds with HTTP 200 and returns the stored baby profile including `id`, `nickname`, `birth_date`, `gender`, optional `birth_weight_kg`, optional `birth_height_cm`, `created_at`, and `updated_at`

### Requirement: Single baby profile creation
The system SHALL allow creating the baby profile on `POST /api/baby` (with optional `tz=<IANA>` query parameter to evaluate today's local date) with required `nickname`, `birth_date`, and `gender` (plus optional `birth_weight_kg` and `birth_height_cm`), and SHALL reject duplicate creation when a profile already exists.

#### Scenario: Create baby profile successfully
- **WHEN** an authenticated administrator sends a valid `application/json` payload to `POST /api/baby` (optionally with `?tz=<IANA>`) with non-empty `nickname` (1 to 32 characters after trimming), `birth_date` in `YYYY-MM-DD` format not in the future in the requested timezone, and `gender` in `male | female | unknown`
- **THEN** the server persists the profile in SQLite, responds with HTTP 201, and returns the created baby profile

#### Scenario: Reject duplicate baby profile creation
- **WHEN** a baby profile already exists and an authenticated administrator sends `POST /api/baby`
- **THEN** the server responds with HTTP 409 and a Chinese error message without modifying the existing profile

#### Scenario: Reject invalid baby profile input
- **WHEN** an authenticated administrator sends `POST /api/baby` with an empty `nickname`, a malformed or future `birth_date`, an invalid `gender`, or out-of-range optional birth measurements
- **THEN** the server responds with HTTP 400 and a Chinese error message without persisting any data

### Requirement: Baby profile update
The system SHALL allow updating the existing baby profile on `PUT /api/baby` (with optional `tz=<IANA>` query parameter) using the same field validation rules as creation.

#### Scenario: Update existing baby profile
- **WHEN** an authenticated administrator sends valid updated fields to `PUT /api/baby`
- **THEN** the server updates the profile in SQLite, refreshes `updated_at`, and responds with HTTP 200 with the updated profile

#### Scenario: Reject update before onboarding
- **WHEN** no baby profile exists and an authenticated administrator sends `PUT /api/baby`
- **THEN** the server responds with HTTP 404 and a Chinese error message

### Requirement: Mandatory onboarding gate in web application
The web application SHALL redirect authenticated users without a baby profile to the onboarding view and SHALL unlock the dashboard and record views immediately after onboarding succeeds.

#### Scenario: Redirect to onboarding when baby profile is missing
- **WHEN** an authenticated administrator visits `/dashboard` or any record page while `GET /api/baby` returns `{ "baby": null }`
- **THEN** the application routes the user to the baby onboarding form requiring nickname, birth date, and gender before entering the workspace
