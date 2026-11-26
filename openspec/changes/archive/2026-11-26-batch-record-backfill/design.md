# Design: Batch Record Backfill (批量补录)

## Context

BabyLog currently persists daily feeding and care entries in `feeding_records` and `care_records` via single-record endpoints (`POST /api/babies/:babyId/records/feeding`, `POST /api/babies/:babyId/records/care`) and a single-item `QuickRecordDrawer`. When transcribing a postpartum nanny's (月嫂) paper log—where each timestamped row holds any combination of direct breastfeeding, bottled breast milk, formula milk, urination, and bowel movement—entering items one by one requires repeatedly reopening the drawer, switching categories, and re-picking the same date and time.

## Goals / Non-Goals

### Goals
- Support unified date/time selection with optional fill-to-include inputs for the five core log items (亲喂、瓶喂母乳、配方奶、排尿、排便), skipping untouched items cleanly.
- Guarantee atomic all-or-nothing persistence per submission with zero database schema changes and full compatibility with existing lists, daily summaries, smart defaults, and dashboard insights.
- Optimize consecutive multi-timepoint transcription with sticky date, cleared time + relative jump chips (`-3h`, `-2h`, `+2h`, `+3h`), non-blocking duplicate-timestamp notice, and a collapsible session log with one-tap batch undo.
- Provide cohesive desktop and mobile entry points without expanding top-level sidebar routes or crowding the 5-slot mobile tab bar.

### Non-Goals
- No spreadsheet/multi-row bulk table import in this iteration (single time-point form + rapid continuous submission fits mobile one-handed and desktop side-by-side use).
- No sleep, solid food, bath, other care, health, or growth items in the batch backfill form.
- No database schema changes or new batch-delete backend endpoint (session undo reuses existing single-record `DELETE` endpoints).

## Decisions

### 1. Zero Schema Changes & Pee+Poop Merging into `diaper_kind: "both"`
- **Direct breastfeeding** → `feeding_records` (`subtype: "breast"`, `feeding_mode: "direct"`, `breast_side`, `duration_min`).
- **Bottled breast milk** → `feeding_records` (`subtype: "breast"`, `feeding_mode: "bottle"`, `amount_ml`).
- **Formula milk** → `feeding_records` (`subtype: "formula"`, `amount_ml`).
- **Pee & Poop**:
  - Pee only → 1 `care_records` row (`subtype: "diaper"`, `diaper_kind: "pee"`).
  - Poop only → 1 `care_records` row (`subtype: "diaper"`, `diaper_kind: "poop"`, optional `stool_consistency` & `stool_color`).
  - Both pee and poop → **1 merged `care_records` row** (`subtype: "diaper"`, `diaper_kind: "both"`, optional `stool_consistency` & `stool_color`).
- **Rationale**: `AccumulateCareSummary` already increments both `PeeCount` and `PoopCount` while incrementing `TotalCount` once for `diaper_kind: "both"`. Merging prevents double-counting a single diaper change in Care Daily Summary, Dashboard KPIs, and Care Rhythm.
- **Shared note**: An optional single note (up to 500 chars) is attached to every record generated at that time point so context remains visible in both `/feeding` and `/care`.

### 2. Dedicated Transactional Batch Endpoint: `POST /api/babies/:babyId/records/batch`
- **Alternative considered**: Frontend loops over existing `POST /records/feeding` and `POST /records/care`. Rejected because partial failures (network interruption, clock skew, validation error, SQLite write contention) leave half-written records and cause duplicates upon retry, and require multiple HTTP round-trips.
- **Contract**:
  - Request:
    ```json
    {
      "feedings": [ /* FeedingInput[] */ ],
      "cares": [ /* CareInput[] */ ]
    }
    ```
  - Bounds: `1 <= len(feedings) + len(cares) <= MaxBatchCreateItems (20)`. Well within existing 64 KiB `maxAPIBodyBytes`.
  - Validation: `ValidateBatchCreate(in, now)` reuses `ValidateFeeding` and `ValidateCare` with one shared `now := s.now()` before opening the transaction. Any error returns `*ValidationError` (HTTP 400) with a contextual Chinese message (e.g., `第 2 条喂养记录：...`).
  - Transaction: `Store.BatchCreate` inserts all validated records inside a single `s.db.WithContext(ctx).Transaction(...)`, returning HTTP 201 `{ feedings, cares }` (with non-nil empty slices `[]`).
  - Security: Inherits existing `/api/babies/:babyId/records` middleware stack (auth 401, password-changed 403, baby ownership 404, Same-Origin 403, JSON `Content-Type` 415, body size 413, `DisallowUnknownFields` 400).
