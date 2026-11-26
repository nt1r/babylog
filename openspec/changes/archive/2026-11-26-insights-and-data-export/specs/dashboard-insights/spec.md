## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Unified Health and Growth navigation and Growth workspace
The web application SHALL organize navigation into four flat sidebar groups (`成长概览`: `/dashboard`, `/insights`; `日常照护`: `/feeding`, `/sleep`, `/care`; `健康与成长`: `/health`, `/vaccines`, `/growth`; `设置`: `/settings`, admin-only `/admin/users`), display a global baby switcher, keep `/health` focused on temperature and medicine, and provide `/growth` with a growth overview card, WHO curve with delta hints and PNG export, and history list defaulting to `all`.

#### Scenario: View separated Health and Growth pages
- **WHEN** an authenticated User navigates `/insights`, `/health`, and `/growth` and inspects the `成长概览`, `健康与成长`, and `设置` sidebar groups
- **THEN** `/insights` appears under `成长概览`, `/health` filters and displays only `temperature` and `medicine` records (`全部 / 体温 / 用药`), `/growth` displays a top overview card with latest measurements and growth delta hints above the exportable WHO curve and reverse-chronological list of `growth` and `teeth` records defaulting to `all`, and `/admin/users` appears only when `user.role === "admin"`

### Requirement: Dashboard vaccine alerts, Health Observation KPI, and Growth & Immunity cards
The web dashboard SHALL display a time-aware Hero card with Baby Profile summary, a conditional non-dismissible vaccine alert banner above the 2×2/4-column one-tap tiles (adapting feeding to recent habit), four KPI cards (`今日喂养`, `今日睡眠`, `今日护理`, `健康观察`) plus an independent 48h post-vaccination temperature cue bar, a 7/30-day care trend card with a link to `/insights`, and symmetric `疫苗接种计划` and `最新生长发育` cards.

#### Scenario: Surface Hero card, persistent vaccine alert banner, and symmetric Growth & Immunity cards
- **WHEN** an authenticated administrator opens `/dashboard` while the baby has urgent booked appointments (`scheduled_overdue`, `scheduled_soon`), unconfirmed birth-hospital vaccines, or `overdue`/`due_soon` doses
- **THEN** `/dashboard` displays the time-aware Hero card with Baby Profile link to `/growth`, renders a non-dismissible wrapping alert banner below the Hero card (prioritizing urgent booked appointments over birth confirmation) linking to `/vaccines`, renders 2×2/4-column one-tap tiles and KPI cards in `喂养 / 睡眠 / 护理 / 健康观察` order above the care trend card (supporting `近 7 天 / 近 30 天` quick toggle and linking to `/insights`), and displays symmetric `疫苗接种计划` and `最新生长发育` cards below the charts

#### Scenario: Prioritize Health Observation KPI and independent post-vaccination 48h temperature cue
- **WHEN** the baby has a temperature recorded within the last 48 hours, or has today's medicine without a recent 48-hour temperature, or completed a vaccine dose within the last 48 hours
- **THEN** the `健康观察` KPI card prioritizes recent 48-hour temperature first (alerting on fever within 48 hours) and today's medicine count/name second while showing older temperatures neutrally, and when a vaccine was completed within 48 hours displays a standalone wrapping temperature observation bar (independent of `/api/babies/:babyId/dashboard/summary` error state) with a one-tap action opening the Quick Record drawer to `health` (`temperature`)
