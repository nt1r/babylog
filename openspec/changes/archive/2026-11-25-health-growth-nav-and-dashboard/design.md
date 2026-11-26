# Design

## Context

See `proposal.md` for user motivation. BabyLog is a single-baby Go (Gin + GORM + SQLite, `CGO_ENABLED=0`) and React 19 (TanStack Router + TanStack Query + Base UI / shadcn `base-nova`) application. Currently `health_records` stores four subtypes (`temperature`, `medicine`, `growth`, `teeth`) queried via `GET /api/records/health?subtype=<single|all>`, `GET /api/dashboard/summary` is polled every 60 seconds and only reads feeding/sleep/care windows plus `ReadLatestHighlights` (last feeding, last diaper, latest temperature), and `/api/vaccines` lazily seeds the 22 NIP baseline doses on first access.

## Goals / Non-Goals

**Goals:**
- Reorganize web navigation into balanced frequency-aligned groups (`成长概览`, `日常照护`, `健康与成长`, `设置`) and introduce `/growth` without breaking or migrating the `health_records` SQLite schema.
- Keep `/api/dashboard/summary` fast and lightweight under 60-second polling while supplying today's medicine summary and independently resolved growth overview metrics (with Baby Profile birth fallback) for both `/dashboard` and `/growth`.
- Surface vaccine attention alerts, schedule progress, and 48-hour post-vaccination temperature prompts on `/dashboard` while keeping `/api/vaccines` decoupled from the 60-second summary poll.
- Provide a clean separation between high-frequency daily logging (`QuickRecordDrawer`) and date-only physical growth / teething logging (`GrowthRecordDrawer`).

**Non-Goals:**
- No database schema migration or splitting `health_records` into separate SQLite tables.
- No WHO growth percentile curves, Recharts height/weight charts on `/growth`, or structured 20-tooth dental chart in this change.
- No server-side push notifications or surfacing `/reminders` in the primary sidebar.

## Decisions

### 1. Keep `health_records` Single Table with Comma-Separated Multi-Subtype Filtering
- **Decision**: Extend `records.Store.ListHealth` (via a shared `parseSubtypeFilters` helper in `backend/internal/records/store.go`) so `ListFilter.Subtype` accepts either `all`/empty, a single valid subtype, or comma-separated valid subtypes (e.g., `temperature,medicine` for `/health`, `growth,teeth` for `/growth`). Deduplicate valid tokens, apply SQL `subtype IN (?)`, and reject any empty segment (e.g., `growth,`) or unknown token (e.g., `temperature,foo`) with `*ValidationError` (HTTP 400). Scope `daily_summaries` to the exact same `subtype IN (?)` filter.
- **Rationale**: Zero SQLite migration risk, full backward compatibility with existing single-subtype callers and `POST/PUT/DELETE /api/records/health`, and minimal backend surface area.
- **Alternative considered**: Splitting `growth_records` / `teeth_records` into new tables and `/api/records/growth`. Rejected for v1 because it introduces unnecessary migration complexity and duplicates CRUD/validation plumbing.

### 2. Extend `GET /api/dashboard/summary` with Today's Medicine & Per-Metric Growth Highlights
- **Decision**:
  - Pass a lightweight `BirthBaseline` (`BirthDate`, `WeightKg`, `HeightCm`, derived from the `baby.Profile` already loaded by `requireBabyProfileMiddleware` with zero extra DB queries) into `dashboard.Service.GetSummary`.
  - In `records.Store`, query today's medicine records (`subtype = 'medicine'` within `[dayStart, dayEnd)`) for `today_medicine_count`, `latest_medicine_name`, and `latest_medicine_at`, and extend `ReadLatestHighlights` (or add `ReadGrowthHighlights`) to resolve each growth metric independently via indexed `LIMIT 1` queries (`weight_kg IS NOT NULL`, `height_cm IS NOT NULL`, `head_cm IS NOT NULL` ordered by `recorded_at DESC, id DESC`), plus `COUNT(*)` and latest row for `subtype = 'teeth'`.
  - Apply Baby Profile fallback in `dashboard.Service.GetSummary`: if `latest_weight_kg == nil && baseline.WeightKg != nil`, populate `latest_weight_kg` with `weight_is_birth: true` and `weight_recorded_at: &baseline.BirthDate` (same for `height_cm`).
  - Expose these under `health` (`today_medicine_count`, `latest_medicine_name`, `latest_medicine_at`) and a new top-level `growth` object on `GET /api/dashboard/summary`, and reuse the same query on `/growth` for its top overview card (invalidated automatically when any `health` record mutates or Baby Profile updates).
