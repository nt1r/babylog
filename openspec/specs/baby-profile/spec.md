# baby-profile Specification

## Purpose

Manages per-user multi-baby profile lifecycle (list, creation up to 10 babies, update, and cascading hard deletion) and the first-time onboarding gate for baby-scoped web workspaces so BabyLog can compute baby age and scope all daily care records under a durable user-owned baby identifier.

## Requirements

### Requirement: Authenticated access to baby profile endpoints
The system MUST require an active User session with `must_change_password: false` for all `/api/babies` and `/api/babies/:babyId` endpoints, rejecting unauthenticated requests with HTTP 401 and pending-password-change requests with HTTP 403.

#### Scenario: Reject unauthenticated baby profile request
- **WHEN** an unauthenticated client sends `GET /api/babies`, `POST /api/babies`, `PUT /api/babies/:babyId`, or `DELETE /api/babies/:babyId`
- **THEN** the server responds with HTTP 401 and a structured Chinese JSON error message

### Requirement: Baby profile retrieval and onboarding status
The system SHALL return only the authenticated User's Baby Profiles ordered by `id ASC` on `GET /api/babies` as `{ "babies": [...] }`, returning an empty array when that User has not created any profile yet regardless of other Users' profiles.

#### Scenario: Retrieve empty profile before onboarding
- **WHEN** User B has no Baby Profiles (even if User A already owns profiles) and sends `GET /api/babies`
- **THEN** the server responds with HTTP 200 and `{ "babies": [] }`

#### Scenario: Retrieve existing baby profile
- **WHEN** User A owns two Baby Profiles and User B owns one Baby Profile, and User A sends `GET /api/babies`
- **THEN** the server responds with HTTP 200 containing only User A's two profiles ordered by `id ASC` with `id`, `nickname`, `birth_date`, `gender`, `birth_weight_kg`, `birth_height_cm`, `default_clinic_name`, `created_at`, and `updated_at`

### Requirement: Baby profile update
The system SHALL allow updating an owned Baby Profile on `PUT /api/babies/:babyId` (with optional `tz=<IANA>`) using the same validation rules as creation and tri-state `default_clinic_name` semantics, returning HTTP 404 when `:babyId` does not exist or belongs to another User.

#### Scenario: Update existing baby profile
- **WHEN** an authenticated User sends valid updated fields to `PUT /api/babies/:babyId` for their own baby
- **THEN** the server updates the profile in SQLite, refreshes `updated_at`, and responds with HTTP 200 with `{ "baby": ... }`

#### Scenario: Preserve or update default_clinic_name on baby profile update
- **WHEN** an authenticated User sends `PUT /api/babies/:babyId` with `default_clinic_name` omitted, then with `default_clinic_name: "阳光街道社区卫生服务中心"`, and then with `default_clinic_name: ""`
- **THEN** omitting the field preserves the stored value, providing a valid name persists it trimmed, providing an empty string clears it, and exceeding 80 characters responds with HTTP 400

#### Scenario: Reject update before onboarding
- **WHEN** an authenticated User with no matching owned baby sends `PUT /api/babies/:babyId`
- **THEN** the server responds with HTTP 404 and a Chinese error message

#### Scenario: Reject updating another user's baby profile
- **WHEN** User B sends `PUT /api/babies/:babyId` using a `babyId` owned by User A
- **THEN** the server responds with HTTP 404 and a Chinese error message without modifying User A's profile

### Requirement: Mandatory onboarding gate in web application
The web application SHALL redirect authenticated Users with no Baby Profiles to `/onboarding` only when visiting baby-scoped workspaces (`/dashboard`, `/feeding`, `/sleep`, `/care`, `/health`, `/growth`, `/vaccines`), while allowing baby-less Users to access account-level routes (`/settings`, `/admin/users`).

#### Scenario: Redirect to onboarding when baby profile is missing
- **WHEN** an authenticated User (including the Administrator) has zero Baby Profiles (`GET /api/babies` returns `{ "babies": [] }`) and visits `/dashboard` versus `/settings` or `/admin/users`
- **THEN** visiting `/dashboard` or any record/vaccine/growth page redirects to `/onboarding`, while `/settings` and (for the Administrator) `/admin/users` render directly without being blocked by onboarding

### Requirement: Multi-baby profile creation
The system SHALL allow each authenticated User to create up to 10 Baby Profiles via `POST /api/babies` (with optional `tz=<IANA>`), allowing duplicate nicknames within the same User, scoping each created profile to the caller's `user_id`, and rejecting creation beyond 10 profiles with HTTP 400.

#### Scenario: Create multiple baby profiles for the same user
- **WHEN** an authenticated User submits valid payloads to `POST /api/babies` twice (including identical or distinct nicknames, required `birth_date` not in the future in `tz`, and `gender` in `male | female | unknown`)
- **THEN** both requests persist distinct profiles owned by that User and respond with HTTP 201

#### Scenario: Enforce maximum of 10 baby profiles per user
- **WHEN** an authenticated User already owns 10 Baby Profiles and submits `POST /api/babies` for an 11th profile
- **THEN** the server responds with HTTP 400 and a Chinese error message without creating a new row, while another User with fewer than 10 profiles can still create babies

#### Scenario: Reject invalid baby profile input
- **WHEN** an authenticated User sends `POST /api/babies` with an empty `nickname`, malformed or future `birth_date`, invalid `gender`, or out-of-range optional birth measurements
- **THEN** the server responds with HTTP 400 and a Chinese error message without persisting any data

### Requirement: Hard deletion of a baby profile
The system SHALL provide `DELETE /api/babies/:babyId` to permanently delete an owned Baby Profile (including the User's last remaining profile) and cascade-delete all associated daily records and vaccine doses via database foreign keys, returning HTTP 404 when `:babyId` does not exist or belongs to another User.

#### Scenario: Hard-delete an owned baby profile and cascade child records
- **WHEN** an authenticated User with daily records and vaccine doses under `babyId` sends `DELETE /api/babies/:babyId`
- **THEN** the server responds with HTTP 200 and `{ "deleted": true }`, removes the `baby_profiles` row and all dependent rows in `feeding_records`, `sleep_records`, `care_records`, `health_records`, and `vaccine_doses`, and frees one slot toward the 10-baby limit

#### Scenario: Reject deleting another user's baby profile
- **WHEN** User B sends `DELETE /api/babies/:babyId` using a `babyId` owned by User A
- **THEN** the server responds with HTTP 404 and a Chinese error message while leaving User A's Baby Profile and all child records intact

### Requirement: Web multi-baby switcher, deletion confirmation, and session state reset
The web application SHALL provide a global baby switcher with per-user persisted `activeBabyId`, require exact nickname input to confirm baby deletion in `/settings`, and clear or reset client caches and open entry drawers on logout, account switch, or baby switch.

#### Scenario: Switch babies and reset drawer state without cross-baby leakage
- **WHEN** a User with two babies switches `activeBabyId` via the sidebar or mobile header baby switcher, or signs out and logs into another User
- **THEN** open quick-record and growth drawers are closed and reset, all baby-scoped queries refetch cleanly under the new `babyId` key, and account switches clear the entire TanStack Query cache

#### Scenario: Require nickname confirmation when deleting a baby profile
- **WHEN** a User initiates deletion of a Baby Profile in `/settings`
- **THEN** the confirmation dialog requires typing the baby's exact nickname before enabling deletion; after deleting a non-last baby the client switches to the first remaining baby, and after deleting the last baby the client redirects to `/onboarding`
