## Purpose

Manages the single Administrator's lifecycle operations over ordinary household User accounts via both CLI and Web interfaces while enforcing single-admin uniqueness, non-destructive disablement, and strict privacy isolation from users' baby care data.

## ADDED Requirements

### Requirement: Single-administrator lifecycle invariant
The system MUST enforce at most one User with `role: "admin"` at the database layer, SHALL never allow creating a second administrator, SHALL never allow disabling the Administrator, and SHALL not provide physical user deletion.

#### Scenario: Prevent creating a second administrator
- **WHEN** an Administrator already exists and any code path or CLI invocation attempts to insert another User with `role: "admin"`
- **THEN** the database partial unique constraint rejects the write and preserves the sole existing Administrator

#### Scenario: Prevent disabling the sole administrator
- **WHEN** a CLI command or API request attempts to disable the Administrator account
- **THEN** the system rejects the operation without modifying the Administrator's status or active sessions

### Requirement: CLI user lifecycle management
The system SHALL provide `babylog user` subcommands (`create`, `list`, `reset-password`, `disable`, `enable`) reading passwords exclusively from local `--password-file` paths, creating ordinary Users (`role: "user"`), supporting optional `--force-change`, allowing password recovery for any User including the Administrator, and revoking all sessions on disable or password reset.

#### Scenario: Create and list ordinary users via CLI
- **WHEN** the operator runs `babylog user create --username Alice --password-file <path>` (optionally with `--force-change`) and then runs `babylog user list`
- **THEN** the system persists `Alice` with `role: "user"`, rejects case-insensitive duplicate usernames (such as `alice`), and `user list` prints non-sensitive account metadata (`id`, `username`, `role`, `disabled`, `created_at`)

#### Scenario: Reset password for any user including the administrator via CLI
- **WHEN** the operator runs `babylog user reset-password --username <target> --password-file <path>` (optionally with `--force-change`)
- **THEN** the system updates the target User's salted scrypt hash (including when `<target>` is the Administrator), revokes all existing sessions for that User, and allows login with the new password

#### Scenario: Disable and re-enable an ordinary user via CLI
- **WHEN** the operator runs `babylog user disable --username Alice` and later `babylog user enable --username Alice`
- **THEN** disabling immediately revokes all of Alice's active sessions and blocks her login, while re-enabling restores login access without losing any of Alice's baby profiles or records

### Requirement: Admin web user management API
The system SHALL expose `/api/admin/users` (`GET`, `POST`), `/api/admin/users/:id` (`PATCH` for `disabled`), and `/api/admin/users/:id/reset-password` (`POST`) exclusively to the authenticated Administrator whose `must_change_password` is false, rejecting ordinary Users with HTTP 403 and returning only account metadata without baby or record counts.

#### Scenario: Reject ordinary user access to admin endpoints
- **WHEN** an authenticated User with `role: "user"` calls any `/api/admin/users*` endpoint
- **THEN** the server responds with HTTP 403 and a Chinese error message without leaking user records

#### Scenario: Administrator creates, resets password, and disables an ordinary user via API
- **WHEN** the Administrator sends `POST /api/admin/users` with a valid username and password, then `POST /api/admin/users/:id/reset-password`, and then `PATCH /api/admin/users/:id` with `{ "disabled": true }`
- **THEN** creation responds with HTTP 201 and sets `role: "user"` and `must_change_password: true`, password reset sets `must_change_password: true` and revokes the target User's sessions, disabling revokes the target User's sessions, and `GET /api/admin/users` lists only account metadata (`id`, `username`, `role`, `disabled`, `must_change_password`, `created_at`)

#### Scenario: Reject admin self-disable or self-reset via admin endpoints
- **WHEN** the Administrator calls `PATCH /api/admin/users/:adminId` to disable themselves or `POST /api/admin/users/:adminId/reset-password`
- **THEN** the server responds with HTTP 400 and a Chinese error message without modifying the Administrator account

#### Scenario: Reject duplicate username on web user creation
- **WHEN** the Administrator sends `POST /api/admin/users` with a username matching an existing User case-insensitively
- **THEN** the server responds with HTTP 409 and a Chinese error message without creating a duplicate row

### Requirement: Admin web user management workspace
The web application SHALL provide `/admin/users` visible only to the Administrator (redirecting non-admin Users to `/dashboard`), supporting user listing without baby/record counts, user creation with optional client-side random password generation and one-time copy, password reset, and disable/enable toggles while rendering the Administrator's own row as read-only.

#### Scenario: Administrator manages ordinary users in web workspace
- **WHEN** the Administrator navigates to `/admin/users` (even without creating any Baby Profile) and creates a User with a generated temporary password
- **THEN** the workspace displays the one-time password copy UI until dismissed, lists all Users with status badges (`正常`, `待改密`, `已停用`) and zero baby/record statistics, and renders disable/reset controls only on ordinary User rows
