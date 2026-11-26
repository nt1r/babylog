# Proposal

## Why

Caregivers currently only see a fixed 7-day trend chart on the dashboard that merges formula and bottled breast milk into a single `feeding_ml` total, hides direct breastfeeding when bottle milk is present, omits nighttime vs. daytime sleep structure, and provides no trends for diapers (pee/poop) or body temperature. Parents also have no way to export multi-day summaries/records to Excel or save trend and WHO growth charts as images when reviewing patterns over a month or preparing for pediatric checkups (儿保/就医).

## What Changes

- **Multi-dimension trend aggregation & period insights (`dashboard-insights`)**:
  - Extend `GET /api/babies/:babyId/dashboard/trends?days=<1..90>&tz=<IANA>` backward-compatibly with per-day feeding breakdowns (`formula_ml`, `formula_count`, `bottle_breast_ml`, `bottle_breast_count`, `solid_count`, `feeding_count`), sleep breakdowns (`nap_hours`, `night_hours`, `nap_count`), care counts (`pee_count`, `poop_count`, `bath_count`), and health observations (`max_temp_c`, `medicine_count`), plus a `period_summary` covering recorded-day active counts, direct breastfeeding side balance (`left`/`right`/`both`), solid acceptance distribution, sleep continuity (`longest_night_min`, `avg_nap_min`), and stool observation flags (`watery`/`hard`/`abnormal` color).
  - Keep existing `FeedingDailySummary` fields backward-compatible while sharing one single aggregation source of truth for formula vs. bottled breast milk breakdowns.
- **Dedicated Insights workspace, lightweight Dashboard 7/30-day switcher, and chart PNG export (`dashboard-insights`)**:
  - Add a dedicated `/insights` (`统计分析`) route under the `成长概览` sidebar group (and Command Palette) with `近 7 天 / 近 14 天 / 近 30 天 / 近 90 天` range switching, honest recorded-day average KPI strips, multi-dimension charts (feeding milk structure + direct breastfeeding + feeding counts/solids, daytime vs. nighttime sleep + continuity, pee/poop trends + stool alerts, on-demand temperature/medicine trend), and a unified Excel export trigger.
  - Keep `/dashboard` lightweight as a daily operational cockpit: upgrade its trend card to a quick `7 天 / 30 天` switcher with a direct link to `/insights`.
  - Add one-tap PNG image export (rendered cleanly at 2x DPI with resolved light/dark theme tokens, solid card background, baby nickname/age, range subtitle, and legend) on every trend chart card in `/insights` and on the WHO growth curve in `/growth`.
  - Enhance `/growth` with concise phase-growth delta indicators (change vs. previous measurement and vs. birth) without cluttering the existing WHO chart.
- **Multi-sheet Excel (`.xlsx`) data export (`data-export`)**:
  - Add `GET /api/babies/:babyId/export/xlsx` supporting preset `days` (`1..366`) or custom local date bounds (`start` / `end`, max 366 days), selectable categories (`feeding`, `sleep`, `care`, `health`, `growth`), and IANA `tz`.
  - Generate a standard OOXML `.xlsx` workbook server-side with zero third-party Go dependencies: Sheet 1 (`按日汇总`) summarizes contiguous daily metrics for selected categories, followed by chronological detail sheets (`喂养明细`, `睡眠明细`, `护理明细`, `健康明细`, `生长发育明细`) formatted in the requested timezone with formula-injection protection.
  - Provide a dedicated Export drawer/dialog on `/insights` (and reachable from Command Palette) supporting preset ranges (`7天 / 14天 / 30天 / 90天`) and custom start/end date pickers plus category checkboxes.

## Capabilities

### New Capabilities

- `data-export`: Authenticated, timezone-aware multi-sheet Excel (`.xlsx`) export for a baby's daily summaries and raw records across selectable categories and preset or custom date ranges.

### Modified Capabilities

- `dashboard-insights`: Extend `/api/babies/:babyId/dashboard/trends` with multi-dimension feeding, sleep, care, and health breakdowns plus period summaries; add the `/insights` analytics page, Dashboard 7/30-day quick toggle, growth delta highlights, chart PNG image export, and Excel export UI.

## Impact

- **Database**: None (zero schema migrations; all required fields already exist in `feeding_records`, `sleep_records`, `care_records`, `health_records`, and `baby_profiles`).
- **Backend**:
  - Updates `backend/internal/records` (`model.go`, `summary.go`, `store.go`) for feeding milk-type subtotals and range queries.
  - Updates `backend/internal/dashboard/service.go` (`DailyTrendPoint`, `PeriodTrendSummary`, `GetTrends`) and tests (`service_test.go`, `backend/internal/integration/dashboard_insights_test.go`).
  - Adds `backend/internal/export/` (pure-Go stdlib OOXML `.xlsx` writer, formula-injection sanitizer, workbook builder, and unit tests), `backend/internal/httpapi/export_handler.go`, route registration in `backend/internal/httpapi/router.go`, and `backend/internal/integration/data_export_test.go`.
- **Frontend**:
  - Adds `src/routes/_app/insights.tsx` (regenerating `src/routeTree.gen.ts` via `pnpm build:web`), `src/lib/insights.ts`, `src/lib/chart-export.ts`, `src/lib/export.ts`, `src/components/insights/*` (chart cards + export drawer).
  - Updates `src/navigation/menu.ts`, `src/components/app-shell/command-palette.tsx`, `src/routes/_app/dashboard.tsx`, `src/lib/dashboard.ts`, `src/components/growth/growth-trend-card.tsx`, and `src/lib/growth-chart.ts`.
- **Dependencies**: Zero new npm packages and zero new Go modules (`CGO_ENABLED=0` preserved).
