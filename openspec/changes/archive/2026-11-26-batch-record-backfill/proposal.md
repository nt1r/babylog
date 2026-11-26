# Proposal

## Why

Caregivers and postpartum nannies (月嫂) often keep a paper log organized by date and timestamp, where each row records up to five items at the same time point: direct breastfeeding, bottled breast milk, formula milk, urination (pee), and bowel movement (poop). Currently, transcribing a full day of paper notes into BabyLog requires opening the Quick Record drawer repeatedly for each item, switching categories, and re-selecting the same date and time over and over—creating high friction and increasing the chance of skipped rows or timestamp mistakes.

## What Changes

- **Transactional batch record creation API (`daily-records`)**:
  - Add `POST /api/babies/:babyId/records/batch` accepting `{ feedings, cares }` arrays that reuse existing `FeedingInput` and `CareInput` contracts directly (1 to 20 total items).
  - Pre-validate all entries against one consistent server clock (`ValidateFeeding` / `ValidateCare`) and persist them in a single SQLite transaction so submissions are strictly all-or-nothing with zero partial-write duplicates on retry, returning HTTP 201 with `{ feedings, cares }`.
  - Zero database schema migrations: every created record is a standard `feeding_records` or `care_records` row, keeping all existing list views, pagination, daily summaries, smart defaults, and dashboard insights 100% compatible.
- **Dedicated Batch Backfill drawer & continuous multi-timepoint UX (`dashboard-insights`)**:
  - Add a dedicated `BatchRecordDrawer` (reusing `EntityDrawer` with its own Zustand store) accessible from the Dashboard one-tap header, `/feeding` and `/care` pages, Quick Record create mode, and the Command Palette (`⌘K / Ctrl+K`).
  - Provide an always-expanded unified date/time header with quick date switching (`昨天` / `今天` / `<` `>`) and five independent, fill-to-include controls (direct breastfeeding, bottled breast milk, formula milk, pee, and poop with optional stool observation), automatically merging simultaneous pee + poop into one `diaper_kind: "both"` care record and applying an optional shared note to every record created at that time point.
  - Optimize consecutive backfill with dual submit actions (`保存并继续` primary + `保存并关闭` secondary): `保存并继续` keeps the drawer open, preserves the active date, clears the time input to prevent accidental duplicates while surfacing valid relative jump chips (`-3h`, `-2h`, `+2h`, `+3h`) derived from the last submitted time, warns non-blockingly if a session timestamp is repeated, and maintains a collapsible "本次已补录" session log with one-tap per-batch undo via existing delete endpoints.

## Capabilities

### New Capabilities

### Modified Capabilities

- `daily-records`: Add `POST /api/babies/:babyId/records/batch` for atomic multi-item creation of feeding and care records under `:babyId`.
- `dashboard-insights`: Add the dedicated Batch Backfill drawer, entry points, fill-to-include five-item layout, consecutive time-point workflow, and session undo log.

## Impact

- **Database**: None (zero schema changes; reuses `feeding_records` and `care_records`).
- **Backend**: Updates `backend/internal/records` (`model.go`, `validate.go`, `store.go`, `validate_test.go`), `backend/internal/httpapi/records_handler.go`, and `backend/internal/integration/daily_records_test.go`.
- **Frontend**: Adds `src/stores/batch-record.ts`, `src/components/batch-record/batch-codec.ts`, and `src/components/batch-record/batch-record-drawer.tsx`; updates `src/lib/records.ts`, `src/lib/session-reset.ts`, `src/components/app-shell/index.tsx`, `src/components/app-shell/command-palette.tsx`, `src/components/quick-record-drawer.tsx`, `src/components/record-list-page.tsx`, `src/routes/_app/dashboard.tsx`, `src/routes/_app/feeding.tsx`, and `src/routes/_app/care.tsx`.
