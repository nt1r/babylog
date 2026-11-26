## ADDED Requirements

### Requirement: Atomic batch creation of feeding and care records
The system SHALL provide `POST /api/babies/:babyId/records/batch` accepting `{ feedings, cares }` arrays of standard feeding and care payloads (1 to 20 total items), validating every entry under one server clock before persisting all records in a single database transaction under `:babyId`, and returning HTTP 201 with `{ feedings, cares }` or rolling back completely on any validation failure.

#### Scenario: Create feeding and care records atomically in a single batch
- **WHEN** an authenticated User submits `POST /api/babies/:babyId/records/batch` with direct breastfeeding, bottled breast milk, formula milk, and a merged `both` diaper record sharing a `recorded_at` and optional note
- **THEN** the server persists all records in one transaction under `:babyId`, responds with HTTP 201 containing 3 `feedings` and 1 `cares` record, and subsequent list, daily summary, smart defaults, and dashboard queries reflect every created record

#### Scenario: Reject empty or oversized batch record payload
- **WHEN** an authenticated User submits `POST /api/babies/:babyId/records/batch` with zero total items or more than 20 total items
- **THEN** the server responds with HTTP 400 and a Chinese validation error message without persisting any records

#### Scenario: Roll back entire batch when any item fails validation
- **WHEN** an authenticated User submits `POST /api/babies/:babyId/records/batch` containing a valid feeding entry alongside an invalid care entry or a timestamp more than 5 minutes ahead of server UTC time
- **THEN** the server responds with HTTP 400 and a Chinese validation error message and persists zero records to `feeding_records` or `care_records`

#### Scenario: Reject batch record write for unauthenticated or foreign baby scope
- **WHEN** an unauthenticated client, a User with `must_change_password: true`, or another User submits `POST /api/babies/:babyId/records/batch`
- **THEN** the server responds with HTTP 401, 403, or 404 respectively with a Chinese error message and persists zero records
