# Design

## Context

See [proposal.md](./proposal.md) for motivation and capability scope, [GLOSSARY.md](../../../GLOSSARY.md) for updated domain terms, and [ADR-0003](../../../docs/adr/0003-multi-user-row-isolation-and-explicit-baby-api-scope.md) for the recorded architectural trade-offs.

Existing structural foundation and constraints:
- SQLite runs in pure-Go zero-CGO mode (`glebarez/sqlite`) with WAL, `foreign_keys=1`, `busy_timeout=5000`, and `SetMaxOpenConns(1)`.
- All 5 downstream tables (`feeding_records`, `sleep_records`, `care_records`, `health_records`, `vaccine_doses`) already carry `baby_id INTEGER NOT NULL REFERENCES baby_profiles(id) ON DELETE CASCADE`, composite indexes led by `baby_id`, and `WHERE id = ? AND baby_id = ?` guards in `records.Store` and `vaccines.Store`.
- Single-admin coupling is localized to `00001_admin_auth.sql` (`CHECK (id = 1)`), `internal/auth`, `internal/baby` (unscoped `GetFirst`/`Create`/`Update`), and `internal/httpapi/middleware.go` (no `user` stored in `gin.Context`).
- Existing deployment automation (`scripts/install.sh`) invokes `babylog admin init --password-file ... --username=...` on fresh installations and relies on single-file SQLite backup (`scripts/backup.sh`).

## Goals / Non-Goals

**Goals:**
- Enforce airtight two-level data isolation (`users -> baby_profiles -> business tables`) across users and across sibling babies under the same user.
- Enforce single-administrator uniqueness at the SQLite schema level while providing safe non-destructive lifecycle management for ordinary users via both CLI and Web.
- Support seamless zero-data-loss upgrade of existing single-admin SQLite databases, keeping active sessions and existing baby records intact under the sole administrator.
- Prevent client-side cross-account and cross-baby cache/drawer leakage without introducing external infrastructure (no Redis, no database switch).

**Non-Goals:**
- Cross-account baby sharing, household memberships, or dynamic RBAC permission matrices (one household = one User).
- Public self-registration, email verification, OAuth/OIDC, or user self-deletion / admin user deletion.
- Soft-deletion or recycle bin for Baby Profiles (hard delete via `ON DELETE CASCADE` with nickname confirmation).
- Preserving legacy unscoped `/api/baby`, `/api/records/*`, `/api/dashboard/*`, `/api/vaccines/*` routes alongside the new `/api/babies/:babyId/*` contract.

## Decisions

### 1. Database Migration (`00005_multi_user_and_multi_baby.sql`)

Because SQLite does not support `ALTER TABLE DROP CONSTRAINT`, migration `00005` uses standard table-rebuild semantics (`PRAGMA foreign_keys = OFF` outside transaction or goose `-- +goose NO TRANSACTION` with explicit transaction + `PRAGMA foreign_key_check` before re-enabling `foreign_keys = ON`):

- **`users` table**:
  ```sql
  CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      username_normalized TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
      must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_users_single_admin ON users(role) WHERE role = 'admin';
  ```
  Existing `administrator` row (`id = 1`) is copied into `users` with `role = 'admin'`, `disabled = 0`, `must_change_password = 0`, `username_normalized = lower(username)`, and UTC timestamps.
- **`sessions` table rebuild**:
  Replaces `administrator_id` (`CHECK (administrator_id = 1)`) with `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`, preserves valid existing rows (`user_id = administrator_id`), and adds `idx_sessions_user_id ON sessions(user_id)`.
- **`baby_profiles` table rebuild**:
  Adds `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`, backfills existing profiles to the migrated administrator `id = 1`, and adds non-unique index `idx_baby_profiles_user_id ON baby_profiles(user_id, id)`. Existing `feeding_records` / `sleep_records` / `care_records` / `health_records` / `vaccine_doses` rows retain their `baby_id` foreign keys untouched (verified by `PRAGMA foreign_key_check`).

