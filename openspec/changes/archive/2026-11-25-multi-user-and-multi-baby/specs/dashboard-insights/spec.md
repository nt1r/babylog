## MODIFIED Requirements

### Requirement: Authenticated access to dashboard endpoints
The system MUST require an active User session with `must_change_password: false` and an owned `:babyId` path parameter for all `/api/babies/:babyId/dashboard/*` endpoints, returning HTTP 401 when unauthenticated, HTTP 403 when password change is pending, and HTTP 404 when `:babyId` is unknown or owned by another User.

#### Scenario: Reject unauthenticated dashboard request
- **WHEN** an unauthenticated client requests `GET /api/babies/:babyId/dashboard/summary` or `GET /api/babies/:babyId/dashboard/trends`
- **THEN** the server responds with HTTP 401 and a Chinese error message

#### Scenario: Reject dashboard request before baby onboarding
- **WHEN** an authenticated User with no owned Baby Profile requests `GET /api/babies/:babyId/dashboard/summary`
- **THEN** the server responds with HTTP 404 and a Chinese error message

#### Scenario: Reject dashboard request for foreign baby ID
- **WHEN** User B requests `GET /api/babies/:babyId/dashboard/summary` using a `babyId` owned by User A
- **THEN** the server responds with HTTP 404 and a Chinese error message without exposing User A's dashboard metrics

### Requirement: Timezone-aware daily KPI summary and recency indicators
The system SHALL provide `GET /api/babies/:babyId/dashboard/summary?tz=<IANA>` (default `Asia/Shanghai`) returning today's feeding total, midnight-split sleep total, today's care counts with last feeding/diaper timestamps, health highlights, and growth highlights scoped strictly to `:babyId`.

#### Scenario: Compute today summary in specified timezone
- **WHEN** an authenticated User records a 120 ml formula feed for `:babyId` at `2026-11-23T00:30:00+08:00` (which is `2026-11-22T16:30:00Z`) and requests `GET /api/babies/:babyId/dashboard/summary?tz=Asia/Shanghai` on `2026-11-23`
- **THEN** the server counts that 120 ml toward `2026-11-23` today feeding total for `:babyId` and returns its timestamp as `last_feeding_at`

#### Scenario: Split cross-midnight sleep across local natural days
- **WHEN** a baby sleeps from `2026-11-22T22:00:00+08:00` to `2026-11-23T06:00:00+08:00` and the client queries `GET /api/babies/:babyId/dashboard/summary?tz=Asia/Shanghai` on `2026-11-23`
- **THEN** the server counts only the 360 minutes (6.0 hours) falling on `2026-11-23` in today's sleep total

#### Scenario: Aggregate today's medicine count and latest medicine in requested timezone
- **WHEN** an authenticated User records `维生素 D3` at `2026-11-23T08:30:00+08:00` and `布洛芬` at `2026-11-23T14:00:00+08:00` plus an earlier medicine record on `2026-11-22` and requests `GET /api/babies/:babyId/dashboard/summary?tz=Asia/Shanghai` on `2026-11-23`
- **THEN** the `health` summary returns `today_medicine_count: 2`, `latest_medicine_name: "布洛芬"`, and `latest_medicine_at` matching the `14:00` record

#### Scenario: Independently resolve partial growth measurements and apply birth-profile fallback
- **WHEN** a baby profile has `birth_weight_kg: 3.3` and `birth_height_cm: 50.0`, an older growth record records `height_cm: 62.5` only, a newer growth record records `weight_kg: 7.2` only, no head circumference is recorded, and two `teeth` records exist
- **THEN** the `growth` summary returns `latest_weight_kg: 7.2` (`weight_is_birth: false`), `latest_height_cm: 62.5` (`height_is_birth: false`), `latest_head_cm: null`, `teeth_count: 2`, and the newest `latest_tooth_note`; and if no growth record contains height, `latest_height_cm` falls back to `50.0` with `height_is_birth: true` and `height_recorded_at` set to `birth_date`

#### Scenario: Reject invalid IANA timezone parameter
- **WHEN** a client sends `GET /api/babies/:babyId/dashboard/summary?tz=Invalid/Zone`
- **THEN** the server responds with HTTP 400 and a Chinese error message

### Requirement: Seven-day feeding, sleep, and care rhythm trends
The system SHALL provide `GET /api/babies/:babyId/dashboard/trends?days=7&tz=<IANA>` returning a contiguous array of local dates with daily feeding `ml`, daily direct breastfeeding minutes (`direct_breast_min`), daily direct breastfeeding count (`direct_breast_count`), and daily split sleep hours, plus a 5-slot time-of-day distribution (`清晨` 05:00-08:59, `上午` 09:00-11:59, `下午` 12:00-17:59, `傍晚` 18:00-20:59, `夜间` 21:00-04:59) strictly scoped to `:babyId`.

#### Scenario: Return contiguous 7-day trend series with zero-filled empty days
- **WHEN** an authenticated User with records on only 2 of the last 7 local days for `:babyId` requests `GET /api/babies/:babyId/dashboard/trends?days=7&tz=Asia/Shanghai`
- **THEN** the server responds with HTTP 200 containing exactly 7 ordered day buckets with zero values (including `feeding_ml: 0`, `direct_breast_min: 0`, `direct_breast_count: 0`, and `sleep_hours: 0`) on days without records and 5 ordered time-of-day rhythm buckets

#### Scenario: Split cross-midnight sleep accurately across consecutive trend days
- **WHEN** a sleep record spans `22:00` on day N to `06:00` on day N+1 in the requested timezone
- **THEN** day N includes 2.0 hours and day N+1 includes 6.0 hours in the 7-day sleep trend

#### Scenario: Aggregate daily direct breastfeeding minutes and counts in local timezone
- **WHEN** an authenticated User records direct breastfeeding sessions on a local date (including sessions crossing the UTC day boundary) and requests `GET /api/babies/:babyId/dashboard/trends?days=7&tz=Asia/Shanghai`
- **THEN** the corresponding local date bucket returns the summed `direct_breast_min` and `direct_breast_count` for direct breastfeeding records without adding them to `feeding_ml`

### Requirement: Unified Health and Growth navigation and Growth workspace
The web application SHALL organize navigation into four flat sidebar groups (`成长概览`: `/dashboard`; `日常照护`: `/feeding`, `/sleep`, `/care`; `健康与成长`: `/health`, `/vaccines`, `/growth`; `设置`: `/settings` plus admin-only `/admin/users`), display a global baby switcher in the sidebar header and mobile header, keep `/health` focused on temperature and medicine, and provide `/growth` with a top growth overview card and a date-formatted history list defaulting to `all`.

#### Scenario: View separated Health and Growth pages
- **WHEN** an authenticated User navigates `/health` and `/growth` under `健康与成长` and inspects the `设置` sidebar group
- **THEN** `/health` filters and displays only `temperature` and `medicine` records (`全部 / 体温 / 用药`), `/growth` displays a top overview card above a reverse-chronological date-formatted list of `growth` and `teeth` records defaulting to `all`, and `/admin/users` appears in navigation only when `user.role === "admin"`
