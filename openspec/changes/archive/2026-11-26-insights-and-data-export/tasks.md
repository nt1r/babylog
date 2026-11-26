# Tasks

## 1. Backend Multi-Dimension Trends & Period Summary

- [x] 1.1 Extend `FeedingDailySummary` and `AccumulateFeedingSummary` in `backend/internal/records/model.go` & `backend/internal/records/summary.go` with formula and bottle-breast breakdowns, and add unit test `TestAccumulateFeedingSummaryBreakdown` per `test-plan.md` (verify via `cd backend && CGO_ENABLED=0 go test -v -run TestAccumulateFeedingSummaryBreakdown ./internal/records/...`)
- [x] 1.2 Extend `DailyTrendPoint`, `PeriodTrendSummary`, and `Service.GetTrends` in `backend/internal/dashboard/service.go` with per-day feeding/sleep/care/health breakdowns and period summary metrics (`active_days`, `breast_side`, `solid_acceptance`, `sleep`, `stool`), keeping existing fields backward-compatible (verify via `cd backend && CGO_ENABLED=0 go test -v ./internal/dashboard/...`)
- [x] 1.3 Add `TestDashboardMultiDimensionTrendsAndPeriodSummary` in `backend/internal/integration/dashboard_insights_test.go` per `test-plan.md` and update the integration test index in `docs/testing-guide.md` (verify via `cd backend && CGO_ENABLED=0 go test -v -run TestDashboard ./internal/integration/...`)

## 2. Backend Multi-Sheet Excel Export (`data-export`)

- [x] 2.1 Implement zero-dependency OOXML `.xlsx` writer (`backend/internal/export/xlsx.go`), query validation & workbook builder (`backend/internal/export/service.go`), and unit tests (`backend/internal/export/xlsx_test.go`) covering multi-sheet generation, formula-injection sanitization, and parameter bounds per `test-plan.md` (verify via `cd backend && CGO_ENABLED=0 go test -v ./internal/export/...`)
- [x] 2.2 Add `backend/internal/httpapi/export_handler.go` and register `GET /api/babies/:babyId/export/xlsx` in `backend/internal/httpapi/router.go` under the baby-scoped middleware group (verify via `cd backend && CGO_ENABLED=0 go vet ./...`)
- [x] 2.3 Add `backend/internal/integration/data_export_test.go` (`TestDataExportMultiSheetXLSXAndSanitization` and `TestDataExportAuthScopeAndQueryParamGuards`) per `test-plan.md` and update `docs/testing-guide.md` index (verify via `cd backend && CGO_ENABLED=0 go test -v -run TestDataExport ./internal/integration/...`)

## 3. Frontend Insights Data Layer, Chart PNG Export & Excel Download Client

- [x] 3.1 Extend `DashboardTrends` TypeScript contracts in `src/lib/dashboard.ts` and add pure analytics helpers in `src/lib/insights.ts` (recorded-day averages, side-balance percentages, stool notice formatter, dense X-axis tick helpers) plus growth delta helpers in `src/lib/growth-chart.ts` (verify pure TS logic via `$TMPDIR` script and `pnpm check`)
- [x] 3.2 Implement OKLCH-safe SVG-to-PNG chart exporter in `src/lib/chart-export.ts` (2x HiDPI canvas, solid theme card background, title/baby/range/legend header, download trigger) and authenticated Excel download client + validation helpers in `src/lib/export.ts` (verify via `pnpm check`)

## 4. Insights Page, Export Drawer, Dashboard Switcher & Growth Enhancements

- [x] 4.1 Build reusable chart export card shell & Excel export drawer (`src/components/insights/insight-chart-card.tsx`, `src/components/insights/export-excel-drawer.tsx`) and create the `/insights` page (`src/routes/_app/insights.tsx`) covering `7/14/30/90` day presets, period summary KPIs, feeding/sleep/care/health/rhythm charts, and export drawer trigger; run `pnpm build:web` to regenerate `src/routeTree.gen.ts` (verify via `pnpm check`)
- [x] 4.2 Wire `/insights` navigation in `src/navigation/menu.ts` (`成长概览` group) and `src/components/app-shell/command-palette.tsx` (navigation + Excel export shortcut), upgrade `src/routes/_app/dashboard.tsx` trend card with a `7 天 / 30 天` quick toggle and link to `/insights`, and enhance `src/components/growth/growth-trend-card.tsx` with phase-growth delta hints and PNG image export (verify via `pnpm check`)

## 5. Final Verification & Visual Audit

- [x] 5.1 Run formatting, typecheck, full backend tests, and lint (`pnpm format && pnpm check && pnpm test && pnpm lint`), and perform out-of-repo headless visual verification (`$TMPDIR`, 390px mobile + desktop, light & dark modes) covering `/insights`, `/dashboard` (7d/30d toggle), `/growth` (delta hints + image export), and `ExportExcelDrawer`

## Workflow follow-up

- Archive `insights-and-data-export` via `openspec archive` to sync `openspec/specs/dashboard-insights/spec.md` and `openspec/specs/data-export/spec.md`, then re-run final `pnpm lint` (including `check-spec-refs` and `openspec validate --all --strict`).
- Update `GLOSSARY.md` if any new enduring domain term is introduced during implementation.
