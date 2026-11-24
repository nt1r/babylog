# Spec Delta

## MODIFIED Requirements

### Requirement: Filtered, timezone-scoped listing with pagination and daily subtotals
The system SHALL support filtering each record list endpoint by `subtype`, local date range (`today | 7d | 30d | all`), IANA timezone `tz` (default `Asia/Shanghai`), and pagination (`limit`, `offset`), returning reverse-chronological records with local-date subtotals. On `GET /api/records/health`, `subtype` SHALL also accept comma-separated valid subtypes, scoping subtotals to the matched set and rejecting invalid or blank tokens with HTTP 400.

#### Scenario: Filter feeding records by subtype and date range
- **WHEN** an authenticated administrator requests `GET /api/records/feeding?subtype=formula&range=7d&tz=Asia/Shanghai&limit=20&offset=0`
- **THEN** the server returns HTTP 200 with matching formula records within the past 7 local days ordered by `recorded_at DESC`, pagination metadata (`total`, `has_more`), and per-day subtotals

#### Scenario: Filter health records by comma-separated subtype group
- **WHEN** an authenticated administrator with temperature, medicine, growth, and teeth records requests `GET /api/records/health?subtype=temperature,medicine&range=30d&tz=Asia/Shanghai` or `GET /api/records/health?subtype=growth,teeth&range=all&tz=Asia/Shanghai`
- **THEN** the server responds with HTTP 200 containing only records belonging to the requested subtypes, accurate `total` and `has_more` counts, and `daily_summaries` computed solely from the matched subtypes

#### Scenario: Reject invalid or empty token in comma-separated health subtype filter
- **WHEN** a client requests `GET /api/records/health?subtype=temperature,unknown` or `GET /api/records/health?subtype=growth,`
- **THEN** the server responds with HTTP 400 and a Chinese validation error message

#### Scenario: Reject unknown record ID on update or delete
- **WHEN** an authenticated administrator calls `PUT` or `DELETE` with a non-existent record ID
- **THEN** the server responds with HTTP 404 and a Chinese error message
