# data-export Specification

## Purpose

Provides authenticated, timezone-aware multi-sheet Excel (`.xlsx`) data export for a Baby Profile's daily aggregate summaries and chronological raw records across selectable care categories and preset or custom local date ranges.

## Requirements

### Requirement: Authenticated baby-scoped access to data export
The system MUST require an active User session with `must_change_password: false` and an owned `:babyId` for `GET /api/babies/:babyId/export/xlsx`, returning HTTP 401 when unauthenticated, HTTP 403 when password change is pending, and HTTP 404 when `:babyId` is unknown or owned by another User.

#### Scenario: Reject unauthenticated, pending-password, or foreign-baby export request
- **WHEN** an unauthenticated client, a User with `must_change_password: true`, or User B targeting User A's `:babyId` requests `GET /api/babies/:babyId/export/xlsx`
- **THEN** the server responds with HTTP 401, HTTP 403, or HTTP 404 respectively with a Chinese error message without returning any workbook data

### Requirement: Multi-sheet Excel workbook export by date range and categories
The system SHALL provide `GET /api/babies/:babyId/export/xlsx` accepting IANA `tz` (default `Asia/Shanghai`), either `days` (`1..366`, default `30`) or inclusive local `start`/`end` dates (`YYYY-MM-DD`, span `<= 366` days), and comma-separated `categories` (`feeding,sleep,care,health,growth`, default all), returning a standard `.xlsx` file with a `按日汇总` sheet plus chronological detail sheets for selected categories.

#### Scenario: Export multi-sheet workbook with daily summary and selected category detail sheets
- **WHEN** an authenticated User with feeding, sleep, care, health, and growth records requests `GET /api/babies/:babyId/export/xlsx?start=2026-11-21&end=2026-11-23&categories=feeding,sleep,care,health,growth&tz=Asia/Shanghai`
- **THEN** the server responds with HTTP 200, `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Cache-Control: no-store`, and a valid `.xlsx` attachment containing `按日汇总` (3 ordered local date rows with accurate cross-midnight sleep split and category subtotals) plus `喂养明细`, `睡眠明细`, `护理明细`, `健康明细`, and `生长发育明细` scoped strictly to `:babyId`

#### Scenario: Export filtered category subset and sanitize spreadsheet formula prefixes
- **WHEN** an authenticated User with a feeding note starting with `=SUM(A1:A2)` requests `GET /api/babies/:babyId/export/xlsx?days=7&categories=feeding,care&tz=Asia/Shanghai`
- **THEN** the returned `.xlsx` contains only `按日汇总`, `喂养明细`, and `护理明细` (omitting unselected category sheets and columns), and neutralizes the leading formula character in text cells so Excel treats user input strictly as literal text

#### Scenario: Reject invalid export query parameters
- **WHEN** a client requests `GET /api/babies/:babyId/export/xlsx` with an invalid `tz`, invalid or reversed `start`/`end`, date span exceeding 366 days, missing half of `start`/`end`, simultaneous `days` and `start`/`end`, out-of-range `days`, or unknown/empty `categories` token
- **THEN** the server responds with HTTP 400 and a Chinese validation error message
