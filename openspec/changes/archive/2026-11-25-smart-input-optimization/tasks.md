# Tasks

## 1. Backend Default Clinic Persistence & Vaccine Clinic Semantics

- [x] 1.1 Add SQLite migration `backend/internal/database/migrations/00004_default_clinic.sql` (`baby_profiles.default_clinic_name`), extend `backend/internal/baby` (`Profile`, tri-state `UpsertInput.DefaultClinicName`, `UpdateDefaultClinic`, validation up to 80 runes), and verify the `baby-profile` unit tests in `test-plan.md` pass (`cd backend && CGO_ENABLED=0 go test -v ./internal/baby/...`)
- [x] 1.2 Extend `backend/internal/vaccines` (`OverviewResponse.DefaultClinicName`, `UpdateDoseInput.SetDefaultClinic`, `BatchUpdateInput.SetDefaultClinic`, atomic non-birth auto-remember and explicit pin inside `UpdateDose`/`BatchUpdate`) and `backend/internal/httpapi` (`PUT /api/vaccines/default-clinic`), and verify the `vaccine-management` & `baby-profile` unit and integration tests in `test-plan.md` pass (`cd backend && CGO_ENABLED=0 go test -v ./internal/vaccines/... ./internal/httpapi/...`)

## 2. Backend SmartDefaults Extensions

- [x] 2.1 Extend `backend/internal/records/model.go` and `backend/internal/records/defaults.go` with `feeding.last_milk_subtype`, `feeding.last_breast_mode`, `feeding.last_breast_duration_min`, `feeding.recent_solids` (removing redundant `recent_solid_foods`), and `sleep` (`suggested_nap_min`, `suggested_night_min`), and verify the `daily-records` unit and integration tests in `test-plan.md` pass (`cd backend && CGO_ENABLED=0 go test -v ./internal/records/... ./internal/httpapi/...`)

## 3. Vaccine Workspace Input & Batch UX Upgrades

- [x] 3.1 Update `src/lib/baby.ts`, `src/lib/vaccines.ts`, and `src/routes/_app/settings.tsx` with `default_clinic_name`, `useUpdateDefaultClinicMutation`, sibling manufacturer suggestion helper, and same-day alternating injection site helper; verify pure helpers via out-of-repo temporary verification and `pnpm check`
- [x] 3.2 Upgrade `src/components/vaccines/clinic-input-field.tsx` (inline clear button, auto-fill hint, pin-as-default action/toggle), `src/components/vaccines/vaccine-detail-drawer.tsx` (single-dose default clinic prefill on status transition, sibling manufacturer chips, same-day opposite-site hint), `src/components/vaccines/vaccine-batch-drawer.tsx` (default clinic priority + pin toggle), `src/components/vaccines/vaccine-calendar.tsx` (`.ics` fallback to `default_clinic_name`), `src/components/vaccines/vaccine-overview.tsx` (Next Focus batch completion for multi-dose scheduled visits + compact default clinic indicator), and `src/routes/_app/vaccines.tsx`; verify via `pnpm check`

## 4. Daily Quick Record, Dashboard, Health & Growth Input Simplification

- [x] 4.1 Update `src/lib/records.ts`, `src/components/quick-record/codecs/*`, `src/components/quick-record-drawer.tsx`, and `src/components/quick-record/*` to prefill breastfeeding mode/duration, pair solid food chips with recent portions, prefill median sleep duration with a `45 分钟` quick chip, add one-tap `正常（软便 · 黄色）` stool shortcut, and add medicine dosage quick chips plus history-matched dosage autofill; verify pure codecs via out-of-repo temporary verification and `pnpm check`
- [x] 4.2 Update `src/routes/_app/dashboard.tsx` (adaptive feeding one-tap tile for formula / bottled breast milk / direct breastfeeding), `src/routes/_app/health.tsx` (compact one-tap recent medicine/supplement quick strip with undo), `src/components/growth/growth-codec.ts` & `src/components/growth/growth-record-drawer.tsx` (latest weight/height/head reference hints & dynamic next-tooth presets), and `GLOSSARY.md` (Smart Defaults terminology); verify via `pnpm check`

## 5. End-to-End Verification

- [x] 5.1 Run full backend tests, static checks, strict OpenSpec validation, and frontend build (`openspec validate --all --strict`, `pnpm test`, `pnpm lint`, `pnpm check`, `pnpm build:web`) and verify pure TS helpers and UI layout without regressions

## Workflow follow-up

- Archive the `smart-input-optimization` change via `openspec archive` once review requirements are satisfied.
- Run `openspec validate --specs --strict` to verify the updated main specifications pass strict validation.
