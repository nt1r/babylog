# Technical Design

## Context

See `proposal.md` for motivation. BabyLog already provides `GET /api/records/defaults` (`SmartDefaults`) for feeding/health/care presets and `recent_clinics` in `GET /api/vaccines`. However, vaccination clinic entry still suffers from inconsistent prefill across single-dose vs. batch drawers and drift when one-off hospital visits overwrite recency, while several daily/growth forms still hardcode defaults instead of learning from recent records.

## Goals / Non-Goals

- **Goals**:
  - Persist a durable per-baby `default_clinic_name` with dual-layer ergonomics: automatic first-time capture on non-birth routine vaccinations plus explicit pin/edit/clear controls.
  - Keep all API extensions strictly backward-compatible (additive response fields, tri-state optional request field on `PUT /api/baby`).
  - Derive sibling vaccine manufacturer suggestions, same-day alternating injection site hints, growth reference hints, and dynamic teething presets cleanly in pure frontend helpers without unnecessary extra backend tables or endpoints.
  - Extend `SmartDefaults` (`GET /api/records/defaults`) with breastfeeding mode/duration, solid food + portion pairs, and median-based sleep durations using minimal bounded SQLite queries.
- **Non-Goals**:
  - Multi-clinic address book CRUD or map/GPS clinic search.
  - Modifying the existing `recent_clinics` cap (3).
  - Adding push notifications or scheduled reminder jobs for daily supplements.

## Decisions

### 1. Store `default_clinic_name` on `baby_profiles` (Migration `00004_default_clinic.sql`)
- **Decision**: Add `default_clinic_name TEXT NOT NULL DEFAULT ''` to `baby_profiles` rather than creating a separate settings table.
- **Rationale**: BabyLog is a single-baby workspace where `baby_profiles` already holds per-baby durable configuration (`birth_date`, birth measurements) and is injected into every `/api/vaccines/*` request by `requireBabyProfileMiddleware`.
- **Tri-state update on `PUT /api/baby`**: `UpsertInput.DefaultClinicName` is `*string` (`nil` preserves existing DB value, `""` clears it, non-empty trims and validates `<= 80` runes). Existing onboarding (`POST /api/baby`) and settings payloads remain 100% compatible.
- **Direct endpoint `PUT /api/vaccines/default-clinic`**: Allows pinning/updating/clearing `default_clinic_name` from `/vaccines` without sending the entire Baby Profile payload, and invalidates both `['vaccines']` and `['baby-profile']` Query caches on the frontend.

### 2. Atomic Auto-Remember + Explicit Pin Inside Vaccine Write Transactions
- **Decision**: Inside `vaccines.Store.UpdateDose` and `vaccines.Store.BatchUpdate` transactions, when a non-empty `clinic_name` is persisted:
  - If `SetDefaultClinic` is `true`, always update `baby_profiles.default_clinic_name = clinic_name`.
  - Otherwise, if at least one updated dose is **not** a birth-hospital dose (`hepb` dose 1 or `bcg` dose 1), conditionally execute `UPDATE baby_profiles SET default_clinic_name = ?, updated_at = ? WHERE id = ? AND default_clinic_name = ''`.
- **Rationale**: Birth-hospital confirmations (maternity ward) do not pollute the routine community clinic; the parent's first community-clinic booking/completion automatically becomes the default with zero extra clicks; subsequent one-off hospital visits never overwrite the saved default unless explicitly requested; and any batch error rolls back both dose rows and `default_clinic_name` atomically.

### 3. Single-Dose & Batch Clinic Prefill Guard
- **Decision**: In `VaccineDetailDrawer`, track `clinicTouched` (`false` when opening a dose). When the user switches `status` from `pending` to `scheduled` or `completed` (or opens an already `scheduled`/`completed` dose that somehow has empty `clinic_name`? No — only on transition from `pending` to `scheduled`/`completed` when `clinicName === ''` and `!clinicTouched`), automatically fill `defaultClinicName || recentClinics[0] || ''` and mark `clinicAutoFilled = true` so the field displays a subtle `已自动填入常去门诊` hint. Editing or clicking the inline clear button sets `clinicTouched = true` and clears the hint.
- **Alternative considered**: Prefilling `clinicName` unconditionally on drawer open even while `status === 'pending'`. Rejected because `pending` hides the clinic input and clears `clinic_name` on submit; filling on transition into `scheduled`/`completed` ensures exact intent and respects manual clearing.

