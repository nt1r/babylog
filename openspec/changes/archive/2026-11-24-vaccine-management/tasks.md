# Tasks

## 1. Domain Glossary & Database Foundation

- [x] 1.1 Update `GLOSSARY.md` with vaccine domain terminology (Vaccination Schedule, Vaccine Dose, NIP / Optional Vaccine) and verify terminology aligns with `specs/vaccine-management/spec.md`
- [x] 1.2 Add `backend/internal/database/migrations/00003_vaccines.sql` defining `vaccine_doses` and indexes, and verify migrations run cleanly via `CGO_ENABLED=0 go test ./internal/database/...`

## 2. Backend Vaccine Domain, Catalog & HTTP API

- [x] 2.1 Implement `backend/internal/vaccines` (embedded verified NIP + 5 optional templates with medical disclaimers/risks, month-end-safe due-date computation, derived alert states, input validation, GORM store with `WithClock`, idempotent seeding, batch operations, recent clinics) and verify unit tests in `test-plan.md` pass
- [x] 2.2 Implement `backend/internal/httpapi/vaccines_handler.go` and wire `/api/vaccines/*` in `backend/internal/httpapi/router.go` and `backend/cmd/babylog/serve.go`, and verify integration tests in `test-plan.md` pass (`cd backend && CGO_ENABLED=0 go test -v ./...`)

## 3. Frontend Vaccine Workspace, Calendar & ICS Export

- [x] 3.1 Implement `src/lib/vaccines.ts` (API client, TanStack Query hooks, pure stage-grouping and calendar-grid helpers) and `src/lib/ics.ts` (zero-dependency RFC 5545 `.ics` generator with `VALARM`) and verify TypeScript compilation via `pnpm check`
- [x] 3.2 Build `/vaccines` route (`src/routes/_app/vaccines.tsx`) and components (`src/components/vaccines/*`): concise medical disclaimer, per-dose birth-hospital confirmation strip, side-by-side vaccination calendar (with unified `.ics` export) & next-focus/progress card, age-stage timeline with batch booking/backfill, detail/booking/recording drawer (with post-vaccination quick temperature link and optional/custom age adjustment & deletion), and customizable optional catalog / multi-dose custom vaccine drawer, and verify route generation and `pnpm check` pass

## 4. Navigation, Integration & Verification

- [x] 4.1 Wire `/vaccines` into a dedicated `成长计划` sidebar group (`src/navigation/menu.ts`), keep `/dashboard` dedicated to daily care insights, and link `/reminders` (`src/routes/_app/reminders.tsx`) to `/vaccines`; verify `pnpm check` passes
- [x] 4.2 Run full relevant verification (`pnpm lint`, `pnpm check`, `pnpm test`), run out-of-repo temporary verification for pure TS vaccine/ICS helpers (cleaned up after), and confirm zero regressions

## Workflow follow-up

- Archive the `vaccine-management` change via `openspec archive` once review is complete and validate `openspec validate --specs --strict`.
