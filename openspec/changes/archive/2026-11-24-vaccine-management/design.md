# Design

## Context

See `proposal.md` for user motivation. BabyLog is a single-family, self-hosted Go + SQLite + React 19 application with zero cloud dependencies, `CGO_ENABLED=0`, `goose` SQL migrations, Gin HTTP handlers with `requireAuthMiddleware` and `requireBabyProfileMiddleware`, and a shadcn (`base-nova`) / Base UI frontend with light/dark semantic tokens.

## Goals / Non-Goals

**Goals:**
- Keep the immunization model simple and approachable for new parents: three persisted states (`pending`, `scheduled`, `completed`) with real-time derived reminder states (`upcoming`, `due_soon`, `overdue`, `scheduled`, `scheduled_soon`, `scheduled_overdue`).
- Provide accurate, verified Chinese immunization reference data (2025/2026 NIP schedule + 5 conflict-free optional self-paid vaccines) while making medical disclaimers and risk warnings unavoidable.
- Support both age-stage planning and monthly calendar visualization, plus zero-dependency `.ics` export for reliable system calendar alarms without cloud push services.
- Keep dashboard integration decoupled so `/api/dashboard/summary` (60s polling) stays unchanged and lightweight.

**Non-Goals:**
- No dose skipping (`skipped`) or joint-vaccine automatic replacement engine (e.g. Pentavalent auto-replacing DTaP + IPV) in v1.
- No server-side push notification, SMS, email, or third-party cloud calendar sync.
- No multi-baby support (scoped to the existing single Baby Profile via `baby_id`).

## Decisions

### 1. Embedded Go Catalog + Single `vaccine_doses` SQLite Table
- **Decision**: Keep all vaccine knowledge (disease prevented, route, pre/post precautions, risk warnings, and default dose schedules) in read-only Go code (`backend/internal/vaccines/catalog.go`), and persist only per-baby dose instances in a single SQLite table `vaccine_doses`.
- **Rationale**: Medical reference copy and disclaimers can be refined in future releases without writing brittle SQL `UPDATE` migrations over user rows; backend remains the single source of truth for due-date calculation, derived statuses, and progress summaries; zero joins keep SQLite queries fast and simple.
- **Alternative considered**: Storing templates in a separate SQLite table. Rejected because static templates would still require synchronization migrations on every policy or wording update.

### 2. Dynamic Due-Date Computation with Month-End Clamping
- **Decision**: Leave `planned_date` as `NULL` by default for template doses and compute the default due date dynamically from `baby_profiles.birth_date` + `age_months` (using calendar month-end clamping so `2026-01-31 + 1 month = 2026-02-28`, and `2024-01-31 + 1 month = 2024-02-29`). When a user explicitly adjusts the planned date, persist it in `planned_date`.
- **Rationale**: If a parent corrects the baby's birth date in Settings, all uncustomized pending doses automatically recalculate without extra migration hooks.
- **Alternative considered**: Materializing `planned_date` at seed time. Rejected because editing `birth_date` would leave stale due dates.

### 3. Explicit Per-Dose Confirmation for Birth Hospital Vaccines (HepB #1 + BCG)
- **Decision**: Seed HepB dose 1 and BCG as `pending` like all other NIP doses, and surface a prominent, dismissible confirmation strip on `/vaccines` with individual checkboxes and date inputs (HepB #1 defaulting to `birth_date`, BCG defaulting to `birth_date + 1 day` clamped to `today`) so parents can confirm one or both doses with accurate actual dates.
- **Rationale**: Reflects real hospital delivery norms (HepB within hours of birth, BCG often next day) while eliminating the clinical hazard of silently marking unadministered vaccines as completed for premature or deferred newborns.

### 4. Conflict-Free Customizable Optional Catalog & Sequential Renumbering
- **Decision**: Include 5 widely used optional vaccines that do not replace free NIP doses (`pcv13`, `rv5`, `ev71`, `varicella`, `flu`), expose each template's default dose months for pre-add customization, support multi-dose custom vaccine series, and atomically renumber remaining sibling doses (`1..N-1`) whenever a middle optional/custom dose is deleted.
- **Rationale**: Accommodates real-world brand and start-age schedule variations (e.g., PCV13 3-dose catch-up, single-dose flu in subsequent seasons) without requiring a complex replacement engine in v1.

### 5. Gentle 14-Day Alert Window & Timezone-Aware Derivation
- **Decision**: Derive `alert_state` server-side on every read using `WithClock` + the client's IANA `tz` parameter:
  - `pending`: `days_until > 14` → `upcoming`; `-14 <= days_until <= 14` → `due_soon`; `days_until < -14` → `overdue`.
  - `scheduled`: `days_until < 0` → `scheduled_overdue`; `0 <= days_until <= 7` → `scheduled_soon`; `days_until > 7` → `scheduled`.
  - `completed`: `completed`.
- **Rationale**: Matches real community-clinic booking rhythms (parents book 1–2 weeks in advance and often vaccinate within a 2-week window after turning an age month) without inducing anxiety on day +1.

### 6. Side-by-Side Calendar Overview & Client-Side Pure TypeScript `.ics` Export
- **Decision**: Place the monthly vaccination calendar alongside the next-focus & progress card at the top of `/vaccines`, expose the single unified `.ics` export action on the calendar header, and generate RFC 5545 `.ics` files in `src/lib/ics.ts` (including precautions, risk warnings, and `VALARM` triggers: 1 day prior and 2 hours prior / 08:00 on day-of for all-day events).
- **Rationale**: Gives parents immediate calendar visibility on page entry, avoids duplicate export buttons across drawers/tabs, and leaks zero personal baby data to external calendar services.

## Risks / Trade-offs

- **[Medical misinformation / regional policy mismatch]** → Mitigated by persistent top-level medical disclaimer on `/vaccines`, explicit risk/contraindication blocks in every vaccine detail drawer, brand/age-window callouts in the optional catalog, and requiring explicit user confirmation for birth hospital vaccines.
- **[Backfilling for older babies onboarded late]** → Mitigated by age-stage batch completion (`POST /api/vaccines/batch`) and gentle phrasing ("待补种 / 待补录") instead of harsh error alerts.
- **[Timezone boundary edge cases]** → Mitigated by reusing `backend/internal/timeutil.LoadLocation` and `LocalDateKey` with `WithClock` deterministic unit and integration tests.

## Migration Plan

- Add `backend/internal/database/migrations/00003_vaccines.sql` (`CREATE TABLE vaccine_doses` + indexes; reversible `-- +goose Down`).
- Automatically applied on server startup via existing `database.Open` goose runner.
- Existing installations require no manual steps; the first `GET /api/vaccines` call lazily seeds the 22 NIP baseline doses in a transaction.
