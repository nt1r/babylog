## MODIFIED Requirements

### Requirement: Baby profile retrieval and onboarding status
The system SHALL return the current baby profile on `GET /api/baby` or `{ "baby": null }` when no baby profile has been created yet, allowing the client to enforce first-time onboarding before accessing dashboard and record views.

#### Scenario: Retrieve empty profile before onboarding
- **WHEN** an authenticated administrator with no baby profile sends `GET /api/baby`
- **THEN** the server responds with HTTP 200 and `{ "baby": null }`

#### Scenario: Retrieve existing baby profile
- **WHEN** an authenticated administrator sends `GET /api/baby` after a baby profile has been created
- **THEN** the server responds with HTTP 200 and returns the stored baby profile including `id`, `nickname`, `birth_date`, `gender`, optional `birth_weight_kg`, optional `birth_height_cm`, `default_clinic_name`, `created_at`, and `updated_at`

### Requirement: Baby profile update
The system SHALL allow updating the existing baby profile on `PUT /api/baby` (with optional `tz=<IANA>` query parameter) using the same field validation rules as creation, and SHALL support optional tri-state `default_clinic_name` (up to 80 characters after trimming; omitted preserves the stored value, empty string clears it).

#### Scenario: Update existing baby profile
- **WHEN** an authenticated administrator sends valid updated fields to `PUT /api/baby`
- **THEN** the server updates the profile in SQLite, refreshes `updated_at`, and responds with HTTP 200 with the updated profile

#### Scenario: Preserve or update default_clinic_name on baby profile update
- **WHEN** an authenticated administrator sends `PUT /api/baby` with `default_clinic_name` omitted, then with `default_clinic_name: "阳光街道社区卫生服务中心"`, and then with `default_clinic_name: ""`
- **THEN** omitting the field preserves the stored value, providing a valid name persists it trimmed, providing an empty string clears it, and exceeding 80 characters responds with HTTP 400

#### Scenario: Reject update before onboarding
- **WHEN** no baby profile exists and an authenticated administrator sends `PUT /api/baby`
- **THEN** the server responds with HTTP 404 and a Chinese error message
