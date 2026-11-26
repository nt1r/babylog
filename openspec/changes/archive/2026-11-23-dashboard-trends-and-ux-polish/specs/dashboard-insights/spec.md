# Spec Delta: dashboard-insights

## MODIFIED Requirements

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
