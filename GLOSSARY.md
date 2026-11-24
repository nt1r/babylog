# BabyLog

Single-baby daily care log and growth insights application operated by a family administrator.

## Language

**Administrator**:
The single authenticated parent or caregiver account that signs in to record and view baby care data.
_Avoid_: User, member, tenant

**Baby Profile**:
The single baby identity record (nickname, birth date, gender, and optional birth measurements) that scopes all daily records and computes baby age.
_Avoid_: Child account, patient, baby settings

**Onboarding**:
The mandatory first-time step that creates the Baby Profile before unlocking Daily Records and Dashboard Insights.
_Avoid_: Setup wizard, registration

### Daily Records

**Daily Record**:
A timestamped care entry scoped to the Baby Profile in one of four categories: **Feeding**, **Sleep**, **Care**, or **Health**.
_Avoid_: Log item, event, activity

**Feeding**:
A Daily Record capturing formula milk (`ml`), bottle-fed breast milk (`ml`), direct breastfeeding (side and minutes), or solid food (food name, amount, and acceptance).
_Avoid_: Meal, nutrition

**Sleep**:
A backfilled Daily Record spanning start and end timestamps classified as daytime nap (`白天小睡`) or nighttime sleep (`夜间整觉`), split across local calendar days at midnight for daily totals.
_Avoid_: Rest, sleep session timer

**Care**:
A Daily Record covering diaper changes (pee, poop, or both with optional stool details), baths, or custom care activities.
_Avoid_: Nursing, hygiene

**Health**:
A Daily Record workspace (`/health`, persisted in `health_records`) tracking clinical care events: body temperature (`℃`) and medicine/supplements.
_Avoid_: Medical record

**Growth**:
The physical development and milestone workspace (`/growth`, sharing `health_records` storage with subtypes `growth` and `teeth`) recording physical measurements (`生长`: weight, height, head circumference) and teething milestones (`长牙`).
_Avoid_: 身高体重 (as a subtype label; use only for individual measurement fields)

### Summaries & Insights

**Daily Summary**:
Per-local-calendar-day aggregate subtotals computed across all records of a category on that date, independent of list pagination boundaries.
_Avoid_: Page total, daily stats

**Smart Defaults**:
Habit-based starter suggestions derived from recent Daily Records (latest and top-3 frequent milk volumes, latest breastfeeding mode/duration, last breastfeeding side and suggested opposite side, recent solid foods with portions, median nap and night sleep durations, latest temperature, recent medicines with dosages, and recent custom care titles) plus the Baby Profile's default vaccination clinic (`default_clinic_name`), used to prefill entry forms and one-tap actions.
_Avoid_: Presets, auto-fill cache

**Dashboard Insights**:
Timezone-aware overview combining today's care KPI summaries (including Health Observation for temperature and today's medicine), time-since-last-care indicators, multi-day feeding/sleep trends, Care Rhythm distribution, vaccine attention alerts/progress, and latest growth highlights.
_Avoid_: Analytics, reports

**Care Rhythm**:
The distribution of Daily Records across five ordered local time-of-day slots: `清晨` (05:00–08:59), `上午` (09:00–11:59), `下午` (12:00–17:59), `傍晚` (18:00–20:59), and `夜间` (21:00–04:59).
_Avoid_: Activity heatmap, hourly histogram

### Vaccination

**Vaccination Schedule**:
The per-baby immunization plan anchored to the Baby Profile's `birth_date`, lazily seeded with China's National Immunization Program (NIP) baseline doses and extensible with optional templates or custom doses.
_Avoid_: Vaccine table, immunization calendar (as the data model name)

**Vaccine Dose**:
A single immunization entry (`vaccine_doses`) belonging to the Baby Profile with one of three persisted statuses (`pending`, `scheduled`, `completed`) and a timezone-aware derived reminder state (`upcoming`, `due_soon`, `overdue`, `scheduled`, `scheduled_soon`, `scheduled_overdue`, `completed`).
_Avoid_: Shot, injection log

**NIP Vaccine**:
A National Immunization Program (`nip`, 免疫规划 / 免费) vaccine from the built-in national baseline catalog, seeded automatically and protected from hard deletion.
_Avoid_: Class-1 vaccine (in code identifiers; use `nip`)

**Optional Vaccine**:
A non-NIP (`optional`, 非免疫规划 / 自费) vaccine added on demand from the built-in optional template catalog or as a custom dose.
_Avoid_: Class-2 vaccine (in code identifiers; use `optional`)
