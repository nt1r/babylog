# admin-auth Specification

## Purpose

Manages single-administrator CLI initialization, salted password authentication, and SQLite-backed cookie sessions for the BabyLog management application.

## Requirements

### Requirement: Administrator CLI initialization
The system SHALL allow initializing the single Administrator account (`role: "admin"`, `must_change_password: false`) from a local password file via `babylog admin init` and SHALL refuse to create a second administrator or overwrite an existing one.

#### Scenario: Initialize default administrator from password file
- **WHEN** the operator runs the initialization CLI with a valid regular password file containing a 12 to 1024 character password (with at most one trailing LF or CRLF stripped)
- **THEN** the system stores the Administrator with username `admin`, `role: "admin"`, and a salted scrypt password hash in SQLite and exits with status 0

#### Scenario: Initialize administrator with custom username
- **WHEN** the operator runs the initialization CLI with `--username` set to a valid 1 to 128 character string without leading or trailing whitespace
- **THEN** the system stores the Administrator preserving the display username and indexing its lowercase normalized form for uniqueness

#### Scenario: Reject duplicate administrator initialization
- **WHEN** an Administrator already exists in SQLite and the operator runs the initialization CLI again
- **THEN** the system preserves the existing Administrator record, reports an error, and exits with a non-zero status

#### Scenario: Reject invalid password length
- **WHEN** the password file contains fewer than 12 characters or more than 1024 characters after stripping a single trailing newline
- **THEN** the system rejects initialization without creating a User record and exits with a non-zero status

### Requirement: Administrator login and session creation
The system SHALL authenticate any User on `POST /api/auth/login` via case-insensitive normalized username lookup and constant-time salted scrypt verification, reject disabled Users with HTTP 403 only after password verification succeeds, issue an `HttpOnly; SameSite=Strict` cookie (with `Secure` when TLS or `BABYLOG_COOKIE_SECURE=true`), and rotate any previous session token.

#### Scenario: Successful administrator login
- **WHEN** a same-origin client submits valid User `username` (matching case-insensitively) and `password` as `application/json` to `POST /api/auth/login`
- **THEN** the server responds with HTTP 200, returns `{ user: { id, username, role, must_change_password } }` using the stored display username, persists a new session token bound to `user_id` in SQLite, revokes any previous cookie token, and sets the `babylog_session` cookie with `HttpOnly`, `SameSite=Strict`, and `Path=/`

#### Scenario: Reject invalid credentials
- **WHEN** a client submits an unknown username or an incorrect password (including for a disabled account) to `POST /api/auth/login`
- **THEN** the server still executes a full scrypt derivation and constant-time comparison and responds with HTTP 401 and `账号或密码不正确` without setting a session cookie

#### Scenario: Reject disabled user after password verification succeeds
- **WHEN** a client submits the correct password for a User with `disabled: true` to `POST /api/auth/login`
- **THEN** the server responds with HTTP 403 and `该账号已被停用，请联系管理员` without issuing a session cookie

#### Scenario: Enforce Secure cookie flag when BABYLOG_COOKIE_SECURE is enabled
- **WHEN** the server runs with `BABYLOG_COOKIE_SECURE=true` behind a TLS-terminating reverse proxy and a User signs in over plain HTTP to the backend
- **THEN** the issued `babylog_session` cookie includes the `Secure` attribute

#### Scenario: Reject cross-origin state-changing requests
- **WHEN** a `POST` request to `/api/auth/login`, `/api/auth/logout`, or `/api/auth/change-password` includes an `Origin` header whose host does not match the request `Host` header
- **THEN** the server responds with HTTP 403 and rejects the request

#### Scenario: Reject unsupported content type or oversized login body
- **WHEN** a `POST /api/auth/login` request does not use `application/json` or exceeds the 16 KiB body limit
- **THEN** the server responds with HTTP 415 or HTTP 413 respectively without authenticating

### Requirement: Session restoration and expiration
The system SHALL restore active User sessions via `GET /api/auth/session` returning `{ user: { id, username, role, must_change_password } }`, and SHALL treat expired, unknown, or disabled-User sessions as unauthenticated while clearing the session cookie.

