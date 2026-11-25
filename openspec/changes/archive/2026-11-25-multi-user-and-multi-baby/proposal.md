# Proposal

## Why

BabyLog currently enforces a single-administrator, single-baby model via SQLite `CHECK (id = 1)` constraints and unscoped baby queries, preventing multiple independent households from sharing one self-hosted instance or a single household from tracking multiple children (e.g., twins or a second child). Introducing isolated multi-user accounts and per-user multi-baby support enables practical multi-household self-hosting without over-engineering storage or introducing unnecessary workspace/RBAC complexity.

## What Changes

- **BREAKING**: Replace the single-row `administrator` table with a multi-user `users` table (enforcing a single `admin` via partial unique index), migrate `sessions.administrator_id` to `sessions.user_id`, and add `user_id` ownership to `baby_profiles` while keeping existing single-admin databases upgrading seamlessly without data loss or forced re-login.
- **BREAKING**: Replace singular `/api/baby`, `/api/records/*`, `/api/dashboard/*`, and `/api/vaccines/*` routes with multi-baby endpoints (`/api/babies`, `/api/babies/:babyId`) and explicit baby-scoped routes (`/api/babies/:babyId/{records,dashboard,vaccines}/*`) guarded by user authentication, mandatory password-change enforcement, and baby-ownership verification (returning HTTP 404 on foreign or non-existent `babyId`).
- Add user lifecycle management for the single Administrator via both CLI (`babylog user create|list|reset-password|disable|enable`, preserving `babylog admin init` compatibility) and a dedicated Web workspace (`/admin/users` backed by `/api/admin/users*`), with no physical user deletion and strict privacy isolation (admin cannot inspect or modify other users' babies or records).
- Add self-service password change (`POST /api/auth/change-password`), a mandatory first-login password change gate (`must_change_password` with `/change-password` and backend HTTP 403 enforcement), login brute-force throttling (per normalized username + global `scrypt` concurrency cap), and optional `BABYLOG_COOKIE_SECURE` configuration.
- Support creating, editing, switching, and hard-deleting up to 10 Baby Profiles per User (`ON DELETE CASCADE`), with a global baby switcher, nickname-confirmation delete dialog, baby-scoped onboarding gate (allowing baby-less users into `/settings` and `/admin/users`), and full client-side cache/store isolation on account or baby switches.

## Capabilities

### New Capabilities
- `user-management`: Single-administrator lifecycle management of ordinary User accounts via CLI and Web (`/admin/users`, `/api/admin/users*`), enforcing single-admin invariants, no user deletion, session revocation on disable/reset, and strict privacy isolation from users' baby data.

### Modified Capabilities
- `admin-auth`: Multi-user credential authentication with case-insensitive normalized username lookup, disabled-account rejection after password verification, per-username login rate limiting and global `scrypt` concurrency protection, optional `BABYLOG_COOKIE_SECURE`, self-service password change (`POST /api/auth/change-password`), and mandatory password-change gate (`must_change_password`).
- `baby-profile`: Per-user multi-baby CRUD under `/api/babies` and `/api/babies/:babyId` (up to 10 babies per User, hard delete with cascade and nickname confirmation), baby-scoped onboarding gate, global baby switcher, and client-side session/baby cache isolation.
- `daily-records`: Move all record endpoints under `/api/babies/:babyId/records/*` with strict authenticated user, cleared password-change gate, and baby-ownership enforcement (HTTP 404 on unknown or foreign baby/record IDs).
- `dashboard-insights`: Move dashboard endpoints under `/api/babies/:babyId/dashboard/*` with user and baby-ownership enforcement, and extend app shell navigation with the global baby switcher and admin-only `/admin/users` entry.
- `vaccine-management`: Move all vaccine endpoints (including default clinic) under `/api/babies/:babyId/vaccines/*` with user and baby-ownership enforcement, preserving atomic cross-baby/cross-user rejection on single and batch operations.

## Impact

- **Database & Migrations**: New goose migration `00005_multi_user_and_multi_baby.sql` rebuilding `administrator` -> `users`, `sessions`, and `baby_profiles` while leaving all 5 downstream record/vaccine tables untouched.
- **Backend (`backend/`)**: `internal/auth`, `internal/baby`, `internal/config`, `internal/httpapi` (middleware, router, auth/baby/admin handlers), `cmd/babylog` (`admin.go` + new `user.go`), and `internal/integration` / unit / CLI tests.
- **Frontend (`src/`)**: Auth store & client session reset helper, `/change-password` and `/admin/users` routes, `src/routeTree.gen.ts` regeneration, baby switcher in sidebar/mobile header, `/settings` multi-baby management + password change, and baby-scoped QueryKeys/API clients across records, growth, dashboard, and vaccines.
- **Documentation**: `GLOSSARY.md` (updated) and `docs/adr/0003-multi-user-row-isolation-and-explicit-baby-api-scope.md` (created).
