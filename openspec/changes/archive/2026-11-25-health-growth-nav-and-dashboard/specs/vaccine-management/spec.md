# Spec Delta

## MODIFIED Requirements

### Requirement: Web vaccination workspace, calendar export, and mandatory risk notices
The web application SHALL provide `/vaccines` under the `健康与成长` sidebar group (alongside `/health` and `/growth`) with persistent medical disclaimers, per-dose birth-hospital confirmation, side-by-side calendar (with `.ics` export) and next-focus/progress card, age-stage timeline, and post-vaccination temperature entry. `/dashboard` SHALL surface vaccine alerts and progress via cached `/api/vaccines` independently of the 60-second summary poll.

#### Scenario: Display persistent medical disclaimer and vaccine-specific risks
- **WHEN** an authenticated administrator opens `/vaccines` and inspects any vaccine detail drawer
- **THEN** the page displays a persistent medical disclaimer warning that app schedules are for reference only and must be verified with the official Vaccination Certificate and clinic doctor, and the drawer displays vaccine-specific precautions and risk warnings

#### Scenario: Export booked or planned doses to system calendar
- **WHEN** the parent clicks the calendar export action on the vaccination calendar for an upcoming or scheduled vaccine visit
- **THEN** the application downloads a valid RFC 5545 `.ics` file containing event date/time, clinic location, precautions, risk warnings, and reminder alarms

#### Scenario: Surface vaccine status and trigger lazy NIP initialization from dashboard
- **WHEN** an authenticated administrator with a newly created Baby Profile opens `/dashboard` before visiting `/vaccines`
- **THEN** the dashboard fetches `/api/vaccines` independently of the 60-second summary poll, triggering idempotent NIP schedule seeding and displaying the birth-hospital confirmation or next-focus alert banner and `疫苗接种计划` card linking to `/vaccines`