- **Rationale**: Indexed `LIMIT 1` lookups on `(baby_id, subtype, recorded_at DESC)` are sub-millisecond on single-family SQLite, avoid duplicating a second summary endpoint, and guarantee identical numbers between `/dashboard` and `/growth`.
- **Alternative considered**: Adding a separate `GET /api/growth/summary` endpoint. Rejected because `/dashboard` needs the exact same growth snapshot on load and reusing `/api/dashboard/summary` avoids extra HTTP round-trips.

### 3. Decoupled Vaccine Query & 48-Hour Post-Vaccination Cue on `/dashboard`
- **Decision**: Call `useVaccinesOverviewQuery` directly on `/dashboard` with a dedicated `staleTime` (e.g., 5 minutes) and no `refetchInterval`, keeping it completely independent of the 60-second `useDashboardSummaryQuery` poll. Any vaccine mutation already invalidates `VACCINES_QUERY_KEY`. Derive two pure frontend views in `src/lib/dashboard.ts`:
  - **Urgent Banner**: Shown persistently (non-dismissible) directly below the Hero card (above the one-tap grid) whenever urgent booked appointments (`scheduled_overdue | scheduled_soon`), `summary.birth_confirm_pending`, or `overdue | due_soon` states exist—prioritizing urgent booked appointments ahead of birth confirmation so deferred newborn vaccines never hide an overdue booked clinic visit.
  - **Post-Vaccination 48h Cue**: Check completed doses whose `vaccinated_at` (`YYYY-MM-DD`) falls within `0..2` local calendar days before `overview.today`, surfacing a standalone wrapping observation bar below the KPI grid (outside the `/api/dashboard/summary` error branch) with a one-tap `去记体温` action (`openCreate('health', 'temperature')`).
- **Rationale**: Reuses the existing `/api/vaccines` endpoint with zero backend vaccine changes, ensures first-time parents see birth-hospital confirmation immediately on `/dashboard` (via idempotent lazy NIP seeding), and avoids polling vaccine schedules every minute.
- **Alternative considered**: Embedding vaccine summaries inside `/api/dashboard/summary`. Rejected because `/api/dashboard/summary` polls every 60 seconds and should not trigger vaccine table reads/seeding on every tick.

### 4. Separated Entry Drawers & Date-Only Growth Timestamp Semantics
- **Decision**:
  - Narrow `QuickRecordDrawer`'s `health` subtype selector to `temperature` and `medicine` (matching `/health`), keeping the top L1 grid at 4 columns (`feeding`, `sleep`, `care`, `health`).
  - Introduce `GrowthRecordDrawer` (`src/components/growth/growth-record-drawer.tsx`) with its own Zustand store or intent mode (`growth` | `teeth`, create | edit) using `EntityDrawer` and `DatePicker` only (`max={today}`):
    - Creating with `date === today`: save with current local timestamp (`new Date().toISOString()`).
    - Creating with `date < today`: save at local `12:00` (`combineLocalDateTimeToISO(date, '12:00')`), safely below the server's `+5m` future-timestamp guard regardless of timezone.
    - Editing an existing record: if the selected `YYYY-MM-DD` matches the original local date, preserve its original `recorded_at`; if changed to today use current time (or `12:00` if past date).
  - On `/growth`, display a top overview card (weight / height / head with `出生` badge on fallback + measurement date + `已出 N 颗` teeth summary) and a date-formatted history list (`11月24日`, cross-year `2025年11月24日`) defaulting to `range='all'` with `全部 / 生长 / 长牙` tabs, omitting `HH:mm` timestamps and duplicate ("再记一笔") noise where not helpful (retaining click-to-edit and delete).
  - In `MobileTabBar`, check `pathname.startsWith('/growth')`: when on `/growth`, tapping the center `+` button opens `GrowthRecordDrawer`; elsewhere it opens `QuickRecordDrawer` with the active category context.
