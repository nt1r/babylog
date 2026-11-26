# dashboard-insights Specification

## Purpose

Provides timezone-aware daily KPI summaries, time-since-last-care indicators, cross-midnight sleep splitting, 7-day feeding and sleep trends, and time-of-day rhythm distributions for the BabyLog dashboard.

## Requirements

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
The web application SHALL organize navigation into four flat sidebar groups (`成长概览`: `/dashboard`, `/insights`; `日常照护`: `/feeding`, `/sleep`, `/care`; `健康与成长`: `/health`, `/vaccines`, `/growth`; `设置`: `/settings`, admin-only `/admin/users`), display a global baby switcher, keep `/health` focused on temperature and medicine, and provide `/growth` with a growth overview card, WHO curve with delta hints and PNG export, and history list defaulting to `all`.

#### Scenario: View separated Health and Growth pages
- **WHEN** an authenticated User navigates `/insights`, `/health`, and `/growth` and inspects the `成长概览`, `健康与成长`, and `设置` sidebar groups
- **THEN** `/insights` appears under `成长概览`, `/health` filters and displays only `temperature` and `medicine` records (`全部 / 体温 / 用药`), `/growth` displays a top overview card with latest measurements and growth delta hints above the exportable WHO curve and reverse-chronological list of `growth` and `teeth` records defaulting to `all`, and `/admin/users` appears only when `user.role === "admin"`

### Requirement: Separated high-frequency Quick Record and date-only Growth entry drawers
The web application SHALL focus the global Quick Record drawer on four high-frequency categories (`feeding`, `sleep`, `care`, and `health` limited to `temperature` and `medicine`) with habit-based prefill and low-friction shortcuts, and provide a dedicated date-only Growth drawer (`growth` and `teeth`) with latest measurement hints and dynamic next-tooth presets.

#### Scenario: Create a historical growth record with date-only input
- **WHEN** an authenticated administrator opens the Growth drawer from `/growth` or the dashboard Growth card, selects a past date `YYYY-MM-DD`, enters a weight or teething note, and submits
- **THEN** the client displays the baby's latest recorded weight/height/head measurements as reference hints and dynamic next-tooth presets based on `teeth_count`, saves the record via `/api/babies/:babyId/records/health` using local `12:00` for past dates (or the current local timestamp when today is selected) without showing high-frequency minute-offset chips, and refreshes both the growth overview and list

#### Scenario: Apply habit-based prefill and shortcuts in Quick Record and Health workspace
- **WHEN** an authenticated administrator opens Quick Record for feeding, sleep, care, or health, or visits `/health`
- **THEN** feeding prefills breastfeeding mode/duration and pairs solid food chips with recent portions, sleep prefills median-based duration with a `45 分钟` quick chip, diaper poop details offer a one-tap `正常（软便 · 黄色）` shortcut, and health offers medicine dosage quick chips, history-matched dosage autofill, and one-tap recent medicine quick-log on `/health`

### Requirement: Dashboard vaccine alerts, Health Observation KPI, and Growth & Immunity cards
The web dashboard SHALL display a time-aware Hero card with Baby Profile summary, a conditional non-dismissible vaccine alert banner above the 2×2/4-column one-tap tiles (adapting feeding to recent habit), four KPI cards (`今日喂养`, `今日睡眠`, `今日护理`, `健康观察`) plus an independent 48h post-vaccination temperature cue bar, a 7/30-day care trend card with a link to `/insights`, and symmetric `疫苗接种计划` and `最新生长发育` cards.

#### Scenario: Surface Hero card, persistent vaccine alert banner, and symmetric Growth & Immunity cards
- **WHEN** an authenticated administrator opens `/dashboard` while the baby has urgent booked appointments (`scheduled_overdue`, `scheduled_soon`), unconfirmed birth-hospital vaccines, or `overdue`/`due_soon` doses
- **THEN** `/dashboard` displays the time-aware Hero card with Baby Profile link to `/growth`, renders a non-dismissible wrapping alert banner below the Hero card (prioritizing urgent booked appointments over birth confirmation) linking to `/vaccines`, renders 2×2/4-column one-tap tiles and KPI cards in `喂养 / 睡眠 / 护理 / 健康观察` order above the care trend card (supporting `近 7 天 / 近 30 天` quick toggle and linking to `/insights`), and displays symmetric `疫苗接种计划` and `最新生长发育` cards below the charts

#### Scenario: Prioritize Health Observation KPI and independent post-vaccination 48h temperature cue
- **WHEN** the baby has a temperature recorded within the last 48 hours, or has today's medicine without a recent 48-hour temperature, or completed a vaccine dose within the last 48 hours
- **THEN** the `健康观察` KPI card prioritizes recent 48-hour temperature first (alerting on fever within 48 hours) and today's medicine count/name second while showing older temperatures neutrally, and when a vaccine was completed within 48 hours displays a standalone wrapping temperature observation bar (independent of `/api/babies/:babyId/dashboard/summary` error state) with a one-tap action opening the Quick Record drawer to `health` (`temperature`)

### Requirement: Batch backfill drawer for feeding and care records
The web application SHALL provide a dedicated Batch Backfill drawer accessible from the dashboard one-tap header, `/feeding` and `/care` pages, Quick Record create mode, and Command Palette, letting caregivers pick one date/time, optionally fill direct breastfeeding, bottled breast milk, formula, pee, and poop (merging pee+poop into `both`), continue consecutive time points with sticky date and relative time chips, and undo session batches.

