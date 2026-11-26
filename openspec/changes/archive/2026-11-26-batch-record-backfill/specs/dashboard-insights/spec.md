## ADDED Requirements

### Requirement: Batch backfill drawer for feeding and care records
The web application SHALL provide a dedicated Batch Backfill drawer accessible from the dashboard one-tap header, `/feeding` and `/care` pages, Quick Record create mode, and Command Palette, letting caregivers pick one date/time, optionally fill direct breastfeeding, bottled breast milk, formula, pee, and poop (merging pee+poop into `both`), continue consecutive time points with sticky date and relative time chips, and undo session batches.

#### Scenario: Submit selected feeding and care items at one time point and skip untouched items
- **WHEN** an authenticated User opens the Batch Backfill drawer, selects a date and time, fills direct breastfeeding and formula milk while toggling both pee and poop (with optional stool details) and leaving bottled breast milk blank, and submits
- **THEN** the client sends a single `POST /api/babies/:babyId/records/batch` request containing the filled feeding items and one merged `diaper_kind: "both"` care item (applying any optional shared note to each created item), skips untouched items, and refreshes record lists, smart defaults, and dashboard queries

#### Scenario: Continue consecutive time points with sticky date, relative time chips, and session undo
- **WHEN** an authenticated User clicks `保存并继续` in the Batch Backfill drawer after submitting a time point
- **THEN** the drawer stays open, preserves the submitted date, clears the time input while offering valid relative jump chips (`-3h`, `-2h`, `+2h`, `+3h`) derived from the last submitted time, resets the five item inputs and note, displays a non-blocking warning if a previously submitted session timestamp is chosen again, and records the batch in a collapsible session log supporting one-tap undo via existing delete endpoints
