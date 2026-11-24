# Tasks

## 1. Backend Multi-Subtype Health Filtering & Dashboard Summary Extensions

- [x] 1.1 Extend `backend/internal/records/store.go` (`ListHealth` & subtype filter parser) to support backward-compatible comma-separated multi-subtype filtering (`temperature,medicine`, `growth,teeth`) with strict validation and scoped `daily_summaries`, and verify the `daily-records` unit tests in `test-plan.md` pass (`cd backend && CGO_ENABLED=0 go test -v ./internal/records/...`)
- [x] 1.2 Extend `backend/internal/records` highlights/window reads, `backend/internal/dashboard/service.go`, `backend/internal/httpapi/middleware.go`, and `backend/internal/httpapi/dashboard_handler.go` to return today's medicine summary (`health.today_medicine_count`, `latest_medicine_name`, `latest_medicine_at`) and independently resolved `growth` overview highlights (with Baby Profile birth-weight/birth-height fallback and `teeth_count`/`latest_tooth_note`), and verify all unit & integration tests in `test-plan.md` pass (`cd backend && CGO_ENABLED=0 go test -v ./...`)

## 2. Navigation IA, Separated Entry Drawers & `/growth` Workspace

- [x] 2.1 Update `src/navigation/menu.ts`, `src/lib/categories.ts`, `src/components/app-shell/mobile-tabbar.tsx`, and `src/components/quick-record*` to reorganize sidebar groups (`成长概览`, `日常照护`, `健康与成长`: `/health` `/vaccines` `/growth`, `设置`), narrow `/health` (`src/routes/_app/health.tsx`) and `QuickRecordDrawer` health fields to `temperature` and `medicine`, and wire mobile `+` on `/growth` to growth entry; update `GLOSSARY.md` terminology and verify via `pnpm check`
- [x] 2.2 Implement `GrowthRecordDrawer` (`src/components/growth/growth-record-drawer.tsx`, date-only `DatePicker` with today-current-time / past-local-12:00 semantics, `growth` & `teeth` create/edit) and the `/growth` route (`src/routes/_app/growth.tsx`, top growth overview card with birth fallback & `已出 N 颗` teeth summary + reverse-chronological date-formatted history list defaulting to `all`), ensure Baby Profile updates invalidate dashboard/growth queries (`src/lib/baby.ts`), regenerate `src/routeTree.gen.ts` via `pnpm build:web`, and verify via `pnpm check`

## 3. Dashboard Upgrade (Vaccine Alerts, Health Observation KPI & Growth/Immunity Cards)

- [x] 3.1 Update `src/lib/dashboard.ts` and `src/lib/vaccines.ts` with pure view-model helpers for: persistent vaccine attention banner derivation, 48-hour post-vaccination temperature observation window detection, reordered 4-KPI cards (`今日喂养 / 今日睡眠 / 今日护理 / 健康观察` with fever/48h-temp -> today's medicine -> historical fallback priority), and extended `DashboardSummary` types; verify pure TS logic with out-of-repo temporary verification (cleaned up after) and `pnpm check`
- [x] 3.2 Update `src/routes/_app/dashboard.tsx` and extract `src/components/brand/time-scene-art.tsx`, `src/components/dashboard/dashboard-hero.tsx`, and `src/components/dashboard/growth-immunity-section.tsx` to deliver the time-aware picture-book Hero card, persistent conditional vaccine alert banner, 2×2/4-column one-tap tiles and KPI cards, independent 48h post-vaccination temperature bar, `近 7 日照护趋势` title, and symmetric 2-column `疫苗接种计划` and `最新生长发育` cards while removing the bottom 4-category quick-record cards; update `docs/design-system.md` and verify via `pnpm lint`, `pnpm check`, and `pnpm build:web`

## 4. End-to-End Verification

- [x] 4.1 Run backend tests and static checks (`pnpm test`, `pnpm lint`, `pnpm check`) and verify `/dashboard`, `/health`, `/growth`, `/vaccines`, and drawer interactions (including mobile layout and theme modes) with zero console or contract regressions

## Workflow follow-up

- Archive the `health-growth-nav-and-dashboard` change via `openspec archive` once implementation and review are complete.
- Run `openspec validate --specs --strict` to verify the updated main specifications pass strict validation.
