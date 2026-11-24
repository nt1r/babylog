# Proposal

## Why

Caregivers record feeding, sleep, care, health, growth, and immunization entries frequently—often one-handed—yet several forms still require repetitive manual typing or ignore established baby habits. In particular, parents almost always visit the same community clinic for routine vaccinations, but single-dose booking/completion still starts with an empty clinic field and lacks a durable default clinic setting that resists drift from one-off hospital visits; meanwhile, daily quick-record flows, dashboard one-tap tiles, and growth entry drawers still contain hardcoded defaults instead of adapting to the baby's real habits.

## What Changes

- **Dual-layer default vaccination clinic (`vaccine-management` & `baby-profile`)**:
  - Persist an optional `default_clinic_name` (up to 80 characters) on the Baby Profile (`baby_profiles`), editable via `PUT /api/baby` (backward-compatible tri-state `*string`: omitted preserves existing value, empty string clears) and directly via `PUT /api/vaccines/default-clinic`.
  - Expose `default_clinic_name` on `GET /api/vaccines` alongside `recent_clinics`, and atomically auto-remember the first non-birth-hospital clinic name as `default_clinic_name` when saving/batch-updating a dose while `default_clinic_name` is still empty (or always overwrite when `set_default_clinic: true` is passed).
  - Pre-fill the default (or most recent) clinic in both single-dose (`VaccineDetailDrawer`) and batch (`VaccineBatchDrawer`) flows when a dose has no clinic yet, add one-tap clear and pin-as-default controls in `ClinicInputField`, fall back to `default_clinic_name` when exporting `.ics` calendar visits, remember per-vaccine historical manufacturers, suggest alternating injection sites for same-day multi-dose visits, and enable one-tap batch completion directly from the Next Focus card when multiple doses are already scheduled.
- **Habit-aware `SmartDefaults` extensions (`daily-records`)**:
  - Extend `GET /api/records/defaults` with `feeding.last_milk_subtype`, `feeding.last_breast_mode`, `feeding.last_breast_duration_min`, `feeding.recent_solids` (`{ food, amount }[]`), and a new `sleep` section (`suggested_nap_min`, `suggested_night_min`) derived from recent sleep medians, and remove the redundant `feeding.recent_solid_foods` string array now superseded by `recent_solids`.
- **Low-friction entry upgrades across Dashboard, Quick Record, and Growth (`dashboard-insights`)**:
  - Adapt the Dashboard's first one-tap feeding tile to the baby's latest milk-feeding habit (`last_milk_subtype`: formula milk, bottled breast milk, or direct breastfeeding with alternating side and recent duration), so recording solid food does not revert a breastfed baby's tile to formula.
  - Prefill breastfeeding mode/duration, pair solid food chips with their recent portion amounts, use habit-based default sleep durations plus a `45 分钟` quick chip, add a one-tap `正常（软便 · 黄色）` shortcut for diaper poop details, and provide dosage quick chips plus history-matched dosage autofill and quick-log medicine chips on `/health`.
  - Show latest recorded weight/height/head reference hints in `GrowthRecordDrawer` and generate dynamic next-tooth presets based on cumulative `teeth_count`.

## Capabilities

### New Capabilities

### Modified Capabilities

- `baby-profile`: Persist optional `default_clinic_name` on `BabyProfile` with tri-state update semantics on `PUT /api/baby`.
- `vaccine-management`: Add `default_clinic_name` to `GET /api/vaccines`, `PUT /api/vaccines/default-clinic`, atomic first-clinic auto-remember and explicit `set_default_clinic` on dose/batch updates, and enhanced clinic/manufacturer/site/focus-batch web UX.
- `daily-records`: Extend `GET /api/records/defaults` with `feeding.last_milk_subtype`, `feeding.last_breast_mode`, `feeding.last_breast_duration_min`, `feeding.recent_solids`, and `sleep` (`suggested_nap_min`, `suggested_night_min`), replacing the redundant `feeding.recent_solid_foods` string array.
- `dashboard-insights`: Adapt Dashboard's feeding one-tap tile to the baby's latest feeding habit and enrich Quick Record and Growth entry drawers with habit-aware prefill, dosage/stool shortcuts, previous measurement hints, and dynamic teething presets.

## Impact

- **Database**: Adds migration `backend/internal/database/migrations/00004_default_clinic.sql` (`ALTER TABLE baby_profiles ADD COLUMN default_clinic_name TEXT NOT NULL DEFAULT ''`).
- **Backend**: Updates `backend/internal/baby`, `backend/internal/vaccines`, `backend/internal/records`, and `backend/internal/httpapi` (including `PUT /api/vaccines/default-clinic`).
- **Frontend**: Updates `src/lib/baby.ts`, `src/lib/vaccines.ts`, `src/lib/records.ts`, `src/components/vaccines/*`, `src/components/quick-record*`, `src/components/growth/*`, `src/routes/_app/dashboard.tsx`, `src/routes/_app/vaccines.tsx`, `src/routes/_app/health.tsx`, and `src/routes/_app/settings.tsx`.
- **Docs**: Updates `GLOSSARY.md` Smart Defaults definition to reflect the new habit suggestions.
