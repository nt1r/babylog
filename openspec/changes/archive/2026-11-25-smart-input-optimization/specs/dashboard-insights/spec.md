## MODIFIED Requirements

### Requirement: Separated high-frequency Quick Record and date-only Growth entry drawers
The web application SHALL focus the global Quick Record drawer on four high-frequency categories (`feeding`, `sleep`, `care`, and `health` limited to `temperature` and `medicine`) with habit-based prefill and low-friction shortcuts, and provide a dedicated date-only Growth drawer (`growth` and `teeth`) with latest measurement hints and dynamic next-tooth presets.

#### Scenario: Create a historical growth record with date-only input
- **WHEN** an authenticated administrator opens the Growth drawer from `/growth` or the dashboard Growth card, selects a past date `YYYY-MM-DD`, enters a weight or teething note, and submits
- **THEN** the client displays the baby's latest recorded weight/height/head measurements as reference hints and dynamic next-tooth presets based on `teeth_count`, saves the record via `/api/records/health` using local `12:00` for past dates (or the current local timestamp when today is selected) without showing high-frequency minute-offset chips, and refreshes both the growth overview and list

#### Scenario: Apply habit-based prefill and shortcuts in Quick Record and Health workspace
- **WHEN** an authenticated administrator opens Quick Record for feeding, sleep, care, or health, or visits `/health`
- **THEN** feeding prefills breastfeeding mode/duration and pairs solid food chips with recent portions, sleep prefills median-based duration with a `45 分钟` quick chip, diaper poop details offer a one-tap `正常（软便 · 黄色）` shortcut, and health offers medicine dosage quick chips, history-matched dosage autofill, and one-tap recent medicine quick-log on `/health`

### Requirement: Dashboard vaccine alerts, Health Observation KPI, and Growth & Immunity cards
The web dashboard SHALL display a time-aware Hero card with Baby Profile summary, a conditional non-dismissible vaccine alert banner above the 2×2/4-column one-tap quick-record tiles (whose feeding tile adapts to the baby's latest feeding habit), four KPI cards (`今日喂养`, `今日睡眠`, `今日护理`, `健康观察`) plus an independent 48h post-vaccination temperature cue bar, `近 7 日照护趋势`, and symmetric `疫苗接种计划` and `最新生长发育` cards.

#### Scenario: Surface Hero card, persistent vaccine alert banner, and symmetric Growth & Immunity cards
- **WHEN** an authenticated administrator opens `/dashboard` while the baby has urgent booked appointments (`scheduled_overdue`, `scheduled_soon`), unconfirmed birth-hospital vaccines, or `overdue`/`due_soon` doses
- **THEN** `/dashboard` displays the time-aware Hero card with Baby Profile link to `/growth`, renders a non-dismissible wrapping alert banner below the Hero card (prioritizing urgent booked appointments over birth confirmation) linking to `/vaccines`, renders 2×2/4-column one-tap tiles (adapting the feeding tile to formula, bottled breast milk, or direct breastfeeding with alternating side and recent duration) and KPI cards in `喂养 / 睡眠 / 护理 / 健康观察` order above `近 7 日照护趋势`, and displays symmetric `疫苗接种计划` and `最新生长发育` cards below the charts

#### Scenario: Prioritize Health Observation KPI and independent post-vaccination 48h temperature cue
- **WHEN** the baby has a temperature recorded within the last 48 hours, or has today's medicine without a recent 48-hour temperature, or completed a vaccine dose within the last 48 hours
- **THEN** the `健康观察` KPI card prioritizes recent 48-hour temperature first (alerting on fever within 48 hours) and today's medicine count/name second while showing older temperatures neutrally, and when a vaccine was completed within 48 hours displays a standalone wrapping temperature observation bar (independent of `/api/dashboard/summary` error state) with a one-tap action opening the Quick Record drawer to `health` (`temperature`)