### 4. Habit-Based `SmartDefaults` Extensions
- **Feeding**: Reuse the existing single scan of the latest 60 feeding records in `records.Store.GetSmartDefaults`:
  - Capture `last_milk_subtype` from the most recent `subtype IN ('formula', 'breast')` record (ignoring `solid`, fallback `"formula"`).
  - Capture `last_breast_mode` from the most recent `subtype = 'breast'` record (`"direct"` or `"bottle"`, fallback `"direct"`).
  - Capture `last_breast_duration_min` from the most recent `subtype = 'breast' AND feeding_mode = 'direct'` record (fallback `15`).
  - Replace the redundant `recent_solid_foods` string array with `recent_solids` (`[]SolidFoodPreset{Food, Amount}`, max 5 deduplicated by `Food`, keeping the most recent entry's trimmed `solid_amount`).
- **Sleep**: Add one bounded query (`LIMIT 20`, `ORDER BY ended_at DESC, id DESC`) on `sleep_records`:
  - Collect up to the latest 5 `nap` durations and up to the latest 5 `night` durations.
  - Compute the median rounded to nearest 5 min for `nap` clamped `[15, 240]`, and nearest 15 min for `night` clamped `[120, 720]`, falling back to `60` and `480` when no history exists.
- **Dashboard Adaptive One-Tap Feeding Tile**:
  - `last_milk_subtype === 'breast' && last_breast_mode === 'direct'` → one-tap direct breastfeed using `suggested_breast_side` and `last_breast_duration_min` (preserved even if the latest entry was `solid`).
  - `last_milk_subtype === 'breast' && last_breast_mode === 'bottle'` → one-tap bottled breast milk using `last_milk_ml`.
  - Otherwise (`formula`) → one-tap formula milk using `last_milk_ml`.

### 5. Pure Frontend Helpers for Derived Suggestions
- **Vaccine manufacturer & same-day site hints** (`src/lib/vaccines.ts`):
  - `getSuggestedManufacturers(dose, allDoses)`: matches sibling doses by `template_code` (or `vaccine_name` when custom) first, sorted by `vaccinated_at DESC`, deduplicated, up to 3.
  - `getOppositeSiteSuggestion(dose, vaccinatedAt, allDoses)`: inspects other completed doses with matching `vaccinated_at` and non-empty `site`; maps `左上臂` ↔ `右上臂` and `左大腿前外侧` ↔ `右大腿前外侧` when the opposite side is unused on that date.
- **Growth reference hints & dynamic teething presets** (`src/components/growth/growth-codec.ts`):
  - Read cached `useDashboardSummaryQuery({ enabled: open, refetchInterval: false })` inside `GrowthRecordDrawer` to display last recorded weight/height/head values and placeholders.
  - `buildDynamicTeethPresets(teethCount)`: generates 4 contextual next-tooth options using `teethCount + 1` and standard deciduous eruption order (下中切牙 → 上中切牙 → 上侧切牙 → 下侧切牙 → 第一乳磨牙 → 尖牙 → 第二乳磨牙).
- **Health quick-log medicine chips** (`src/routes/_app/health.tsx` + `src/components/quick-record/health-fields.tsx`):
  - Add dosage quick chips (`1 粒`, `1 滴`, `2.5 ml`, `5 ml`, `半袋`, `1 袋`) and auto-populate dosage when typed medicine name exactly matches a `recent_medicines` item and dosage is currently blank.
  - Add a compact one-tap recent medicine bar on `/health` (using `useSmartDefaultsQuery` with `useRef` re-entrancy lock and undoable Toast) for effortless daily supplement logging (e.g., Vitamin D3).

## Risks / Trade-offs

- **Risk**: Auto-filling `default_clinic_name` might be mistaken for an already-saved value if the user intentionally wants to leave `clinic_name` blank on a specific dose → **Mitigation**: Show a clear inline `×` clear button and an `已自动填入常去门诊` label; clearing sets `clinicTouched = true` so it stays empty.
- **Risk**: `GrowthRecordDrawer` reading `useDashboardSummaryQuery` when opened directly on `/growth` → **Mitigation**: `/growth` already populates the exact same query key, and `refetchInterval: false` avoids extra polling.
- **Risk**: SQLite migration `00004_default_clinic.sql` Down migration (`DROP COLUMN`) requires SQLite >= 3.35 → **Mitigation**: `modernc.org/sqlite` bundled in `backend/go.mod` is SQLite 3.4x+, supporting `ALTER TABLE DROP COLUMN` natively.

## Migration Plan

1. Add `00004_default_clinic.sql` (embedded automatically via `backend/internal/database/migrations/embed.go` and executed by `goose` on startup).
2. Existing rows receive `default_clinic_name = ''` with zero downtime or manual backfill; on the next non-birth vaccination write with a clinic name, it auto-populates seamlessly.
