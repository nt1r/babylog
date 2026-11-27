# Tasks

## 1. Backend Transactional Batch Creation API

- [x] 1.1 Add `MaxBatchCreateItems`, `BatchCreateInput`, `BatchCreateResult`, and `ValidateBatchCreate` in `backend/internal/records/model.go` & `backend/internal/records/validate.go`, add transactional `Store.BatchCreate` in `backend/internal/records/store.go`, and register `POST /api/babies/:babyId/records/batch` in `backend/internal/httpapi/records_handler.go`
- [x] 1.2 Implement and run the `daily-records` unit and API integration tests specified in `test-plan.md` (`backend/internal/records/validate_test.go` and `backend/internal/integration/daily_records_test.go`), and update the integration test index in `docs/testing-guide.md` (`cd backend && CGO_ENABLED=0 go test -v -run TestValidateBatchCreate ./internal/records/... && CGO_ENABLED=0 go test -v -run TestRecordsBatchCreate ./internal/integration/...`)

## 2. Frontend Batch Codec, Store & API Client

- [x] 2.1 Add `BatchCreateRecordsInput`, `BatchCreateRecordsResult`, `useBatchCreateRecordsMutation`, and batch-delete helper for session undo in `src/lib/records.ts`, add `src/stores/batch-record.ts`, and wire store reset into `src/lib/session-reset.ts`
- [x] 2.2 Implement `src/components/batch-record/batch-codec.ts` (draft state, fill-to-include validation & payload builder with pee+poop `both` merging, live preview formatter, relative jump chip calculation `-3h/-2h/+2h/+3h` clamped to now, duplicate session timestamp detector, and alternating breast-side session hint) and verify pure TS logic via an out-of-repo temporary verification script (`$TMPDIR`)

## 3. Batch Backfill Drawer UI & Multi-Surface Entry Points

- [x] 3.1 Implement `src/components/batch-record/batch-record-drawer.tsx` reusing `EntityDrawer`, `DateTimeInputRow`, `ChoiceCardButton`, `QuickChip`, `Input`, `Alert`, `Collapsible`, and `useSmartDefaultsQuery` (including `昨天`/`今天`/`<`/`>` date helpers, relative jump chips, five compact fill-to-include controls, optional stool observation, live preview footer with `保存并关闭` & `保存并继续` + `⌘/Ctrl+Enter`, and collapsible「本次已补录」session strip with one-tap undo) and mount it in `src/components/app-shell/index.tsx`
- [x] 3.2 Wire entry points across `src/routes/_app/dashboard.tsx` (one-tap section header), `src/components/record-list-page.tsx` + `src/routes/_app/feeding.tsx` + `src/routes/_app/care.tsx` (secondary header action), `src/components/quick-record-drawer.tsx` (create-mode quick switch), and `src/components/app-shell/command-palette.tsx` (Command Palette action)

## 4. Verification & Spec Sync

- [x] 4.1 Run formatting, typecheck, backend tests, and lint (`pnpm format && pnpm check && pnpm test && pnpm lint`), and run out-of-repo headless visual verification (`390px` mobile + desktop, light & dark modes) covering the Batch Backfill drawer states (initial empty, filled 5 items with stool details, post-submit continuous state with relative chips & session log) and entry surfaces
- [x] 4.2 Archive the `batch-record-backfill` change via `openspec archive` to sync `openspec/specs/` and re-run final `pnpm lint` (including `check-spec-refs` and `openspec validate --all --strict`)
