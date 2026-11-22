# admin-auth Specification

## Purpose

Manages single-administrator CLI initialization, salted password authentication, and SQLite-backed cookie sessions for the BabyLog management application.

## Requirements

### Requirement: Administrator CLI initialization
The system SHALL allow initializing a single administrator account from a local password file via CLI and SHALL refuse to overwrite an existing administrator.

#### Scenario: Initialize default administrator from password file
- **WHEN** the operator runs the initialization CLI with a valid regular password file containing a 12 to 1024 character password (with at most one trailing LF or CRLF stripped)
- **THEN** the system stores the administrator with username `admin` and a salted scrypt password hash in SQLite and exits with status 0

#### Scenario: Initialize administrator with custom username
- **WHEN** the operator runs the initialization CLI with `--username` set to a valid 1 to 128 character string without leading or trailing whitespace
- **THEN** the system stores the administrator under the specified username

#### Scenario: Reject duplicate administrator initialization
- **WHEN** an administrator already exists in SQLite and the operator runs the initialization CLI again
- **THEN** the system preserves the existing administrator record, reports an error, and exits with a non-zero status

#### Scenario: Reject invalid password length
- **WHEN** the password file contains fewer than 12 characters or more than 1024 characters after stripping a single trailing newline
- **THEN** the system rejects initialization without creating an administrator record and exits with a non-zero status

### Requirement: Administrator login and session creation
The system SHALL authenticate administrator credentials on `POST /api/auth/login` using JSON payloads, issue an `HttpOnly; SameSite=Strict` session cookie backed by SQLite, and rotate any previous session token.

#### Scenario: Successful administrator login
- **WHEN** a same-origin client submits valid administrator `username` and `password` as `application/json` to `POST /api/auth/login`
- **THEN** the server responds with HTTP 200, returns `{ user: { username, role: "admin" } }`, persists a new session token in SQLite, and sets the `babylog_session` cookie with `HttpOnly`, `SameSite=Strict`, and `Path=/`

#### Scenario: Reject invalid credentials
- **WHEN** a client submits an incorrect username or password to `POST /api/auth/login`
- **THEN** the server responds with HTTP 401 and an error message without setting a session cookie

#### Scenario: Reject cross-origin state-changing requests
- **WHEN** a `POST` request to `/api/auth/login` or `/api/auth/logout` includes an `Origin` header whose host does not match the request `Host` header
- **THEN** the server responds with HTTP 403 and rejects the request

#### Scenario: Reject unsupported content type or oversized login body
- **WHEN** a `POST /api/auth/login` request does not use `application/json` or exceeds the 16 KiB body limit
- **THEN** the server responds with HTTP 415 or HTTP 413 respectively without authenticating

### Requirement: Session restoration and expiration
The system SHALL restore active administrator sessions via `GET /api/auth/session` and clear invalid or expired session cookies.

#### Scenario: Restore active session
- **WHEN** a client sends `GET /api/auth/session` with a valid unexpired `babylog_session` cookie
- **THEN** the server responds with HTTP 200 and `{ user: { username, role: "admin" } }`

#### Scenario: Clear expired or unknown session cookie
- **WHEN** a client sends `GET /api/auth/session` with an expired, revoked, or malformed `babylog_session` cookie
- **THEN** the server responds with HTTP 200, returns `{ user: null }`, and clears the `babylog_session` cookie with `Max-Age=0`

### Requirement: Administrator logout
The system SHALL revoke active sessions on `POST /api/auth/logout` and clear the client session cookie.

#### Scenario: Revoke session on logout
- **WHEN** an authenticated client sends a same-origin `POST /api/auth/logout` request
- **THEN** the server deletes the session from SQLite, responds with HTTP 200 and `{ user: null }`, sets `Max-Age=0` on `babylog_session`, and subsequent requests using the old token are no longer authenticated