> **Note on `goose` transactions**: SQLite ignores `PRAGMA foreign_keys = OFF` inside an active transaction. Therefore `00005_multi_user_and_multi_baby.sql` MUST include `-- +goose NO TRANSACTION`, wrap DDL/data migration inside an explicit `BEGIN IMMEDIATE; ... COMMIT;` after `PRAGMA foreign_keys = OFF;`, run `PRAGMA foreign_key_check;`, and restore `PRAGMA foreign_keys = ON;`.

### 2. Auth, Rate Limiting, and Password-Change Gate (`internal/auth`, `internal/config`, `internal/httpapi`)

- **Model & Store**:
  - Replace `AdminUser` / `Administrator` with `User` (`ID`, `Username`, `UsernameNormalized`, `PasswordSalt`, `PasswordHash`, `Role`, `Disabled`, `MustChangePassword`, `CreatedAt`, `UpdatedAt`) and external projection `AuthUser` (`id`, `username`, `role`, `must_change_password`) plus `UserSummary` for admin listing (`id`, `username`, `role`, `disabled`, `must_change_password`, `created_at`).
  - `Authenticate(ctx, username, password)` queries `WHERE username_normalized = lower(username)`. Even when not found, it executes a dummy `scrypt` derivation and constant-time comparison so timing remains uniform. Only when `exists && passwordMatches` does it check `user.Disabled` and return sentinel `ErrUserDisabled` (mapped to HTTP 403); otherwise it returns `(nil, nil)` (HTTP 401).
  - `GetSession(ctx, token)` joins `users` with `sessions.token = ? AND sessions.expires_at > ? AND users.disabled = 0` so disabling a user immediately invalidates any cached or concurrent session.
  - `ChangePassword(ctx, userID, currentPassword, newPassword, currentToken)` verifies `currentPassword` (constant-time `scrypt`), rejects `newPassword == currentPassword` when `user.MustChangePassword` is true, derives the new hash **outside** the DB transaction, then atomically updates `password_salt`/`password_hash`/`must_change_password = 0`, deletes all sessions for `user_id`, and inserts a newly rotated session token.
  - `CreateUser`, `ResetUserPassword`, `SetUserDisabled` enforce: `role` for ordinary creation is always `"user"`; disabling or web-resetting the sole `admin` is rejected with a domain validation error (CLI `user reset-password` explicitly calls an internal/CLI-scoped reset helper that permits resetting the `admin` password for host-level recovery while still clearing all sessions).
- **In-Memory Login Limiter & `scrypt` Concurrency Guard**:
  - Dedicated pure-Go `LoginGuard` in `internal/auth` (injectable clock via `WithClock` for deterministic tests, zero external deps):
    - Per-normalized-username sliding window / ring of failure timestamps: **10 failures within 15 minutes** triggers `ErrRateLimited` (HTTP 429) before invoking `scrypt`; successful login resets that username's bucket; periodic/lazy map pruning caps memory growth.
    - Bounded channel semaphore (`cap = 8`) around `scrypt` derivation with fast-fail/short wait returning HTTP 429 so credential stuffing across random usernames cannot saturate host CPU.
- **Reverse-Proxy Cookie Configuration**:
  - `internal/config` adds optional boolean `BABYLOG_COOKIE_SECURE` (default `false`; invalid non-boolean value fails startup cleanly). `setSessionCookie` sets `Secure: cfg.CookieSecure || c.Request.TLS != nil`.

### 3. Middleware Chain & Authorization Boundaries (`internal/httpapi`)

Protected routes follow a strict layered middleware pipeline:

