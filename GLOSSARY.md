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
A Daily Record tracking body temperature (`℃`), medicine/supplements, **Growth** measurements (`生长`: weight, height, head circumference), or teething notes.
_Avoid_: Medical record

**Growth**:
The Health subtype (`生长`) recording physical measurements (weight, height, head circumference).
_Avoid_: 身高体重 (as a subtype label; use only for individual measurement fields)

### Summaries & Insights

**Daily Summary**:
Per-local-calendar-day aggregate subtotals computed across all records of a category on that date, independent of list pagination boundaries.
_Avoid_: Page total, daily stats

**Smart Defaults**:
Habit-based starter suggestions derived from recent Daily Records (latest and top-3 frequent milk volumes, last breastfeeding side and suggested opposite side, recent solid foods, latest temperature, recent medicines, and recent custom care titles) used to prefill entry forms and one-tap actions.
_Avoid_: Presets, auto-fill cache

**Dashboard Insights**:
Timezone-aware overview combining today's KPI summaries, time-since-last-care indicators, multi-day feeding/sleep trends, and Care Rhythm distribution.
_Avoid_: Analytics, reports

**Care Rhythm**:
The distribution of Daily Records across five ordered local time-of-day slots: `清晨` (05:00–08:59), `上午` (09:00–11:59), `下午` (12:00–17:59), `傍晚` (18:00–20:59), and `夜间` (21:00–04:59).
_Avoid_: Activity heatmap, hourly histogram
