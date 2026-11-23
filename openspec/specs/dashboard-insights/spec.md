# dashboard-insights Specification

## Purpose

Provides timezone-aware daily KPI summaries, time-since-last-care indicators, cross-midnight sleep splitting, 7-day feeding and sleep trends, and time-of-day rhythm distributions for the BabyLog dashboard.

## Requirements

### Requirement: Authenticated access to dashboard endpoints
The system MUST require an active administrator session and initialized baby profile for all `/api/dashboard/*` endpoints.

#### Scenario: Reject unauthenticated dashboard request
- **WHEN** an unauthenticated client requests `GET /api/dashboard/summary` or `GET /api/dashboard/trends`
- **THEN** the server responds with HTTP 401 and a Chinese error message

#### Scenario: Reject dashboard request before baby onboarding
- **WHEN** an authenticated administrator with no baby profile requests `GET /api/dashboard/summary`
- **THEN** the server responds with HTTP 409 indicating that baby onboarding must be completed first

### Requirement: Timezone-aware daily KPI summary and recency indicators
The system SHALL provide `GET /api/dashboard/summary?tz=<IANA>` (defaulting `tz` to `Asia/Shanghai`) returning today's feeding total (`ml` from formula plus bottled breast milk, direct breastfeeding count and minutes), today's sleep total (minutes split by local midnight, nap count, night sleep minutes), latest recorded temperature with timestamp, today's care counts (total, pee, poop), and timestamps of the last feeding and last diaper change.

#### Scenario: Compute today summary in specified timezone
- **WHEN** an authenticated administrator records a 120 ml formula feed at `2026-11-23T00:30:00+08:00` (which is `2026-11-22T16:30:00Z`) and requests `GET /api/dashboard/summary?tz=Asia/Shanghai` on `2026-11-23`
- **THEN** the server counts that 120 ml toward `2026-11-23` today feeding total and returns its timestamp as `last_feeding_at`

#### Scenario: Split cross-midnight sleep across local natural days
- **WHEN** a baby sleeps from `2026-11-22T22:00:00+08:00` to `2026-11-23T06:00:00+08:00` and the client queries `GET /api/dashboard/summary?tz=Asia/Shanghai` on `2026-11-23`
- **THEN** the server counts only the 360 minutes (6.0 hours) falling on `2026-11-23` in today's sleep total

#### Scenario: Reject invalid IANA timezone parameter
- **WHEN** a client sends `GET /api/dashboard/summary?tz=Invalid/Zone`
- **THEN** the server responds with HTTP 400 and a Chinese error message

### Requirement: Seven-day feeding, sleep, and care rhythm trends
The system SHALL provide `GET /api/dashboard/trends?days=7&tz=<IANA>` returning a contiguous array of local dates with daily feeding `ml`, daily direct breastfeeding minutes (`direct_breast_min`), daily direct breastfeeding count (`direct_breast_count`), and daily split sleep hours, plus a 5-slot time-of-day distribution (`清晨` 05:00-08:59, `上午` 09:00-11:59, `下午` 12:00-17:59, `傍晚` 18:00-20:59, `夜间` 21:00-04:59) across the window.

#### Scenario: Return contiguous 7-day trend series with zero-filled empty days
- **WHEN** an authenticated administrator with records on only 2 of the last 7 local days requests `GET /api/dashboard/trends?days=7&tz=Asia/Shanghai`
- **THEN** the server responds with HTTP 200 containing exactly 7 ordered day buckets with zero values (including `feeding_ml: 0`, `direct_breast_min: 0`, `direct_breast_count: 0`, and `sleep_hours: 0`) on days without records and 5 ordered time-of-day rhythm buckets

#### Scenario: Split cross-midnight sleep accurately across consecutive trend days
- **WHEN** a sleep record spans `22:00` on day N to `06:00` on day N+1 in the requested timezone
- **THEN** day N includes 2.0 hours and day N+1 includes 6.0 hours in the 7-day sleep trend

#### Scenario: Aggregate daily direct breastfeeding minutes and counts in local timezone
- **WHEN** an authenticated administrator records direct breastfeeding sessions on a local date (including sessions crossing the UTC day boundary) and requests `GET /api/dashboard/trends?days=7&tz=Asia/Shanghai`
- **THEN** the corresponding local date bucket returns the summed `direct_breast_min` and `direct_breast_count` for direct breastfeeding records without adding them to `feeding_ml`