1. `requireAuthMiddleware`: validates session cookie via `auth.Store.GetSession`, clears invalid cookies, injects `*auth.AuthUser` into `gin.Context` (`ctxAuthUserKey`).
2. `POST /api/auth/change-password`: mounted directly under `requireAuthMiddleware` (allowed while `must_change_password == true`).
3. `requirePasswordChangedMiddleware`: checks `user.MustChangePassword`; if true, aborts with HTTP 403 `{"error": "请先修改初始密码", "code": "PASSWORD_CHANGE_REQUIRED"}`.
4. Under `requirePasswordChangedMiddleware`:
   - **Admin group (`/api/admin/users*`)**: adds `requireAdminMiddleware` (`user.Role == "admin"`, else HTTP 403). Never exposes baby or record tables.
   - **Baby management (`/api/babies`, `/api/babies/:babyId`)**: handlers extract `user.ID` via `mustAuthUser(c)` and call user-scoped `baby.Store` methods (`ListByUser`, `CreateForUser`, `UpdateForUser`, `DeleteForUser`).
   - **Baby-scoped business groups (`/api/babies/:babyId/{records,dashboard,vaccines}`)**: adds `requireBabyOwnershipMiddleware`, which parses `:babyId` (invalid integer -> HTTP 400) and calls `babyStore.GetByIDForUser(ctx, user.ID, babyID)` (`WHERE id = ? AND user_id = ?`). Not found (whether missing or owned by another user) aborts with HTTP 404 to prevent ID enumeration. Downstream handlers read the verified `*baby.Profile` via `mustBabyProfile(c)`.

### 4. `baby.Store` Scoping & Hard Deletion (`internal/baby`)

- Remove unscoped `GetFirst`, `Create`, `Update`.
- Provide user-scoped methods:
  - `ListByUser(ctx, userID)` (`ORDER BY id ASC`)
  - `GetByIDForUser(ctx, userID, babyID)`
  - `CreateForUser(ctx, userID, in, loc)`: checks `COUNT(*) WHERE user_id = ?` inside transaction; if `>= MaxBabiesPerUser` (10), returns `*ValidationError` (HTTP 400).
  - `UpdateForUser(ctx, userID, babyID, in, loc)`: `WHERE id = ? AND user_id = ?`, returns `ErrNotFound` (404) if missing/foreign.
  - `DeleteForUser(ctx, userID, babyID)`: `DELETE FROM baby_profiles WHERE id = ? AND user_id = ?`, returns `ErrNotFound` (404) if `RowsAffected == 0`; SQLite `ON DELETE CASCADE` removes dependent records and vaccine doses atomically.
  - `UpdateDefaultClinic(ctx, userID, babyID, rawClinicName)`: `WHERE id = ? AND user_id = ?` for defense-in-depth alongside middleware verification.

### 5. CLI Commands (`backend/cmd/babylog`)

- Keep `babylog admin init --password-file <path> [--username <name>]` unchanged in interface and behavior (creates the sole `admin` with `must_change_password = false`; fails if an `admin` already exists).
- Add `babylog user` subcommand group (`backend/cmd/babylog/user.go`):
  - `user create --username <name> --password-file <path> [--force-change]`
  - `user list`
  - `user reset-password --username <name> --password-file <path> [--force-change]` (supports resetting any user including the sole `admin`)
  - `user disable --username <name>` (rejects disabling `admin`)
  - `user enable --username <name>`
- Reuse `readPasswordFile` so passwords are never passed on the command line.

### 6. Frontend Multi-User, Multi-Baby & State Isolation (`src/`)

- **Routes & Guards**:
  - Add `/change-password` (full-screen gate) and `/_app/admin/users` (or `/_app/admin.users`, admin-only guard redirecting non-admins to `/dashboard`), then run `pnpm build:web` to regenerate `src/routeTree.gen.ts`.
  - `_app.tsx` guard priority order:
    1. `restoring` -> skeleton
    2. `!user` -> `<Navigate to="/login" />`
    3. `user.must_change_password` -> `<Navigate to="/change-password" />`
    4. Account-level routes (`/settings`, `/admin/users`) -> render `<AppShell>` directly without requiring a baby
    5. Baby-scoped routes -> load `useBabiesQuery(user.id)`; error -> retry view; `babies.length === 0` -> `<Navigate to="/onboarding" />`; otherwise resolve `activeBabyId` and render `<AppShell>`.
