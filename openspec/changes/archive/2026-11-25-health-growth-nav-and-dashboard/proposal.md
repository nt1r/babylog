# Proposal

## Why

With the addition of the Vaccine Management module (`/vaccines`), BabyLog's sidebar currently splits care domains awkwardly: `/health` mixes high-frequency clinical events (body temperature and medicine) with low-frequency developmental milestones (physical measurements and teething) under `日常记录`, while `/vaccines` sits alone under `成长计划` and remains invisible on `/dashboard`. Reorganizing navigation by care frequency and parenting mental model—and surfacing vaccine reminders alongside growth highlights on the dashboard—makes core workflows clearer and prevents missed immunization windows.

## What Changes

- **Reorganize sidebar navigation into balanced groups**:
  - Group high-frequency daily logs under `日常照护`: `喂养记录` (`/feeding`), `睡眠记录` (`/sleep`), and `日常护理` (`/care`).
  - Consolidate clinical care, immunizations, and physical development under a unified `健康与成长` group: `健康记录` (`/health`, focused on temperature and medicine), `疫苗接种` (`/vaccines`), and a new dedicated `生长发育` workspace (`/growth`, focused on weight/height/head measurements and teething).
  - Keep `成长概览` (`/dashboard`), `设置` (`/settings`), hidden `/reminders`, and the 5-slot mobile bottom tab bar (`看板 / 喂养 / (+) / 睡眠 / 护理`, with `+` opening growth entry while on `/growth`).
- **Separate high-frequency quick entry from date-based growth entry**:
  - Focus the global Quick Record drawer on the 4 high-frequency categories (`feeding`, `sleep`, `care`, `health` limited to `temperature` and `medicine`).
  - Introduce a dedicated Growth entry drawer (`体格测量 / 长牙`) invoked from `/growth`, the dashboard's Growth card, and mobile `+` while on `/growth`, simplified to date-only selection (today saves with current timestamp; historical dates save at local `12:00`).
- **Deliver the `/growth` workspace (v1)** without splitting the SQLite `health_records` table:
  - Extend `GET /api/records/health` with backward-compatible comma-separated multi-subtype filtering (`temperature,medicine` and `growth,teeth`).
  - Display a top Growth overview card (independently resolved latest weight/height/head measurements with Baby Profile birth-weight/birth-height fallback labeled `出生`, plus cumulative teeth count `已出 N 颗` and latest tooth note) above a date-formatted reverse-chronological history list defaulting to `全部`.
- **Upgrade `/dashboard` with picture-book Hero, redesigned mobile layout, vaccine alerts, Health Observation KPI, and Growth & Immunity cards**:
  - Extend `GET /api/dashboard/summary` with today's medicine summary (`today_medicine_count`, `latest_medicine_name`, `latest_medicine_at`) and a reusable `growth` overview summary (independently resolved latest metrics with birth fallback markers and teeth count/latest note).
  - Introduce a time-aware picture-book Hero card (`DashboardHero` + `TimeSceneArt` illustrating morning/day/evening/night scenes) paired with a redesigned Baby Profile card linking to `/growth`.
  - Surface a persistent, non-dismissible compact vaccine alert banner below the Hero card (above the one-tap quick-record grid) whenever urgent booked appointments (`scheduled_overdue`, `scheduled_soon`), birth-hospital confirmation, or `overdue`/`due_soon` states exist, backed by a cached `/api/vaccines` query (decoupled from the 60-second summary poll and triggering idempotent NIP seeding on first access).
  - Redesign the one-tap quick-record presets and 4 today KPI cards (`今日喂养 / 今日睡眠 / 今日护理 / 健康观察`) into clean 2×2 mobile / 4-column desktop grids (`健康观察` prioritizes recent 48h temperature/fever, then today's medicine, then historical neutral temperature/empty), with a standalone 48h post-vaccination temperature observation cue bar decoupled from `/api/dashboard/summary` error state.
  - Calibrate the 7-day chart title from `近 7 日成长趋势` to `近 7 日照护趋势`, add symmetric 2-column `疫苗接种计划` and `最新生长发育` cards below the charts, and remove the redundant bottom 4-category quick-record cards.

## Capabilities

### New Capabilities

### Modified Capabilities

- `daily-records`: Support comma-separated multi-subtype filtering on `GET /api/records/health` (e.g., `temperature,medicine` and `growth,teeth`) while preserving backward compatibility with single subtypes and `all`.
- `dashboard-insights`: Extend `GET /api/dashboard/summary` with today's medicine summary and growth overview summary (independent per-metric latest values with birth-profile fallback and cumulative teeth count), and define the unified `健康与成长` navigation, separated Quick Record vs Growth entry drawers, `/growth` workspace, and upgraded dashboard layout.
- `vaccine-management`: Move `/vaccines` from the standalone `成长计划` sidebar group into the unified `健康与成长` group and allow `/dashboard` to surface vaccine alerts, schedule progress, and post-vaccination observation cues via `/api/vaccines`.

## Impact

- **Backend**: Updates `backend/internal/records` (multi-subtype list filtering & growth/medicine highlight queries), `backend/internal/dashboard` (expanded `SummaryResponse` with `health` medicine and `growth` summary using Baby Profile birth measurements), and `backend/internal/httpapi/dashboard_handler.go`. Zero database schema migrations (`health_records` remains a single table).
- **Frontend**: Updates `src/navigation/menu.ts`, `src/lib/categories.ts`, `src/lib/dashboard.ts`, `src/components/app-shell/mobile-tabbar.tsx`, `src/components/quick-record*`, `src/routes/_app/health.tsx`, and `src/routes/_app/dashboard.tsx`; adds `src/routes/_app/growth.tsx`, `src/components/growth/*`, and regenerates `src/routeTree.gen.ts`.
- **Docs**: Updates `GLOSSARY.md` and `docs/design-system.md` to align domain terminology and layout conventions.
