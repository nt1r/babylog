# Spec Delta

## MODIFIED Requirements

### Requirement: Timezone-aware daily KPI summary and recency indicators
The system SHALL provide `GET /api/dashboard/summary?tz=<IANA>` (default `Asia/Shanghai`) returning today's feeding total, midnight-split sleep total, today's care counts with last feeding/diaper timestamps, health highlights (latest temperature, today's medicine count and latest medicine), and growth highlights (independent latest weight/height/head with Baby Profile birth fallback flags, plus cumulative teething count and latest note).

#### Scenario: Compute today summary in specified timezone
- **WHEN** an authenticated administrator records a 120 ml formula feed at `2026-11-23T00:30:00+08:00` (which is `2026-11-22T16:30:00Z`) and requests `GET /api/dashboard/summary?tz=Asia/Shanghai` on `2026-11-23`
- **THEN** the server counts that 120 ml toward `2026-11-23` today feeding total and returns its timestamp as `last_feeding_at`

#### Scenario: Split cross-midnight sleep across local natural days
- **WHEN** a baby sleeps from `2026-11-22T22:00:00+08:00` to `2026-11-23T06:00:00+08:00` and the client queries `GET /api/dashboard/summary?tz=Asia/Shanghai` on `2026-11-23`
- **THEN** the server counts only the 360 minutes (6.0 hours) falling on `2026-11-23` in today's sleep total

#### Scenario: Aggregate today's medicine count and latest medicine in requested timezone
- **WHEN** an authenticated administrator records `维生素 D3` at `2026-11-23T08:30:00+08:00` and `布洛芬` at `2026-11-23T14:00:00+08:00` plus an earlier medicine record on `2026-11-22` and requests `GET /api/dashboard/summary?tz=Asia/Shanghai` on `2026-11-23`
- **THEN** the `health` summary returns `today_medicine_count: 2`, `latest_medicine_name: "布洛芬"`, and `latest_medicine_at` matching the `14:00` record

#### Scenario: Independently resolve partial growth measurements and apply birth-profile fallback
- **WHEN** a baby profile has `birth_weight_kg: 3.3` and `birth_height_cm: 50.0`, an older growth record records `height_cm: 62.5` only, a newer growth record records `weight_kg: 7.2` only, no head circumference is recorded, and two `teeth` records exist
- **THEN** the `growth` summary returns `latest_weight_kg: 7.2` (`weight_is_birth: false`), `latest_height_cm: 62.5` (`height_is_birth: false`), `latest_head_cm: null`, `teeth_count: 2`, and the newest `latest_tooth_note`; and if no growth record contains height, `latest_height_cm` falls back to `50.0` with `height_is_birth: true` and `height_recorded_at` set to `birth_date`

#### Scenario: Reject invalid IANA timezone parameter
- **WHEN** a client sends `GET /api/dashboard/summary?tz=Invalid/Zone`
- **THEN** the server responds with HTTP 400 and a Chinese error message

## ADDED Requirements

### Requirement: Unified Health and Growth navigation and Growth workspace
The web application SHALL organize navigation into four flat sidebar groups (`成长概览`: `/dashboard`; `日常照护`: `/feeding`, `/sleep`, `/care`; `健康与成长`: `/health`, `/vaccines`, `/growth`; `设置`: `/settings`), keeping `/health` focused on temperature and medicine and providing `/growth` with a top growth overview card and a date-formatted history list defaulting to `all`.

#### Scenario: View separated Health and Growth pages
- **WHEN** an authenticated administrator navigates to `/health` and `/growth` under the `健康与成长` sidebar group
- **THEN** `/health` filters and displays only `temperature` and `medicine` records (`全部 / 体温 / 用药`), while `/growth` displays a top overview card (latest weight, height, head circumference with birth fallback indicator, and `已出 N 颗` teeth summary) above a reverse-chronological date-formatted list of `growth` and `teeth` records defaulting to `all`

### Requirement: Separated high-frequency Quick Record and date-only Growth entry drawers
The web application SHALL focus the global Quick Record drawer on four high-frequency categories (`feeding`, `sleep`, `care`, and `health` limited to `temperature` and `medicine`) and provide a dedicated date-only Growth drawer (`growth` and `teeth`) invoked from `/growth`, the dashboard Growth card, and the mobile `+` button while on `/growth`.

#### Scenario: Create a historical growth record with date-only input
- **WHEN** an authenticated administrator opens the Growth drawer from `/growth` or the dashboard Growth card, selects a past date `YYYY-MM-DD`, enters a weight or teething note, and submits
- **THEN** the client saves the record via `/api/records/health` using local `12:00` for past dates (or the current local timestamp when today is selected) without showing high-frequency minute-offset chips, and refreshes both the growth overview and list

### Requirement: Dashboard vaccine alerts, Health Observation KPI, and Growth & Immunity cards
The web dashboard SHALL display a time-aware picture-book Hero card with Baby Profile summary, a persistent non-dismissible vaccine alert banner above the 2×2/4-column one-tap quick-record tiles when attention states exist, four reordered KPI cards (`今日喂养`, `今日睡眠`, `今日护理`, `健康观察`) in a 2×2/4-column grid plus an independent 48h post-vaccination temperature cue bar, `近 7 日照护趋势`, symmetric `疫苗接种计划` and `最新生长发育` cards below the charts, and omit the bottom quick-record cards.

#### Scenario: Surface Hero card, persistent vaccine alert banner, and symmetric Growth & Immunity cards
- **WHEN** an authenticated administrator opens `/dashboard` while the baby has urgent booked appointments (`scheduled_overdue`, `scheduled_soon`), unconfirmed birth-hospital vaccines, or `overdue`/`due_soon` doses
- **THEN** `/dashboard` displays the time-aware Hero card with Baby Profile link to `/growth`, renders a non-dismissible wrapping alert banner below the Hero card (prioritizing urgent booked appointments over birth confirmation) linking to `/vaccines`, renders 2×2/4-column one-tap tiles and KPI cards in `喂养 / 睡眠 / 护理 / 健康观察` order above `近 7 日照护趋势`, and displays symmetric `疫苗接种计划` and `最新生长发育` cards below the charts

#### Scenario: Prioritize Health Observation KPI and independent post-vaccination 48h temperature cue
- **WHEN** the baby has a temperature recorded within the last 48 hours, or has today's medicine without a recent 48-hour temperature, or completed a vaccine dose within the last 48 hours
- **THEN** the `健康观察` KPI card prioritizes recent 48-hour temperature first (alerting on fever within 48 hours) and today's medicine count/name second while showing older temperatures neutrally, and when a vaccine was completed within 48 hours displays a standalone wrapping temperature observation bar (independent of `/api/dashboard/summary` error state) with a one-tap action opening the Quick Record drawer to `health` (`temperature`)