- **Rationale**: Eliminates cognitive mismatch between sidebar categories and entry drawers while making low-frequency growth/teething backfilling effortless.
- **Alternative considered**: Expanding `QuickRecordDrawer` to 5 L1 tabs. Rejected because 5 columns crowd narrow mobile screens and force growth backfilling through minute-offset time pickers.

### 5. Dashboard Layout, Picture-Book Hero & Health Observation KPI Priority
- **Decision**:
  - Replace the plain greeting line with a picture-book `DashboardHero` (`src/components/dashboard/dashboard-hero.tsx` + `src/components/brand/time-scene-art.tsx` using existing `--art-*` tokens for morning/day/evening/night scenes) and a redesigned Baby Profile card linking to `/growth`.
  - Arrange both the one-tap quick-record tiles and the 4 today KPI cards (`今日喂养` → `今日睡眠` → `今日护理` → `健康观察`) in responsive 2×2 mobile / 4-column desktop grids, and split vaccine/growth widgets into `src/components/dashboard/growth-immunity-section.tsx`.
  - Drive `健康观察` via a pure helper in `src/lib/dashboard.ts`:
    1. If latest temperature is within 48 hours of `now`: show temperature as primary value with `warning`/`destructive` tone when elevated (`>= 37.3℃`); subtext shows severity + recency (+ `· 今日用药 N 次` when `today_medicine_count > 0`).
    2. Else if `today_medicine_count > 0`: show `用药 N 次` as primary value; subtext shows latest medicine name + recency.
    3. Else if any older temperature exists: show latest temperature neutrally (`alertTone: null`) with recency.
    4. Else show `—` / `暂无健康记录`.
  - Rename the 7-day trend card title to `近 7 日照护趋势`, place symmetric 2-column `疫苗接种计划` and `最新生长发育` cards below the 2:1 chart row (the Growth card includes a quick action to open `GrowthRecordDrawer` and links to `/growth`), and remove the redundant bottom 4-category quick-record cards.
- **Rationale**: Keeps the 4-column daily KPI grid balanced, upgrades an often-empty temperature card into a useful health summary, and gives parents permanent visibility into both immunizations and physical growth.

## Risks / Trade-offs

- **[First dashboard visit triggers vaccine NIP seeding]** → `vaccines.Store.GetOverview` already seeds idempotently inside a single SQLite transaction, and `useVaccinesOverviewQuery` caches the result so subsequent renders incur zero writes.
- **[Free-text teeth notes counted as 1 record = 1 tooth]** → Clearly document `已出 N 颗` as counting `teeth` entries alongside the latest tooth note; if a future change adds structured 20-tooth slots, it can migrate cleanly.
- **[Baby Profile birth-measurement updates must reflect in `/growth` and `/dashboard`]** → Ensure `useSaveBabyProfileMutation` invalidates `DASHBOARD_QUERY_KEY` (verify and add if missing) so editing birth weight/height immediately updates fallback values.

## Migration Plan

- No SQLite migration is required (`health_records` schema is unchanged).
- Run `pnpm build:web` after adding `src/routes/_app/growth.tsx` to regenerate and commit `src/routeTree.gen.ts`.
- Update `GLOSSARY.md` and `docs/design-system.md` alongside code changes so terminology and dashboard layout conventions remain single-source-of-truth.