#### Scenario: Restore active session
- **WHEN** a client sends `GET /api/auth/session` with a valid unexpired `babylog_session` cookie belonging to an enabled User
- **THEN** the server responds with HTTP 200 and `{ user: { id, username, role, must_change_password } }`

#### Scenario: Clear expired or unknown session cookie
- **WHEN** a client sends `GET /api/auth/session` with an expired, revoked, malformed, or disabled-User `babylog_session` cookie
- **THEN** the server responds with HTTP 200, returns `{ user: null }`, and clears the `babylog_session` cookie with `Max-Age=0`

### Requirement: Administrator logout
The system SHALL revoke only the caller's active session token on `POST /api/auth/logout` and clear the client session cookie without affecting other Users' or devices' sessions.

#### Scenario: Revoke session on logout
- **WHEN** User A and User B are both logged in and User A sends a same-origin `POST /api/auth/logout` request
- **THEN** the server deletes only User A's current session from SQLite, responds with HTTP 200 and `{ user: null }`, sets `Max-Age=0` on User A's `babylog_session`, and User B's session remains authenticated

### Requirement: Login brute-force throttling and scrypt concurrency guard
The system SHALL enforce in-memory per-normalized-username failure rate limiting on `POST /api/auth/login` (rejecting requests with HTTP 429 after 10 consecutive failures within a 15-minute window and clearing the counter on successful login) and SHALL cap concurrent `scrypt` derivations globally (8 concurrent slots) returning HTTP 429 on saturation.

#### Scenario: Throttle repeated failed login attempts for a username
- **WHEN** 10 consecutive failed login attempts occur for the same normalized username within 15 minutes and another login attempt arrives for that username
- **THEN** the server responds with HTTP 429 and a Chinese rate-limit message without authenticating, and allows login again after the 15-minute window elapses or resets the counter upon a successful login

### Requirement: Self-service password change
The system SHALL provide `POST /api/auth/change-password` allowing any authenticated active User to verify their `current_password`, set a valid `new_password` (12 to 1024 characters), clear `must_change_password`, rotate their current session cookie, and revoke all other sessions belonging to that User in a single transaction.

#### Scenario: Successfully change own password and revoke other sessions
- **WHEN** an authenticated User submits valid `current_password` and `new_password` to `POST /api/auth/change-password` while holding sessions on two devices
- **THEN** the server updates the User's salted scrypt hash, clears `must_change_password`, rotates the calling device's `babylog_session` cookie, revokes the other device's session token, and responds with HTTP 200 and the updated `{ user }`

#### Scenario: Reject password change with incorrect current password
- **WHEN** an authenticated User submits an incorrect `current_password` to `POST /api/auth/change-password`
- **THEN** the server responds with HTTP 401 and a Chinese error message without modifying the stored password hash or revoking sessions

#### Scenario: Reject unchanged password during forced password change
- **WHEN** a User with `must_change_password: true` submits `new_password` equal to `current_password` on `POST /api/auth/change-password`
- **THEN** the server responds with HTTP 400 and a Chinese error message without clearing `must_change_password`

### Requirement: Mandatory password change gate
When an authenticated User has `must_change_password: true`, the system MUST block access to all non-authentication protected API endpoints with HTTP 403 until the password is changed.

#### Scenario: Block business and admin APIs while password change is required
- **WHEN** an authenticated User with `must_change_password: true` calls `GET /api/babies`, any `/api/babies/:babyId/*` endpoint, or any `/api/admin/*` endpoint
- **THEN** the server responds with HTTP 403 and `{ "error": "请先修改初始密码", "code": "PASSWORD_CHANGE_REQUIRED" }` while continuing to allow `GET /api/auth/session`, `POST /api/auth/change-password`, and `POST /api/auth/logout`

### Requirement: Web forced password change redirect
The web application SHALL redirect any authenticated User with `must_change_password: true` to a dedicated full-screen `/change-password` view until the password is updated.

#### Scenario: Redirect web client to forced password change screen
- **WHEN** a User with `must_change_password: true` signs in or restores a session in the web application
- **THEN** the web client routes the User to `/change-password` (providing password change and logout actions) and unlocks normal navigation immediately after the password is updated