#### Scenario: Submit selected feeding and care items at one time point and skip untouched items
- **WHEN** an authenticated User opens the Batch Backfill drawer, selects a date and time, fills direct breastfeeding and formula milk while toggling both pee and poop (with optional stool details) and leaving bottled breast milk blank, and submits
- **THEN** the client sends a single `POST /api/babies/:babyId/records/batch` request containing the filled feeding items and one merged `diaper_kind: "both"` care item (applying any optional shared note to each created item), skips untouched items, and refreshes record lists, smart defaults, and dashboard queries

#### Scenario: Continue consecutive time points with sticky date, relative time chips, and session undo
- **WHEN** an authenticated User clicks `保存并继续` in the Batch Backfill drawer after submitting a time point
- **THEN** the drawer stays open, preserves the submitted date, clears the time input while offering valid relative jump chips (`-3h`, `-2h`, `+2h`, `+3h`) derived from the last submitted time, resets the five item inputs and note, displays a non-blocking warning if a previously submitted session timestamp is chosen again, and records the batch in a collapsible session log supporting one-tap undo via existing delete endpoints

### Requirement: Multi-dimension trend breakdown and period insights
The system SHALL enrich `GET /api/babies/:babyId/dashboard/trends?days=<1..90>&tz=<IANA>` with per-day feeding breakdowns (`formula_ml`, `formula_count`, `bottle_breast_ml`, `bottle_breast_count`, `solid_count`, `feeding_count`), sleep splits (`nap_hours`, `night_hours`, `nap_count`), care counts (`pee_count`, `poop_count`, `bath_count`), health observations (`max_temp_c`, `medicine_count`), and a `period_summary` scoped strictly to `:babyId`.

#### Scenario: Break down feeding, sleep, care, and health metrics per local day
- **WHEN** an authenticated User records formula milk, bottled breast milk, direct breastfeeding, solid food, a daytime nap, a cross-midnight night sleep, diapers (`pee`, `poop`, `both`), a bath, two temperatures, and medicine within a 30-day window and calls `GET /api/babies/:babyId/dashboard/trends?days=30&tz=Asia/Shanghai`
- **THEN** each local day bucket returns exact `formula_ml`, `formula_count`, `bottle_breast_ml`, `bottle_breast_count`, `solid_count`, `feeding_count` (with `feeding_ml = formula_ml + bottle_breast_ml`), split `nap_hours`/`night_hours`/`nap_count`, `pee_count`/`poop_count`/`bath_count`, daily `max_temp_c` (`null` on days without temperature), and `medicine_count`

#### Scenario: Compute period summary for side balance, solid acceptance, sleep continuity, stool flags, and active days
- **WHEN** an authenticated User queries `GET /api/babies/:babyId/dashboard/trends?days=30&tz=Asia/Shanghai` across records containing left/right/both direct feeds, solid acceptance ratings, daytime naps and night sleeps, and watery/hard/abnormal-color stool entries
- **THEN** `period_summary` returns exact `active_days` (`feeding_days`, `sleep_days`, `care_days`), `breast_side` (`left_count`, `right_count`, `both_count`), `solid_acceptance` (`like_count`, `neutral_count`, `dislike_count`), `sleep` (`longest_night_min`, `avg_nap_min`), and `stool` (`total_poop_count`, `watery_count`, `hard_count`, `abnormal_color_count`), returning all zeros on empty windows

### Requirement: Multi-dimension Insights page and chart image export
The web application SHALL provide a dedicated `/insights` (`统计分析`) page with `近 7 天 / 近 14 天 / 近 30 天 / 近 90 天` range presets, recorded-day average summaries, multi-dimension charts for feeding, sleep, care, and on-demand health trends, one-tap PNG chart image export on `/insights` and `/growth`, and phase-growth delta hints on `/growth`.

#### Scenario: Explore multi-dimension trends across extended time ranges on Insights page
- **WHEN** an authenticated User opens `/insights` and switches between `近 7 天`, `近 14 天`, `近 30 天`, and `近 90 天`
- **THEN** the page requests `GET /api/babies/:babyId/dashboard/trends` for the selected range, displays recorded-day average KPIs, renders feeding breakdown (milk structure, direct breastfeeding duration/side balance, feeding counts, and conditional solid summary), daytime vs. nighttime sleep with continuity metrics, pee/poop trends with conditional stool notice, and an on-demand temperature/medicine chart when temperature records exist

#### Scenario: Export a trend chart or WHO growth curve as a PNG image
- **WHEN** an authenticated User clicks the save-image action on any chart card in `/insights` or on the WHO growth curve in `/growth`
- **THEN** the client renders the chart at 2x resolution with resolved theme colors, solid card background, chart title, baby nickname/age, date range subtitle, and legend, and downloads a PNG file without altering page state

### Requirement: Excel export drawer and filter controls
The web application SHALL provide an Excel export drawer accessible from `/insights` and Command Palette letting caregivers pick a preset range (`近 7 天 / 近 14 天 / 近 30 天 / 近 90 天`) or custom inclusive start/end dates (up to 366 days) and select any non-empty subset of categories (`feeding`, `sleep`, `care`, `health`, `growth`) to download an `.xlsx` workbook.

#### Scenario: Export selected categories and custom date range to Excel
- **WHEN** an authenticated User opens the export drawer, chooses a custom start and end date, selects `喂养` and `护理`, and confirms export
- **THEN** the client requests `GET /api/babies/:babyId/export/xlsx` with the chosen `start`, `end`, `categories`, and browser IANA `tz`, downloads the returned `.xlsx` file, and shows feedback if validation or download fails