- **Rationale**: Aligns directly with the existing `POST /api/babies/:babyId/vaccines/batch` precedent, adds minimal backend code (~80 lines), and cleanly supports future multi-timepoint payloads without breaking changes.

### 3. Dedicated `BatchRecordDrawer` + `useBatchRecordStore`
- **Container**: Reuses `EntityDrawer` (`md:max-w-lg` on desktop, `max-h-[90dvh]` bottom drawer on mobile with nested `DatePicker`/`TimePicker` drawers), mounted in `AppShell` alongside `QuickRecordDrawer` and `GrowthRecordDrawer`.
- **Store lifecycle**: `useBatchRecordStore` manages `open` state and is reset in `resetClientSessionState()` (logout / 401 / account switch) and whenever `activeBabyId` changes while open (closing/resetting session log to avoid cross-baby leakage).
- **Entry points**:
  1. **Dashboard (`/dashboard`)**: Compact `批量补录` button in the「一键直记」section header (visible on both desktop and mobile).
  2. **`/feeding` & `/care` pages**: Optional `secondaryHeaderAction` prop on `RecordListPage`, placing a secondary `批量补录` outline button beside the primary create button on desktop.
  3. **`QuickRecordDrawer` (create mode only)**: Lightweight `批量补录` switch button in the header/top bar, closing `QuickRecordDrawer` and opening `BatchRecordDrawer` (ensures 1-tap reachability from the mobile center `+` button and desktop `记一笔` / `N` shortcut on any page).
  4. **Command Palette (`⌘K / Ctrl+K`)**: Adds `批量补录（喂养与护理）` in the「快速记录」group.

### 4. Fill-to-Include Form & Consecutive Time-Point Workflow
- **Top date/time block (always expanded)**:
  - Quick date pills (`昨天`, `今天`) + previous/next day steppers (`<` / `>`, clamped at today) + `DateTimeInputRow` (`maxDate = today`).
  - After a `保存并继续` submission, `dateStr` is preserved, `timeStr` is cleared to `""`, and up to four relative jump chips (`-3h`, `-2h`, `+2h`, `+3h`) computed from the last submitted timestamp are shown (automatically omitting candidates beyond `now`, and updating `dateStr` if a jump crosses midnight).
- **Five items (all start untouched/skipped)**:
  - **亲喂 (`--feeding`)**: Single-row card with inline `[左侧] [右侧] [双侧]` toggles; clicking a side activates direct breastfeeding and prefills `SmartDefaults.feeding.last_breast_duration_min` (with optional alternating-side cue updated across session submissions), expanding compact duration input + `10 / 15 / 20 / 30 分钟` chips; clicking the active side again or `清除` skips it.
  - **瓶喂母乳 & 配方奶 (`--feeding`)**: Symmetric compact rows with numeric input (`placeholder="未填跳过"`, `inputMode="numeric"`, `text-base md:text-sm`) + `SmartDefaults.feeding.frequent_milk_ml` quick chips + clear button. Non-empty invalid inputs (e.g., `0`, `>1000`, non-integer) fail validation explicitly instead of being silently skipped.
  - **排尿 & 排便 (`--care`)**: Side-by-side `ChoiceCardButton` cards (`min-h-11`). Selecting both displays a subtle helper hint `将合并记为 1 条「嘘嘘 + 便便」`. Selecting 排便 expands the optional stool observation panel (reusing `正常（软便 · 黄色）`, consistency, and color chips).
- **Footer & Session Log**:
  - Live summary strip previews exact items to be created (e.g., `即将保存 3 条：亲喂(左15分) · 配方奶 60ml · 嘘嘘+便便`).
  - Dual buttons: `保存并关闭` (outline) and `保存并继续` (primary, `⌘/Ctrl + Enter` shortcut).
  - Collapsible「本次已补录」strip appears once ≥ 1 batch has been submitted in the current drawer session, showing count, latest timestamp summary, and per-batch `撤销` (calls existing `DELETE /records/feeding/:id` and `DELETE /records/care/:id` for each created ID in that batch, then invalidates record/defaults/dashboard caches).
  - If the user picks a `dateStr + timeStr` matching an active (non-undone) session entry, show a non-blocking warning banner to prevent accidental duplicates.

## Risks / Trade-offs

- **Session undo partial failure**: Undoing a 3-record batch calls existing single-record `DELETE` endpoints sequentially/in parallel. If one delete fails mid-way, remaining IDs stay tracked on the session item so the user can retry undo cleanly and cache invalidation still runs to reflect true server state.
- **Mobile keyboard height**: Keeping the 5 items compact (inline toggles & collapsed stool panel by default) ensures the form remains easy to scan and scroll within `max-h-[90dvh]` on 390px viewports.