- **Active Baby Store (`src/stores/baby.ts`) & Switcher**:
  - Stores `activeBabyId` in memory and persists per-user key `babylog:active-baby:<userId>` in `localStorage`; automatically falls back to `babies[0].id` when missing/invalid/deleted.
  - Switching `activeBabyId` closes and resets `useQuickRecordStore` and `useGrowthRecordStore` so open edit drawers cannot submit against the wrong baby.
  - Sidebar header (`app-sidebar.tsx`) and mobile header (`admin-header.tsx`) render a compact baby switcher dropdown with an inline「添加宝宝」trigger (opening a create-baby drawer/dialog).
- **Query Keys & `resetClientSessionState()`**:
  - All baby-scoped query keys include `babyId` (e.g., `['baby', babyId, 'records', ...]`, `['baby', babyId, 'dashboard', ...]`, `['baby', babyId, 'vaccines', ...]`), and the babies list key includes `user.id` (`['babies', user.id]`).
  - Centralize `resetClientSessionState()` invoked on logout, global 401 handler, and login user change: runs `queryClient.clear()`, resets `useQuickRecordStore`, `useGrowthRecordStore`, and in-memory `activeBabyId`.
- **`/settings` & `/admin/users` UI**:
  - `/settings` adds: (1) multi-baby management section (list/select baby to edit,「添加宝宝」button, danger-zone「删除宝宝档案」with exact-nickname input confirmation); (2)「修改密码」card calling `POST /api/auth/change-password`.
  - `/admin/users` (visible in sidebar `设置` group only for `user.role === 'admin'`): displays user table (`username`, role badge, status badge, created time; zero baby/record counts), create-user dialog with client-side `crypto.getRandomValues` password generator + one-time copy, reset-password dialog, and disable/enable toggle (admin row read-only).

## Risks / Trade-offs

- **[Risk] SQLite table rebuild in migration `00005` could violate foreign keys if executed inside goose's implicit transaction** → Mitigation: mark `00005` with `-- +goose NO TRANSACTION`, run `PRAGMA foreign_keys = OFF` before `BEGIN IMMEDIATE`, verify with `PRAGMA foreign_key_check` before `COMMIT`, restore `PRAGMA foreign_keys = ON`, and add an automated migration upgrade test populating a v4 schema database before running `database.Open`.
- **[Risk] Existing integration tests (`backend/internal/integration/*_test.go`) target legacy `/api/baby`, `/api/records/*`, `/api/dashboard/*`, `/api/vaccines/*` paths** → Mitigation: update `harness_test.go` / `scenario_test.go` and existing integration test files to use `/api/babies/:babyId/*` alongside new multi-user/multi-baby isolation tests so all OpenSpec scenarios remain verified without stale route references.
- **[Risk] In-memory login rate limiter resets on process restart and does not share state across multiple replicas** → Mitigation: BabyLog is a single-process SQLite self-hosted deployment (multi-replica is unsupported by SQLite single-writer architecture), so in-memory limiting matches the deployment topology without introducing Redis.
- **[Risk] Frontend `activeBabyId` in `localStorage` is shared across tabs of the same browser profile** → Mitigation: keep `activeBabyId` in per-tab React/Zustand memory once initialized and only read `localStorage` on initial load/user switch; every backend request carries explicit `:babyId` in the URL so tabs cannot accidentally write to the wrong baby.

## Migration Plan

1. Back up `data/babylog.sqlite` before upgrading (standard `scripts/backup.sh`).
2. Deploy updated binary / container; `database.Open` automatically executes `00005_multi_user_and_multi_baby.sql` on startup.
3. Existing single administrator continues seamlessly with existing session, babies, records, and vaccines intact; operator can immediately create additional household accounts via CLI or `/admin/users`.
4. Rollback strategy: restore pre-upgrade `babylog.sqlite` backup if downgrading to a single-user release (schema downgrade across multi-user data is inherently lossy).
