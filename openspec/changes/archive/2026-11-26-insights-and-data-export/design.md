# Design: Multi-Dimension Insights, Chart Image Export, and Excel Export

## Context

See [proposal.md](./proposal.md) for product motivation. Today, BabyLog stores rich structured daily records in SQLite (`feeding_records`, `sleep_records`, `care_records`, `health_records`) and exposes `GET /api/babies/:babyId/dashboard/trends?days=<1..90>&tz=<IANA>`, which already accepts up to 90 days on the backend but only aggregates `feeding_ml`, `direct_breast_min`, `direct_breast_count`, and `sleep_hours` while the Dashboard UI hardcodes `days=7`. Meanwhile, `/dashboard` serves as a dense daily operational cockpit (Hero, vaccine alert banner, one-tap tiles, today KPIs, 2:1 trends, vaccine/growth cards), and `/growth` already renders WHO P3–P97 curves in `GrowthTrendCard`.

Key project constraints:
- Go backend must remain `CGO_ENABLED=0` with minimal binary footprint and strict per-baby ownership isolation (`requireBabyOwnershipMiddleware`).
- Frontend uses Tailwind v4 OKLCH semantic tokens (`--card`, `--foreground`, `--feeding`, `--sleep`, `--care`, `--health`, `--primary`) with light/dark themes, Recharts 3, and pinned exact dependency versions in `package.json`.
- Zero database schema changes are needed because every requested dimension already exists in the current tables.

## Goals / Non-Goals

### Goals
- Provide a dedicated `/insights` (`统计分析`) workspace under `成长概览` for deep multi-day exploration (`7 / 14 / 30 / 90` days) while keeping `/dashboard` lightweight (adding only a `7 天 / 30 天` quick switcher and a direct link to `/insights`).
- Extend `GET /api/babies/:babyId/dashboard/trends` backward-compatibly with granular feeding, sleep, care, and health daily breakdowns plus a `period_summary` for metrics that cannot be reconstructed from daily totals alone (side balance, solid acceptance, longest night sleep, average nap length, stool observation flags, and recorded active days).
- Implement `GET /api/babies/:babyId/export/xlsx` using a zero-dependency Go stdlib OOXML writer (`archive/zip` + `encoding/xml`) with strict query validation, local-timezone formatting, multi-sheet structure (`按日汇总` + selected category detail sheets), and formula-injection sanitization.
- Implement zero-dependency client-side PNG chart image export (resolving OKLCH CSS tokens cleanly for both light and dark modes) shared by `/insights` chart cards and `/growth`'s `GrowthTrendCard`, plus concise phase-growth delta hints on `/growth`.

### Non-Goals
- No custom date-range picker inside `/insights` interactive charts (preset `7 / 14 / 30 / 90` days keep chart tick density predictable; custom `start`/`end` dates up to 366 days are supported in Excel export).
- No PDF report generation, scheduled email reports, or cloud share links (local `.xlsx` and `.png` downloads fit BabyLog's self-hosted privacy-first model).
- No database schema migrations or new recording form fields.
- No changes to the 5-slot mobile bottom navigation bar (`MOBILE_NAV_ITEMS` remains `看板 / 喂养 / 睡眠 / 护理` + center `+`; `/insights` is reachable via mobile sidebar drawer, Dashboard trend header link, and Command Palette).

## Decisions

### 1. Backward-Compatible Extension of `/api/babies/:babyId/dashboard/trends`
- **Alternative considered**: Introducing a separate `/api/babies/:babyId/insights` endpoint that re-queries the exact same `ReadWindow` snapshot. Rejected because `/dashboard/trends` already loads all 4 record tables via `store.ReadWindow(ctx, babyID, windowStart, todayEnd)` for `1..90` days; extending its response in place avoids duplicate SQL queries, lets TanStack Query share cache between `/dashboard` (`days=7` / `days=30`) and `/insights`, and stays 100% backward-compatible for existing fields.
- **Single source of truth for feeding breakdown**: Extend `records.FeedingDailySummary` (and `records.AccumulateFeedingSummary`) with additive fields:
  - `FormulaML int` (`formula_ml`), `FormulaCount int` (`formula_count`)
  - `BottleBreastML int` (`bottle_breast_ml`), `BottleBreastCount int` (`bottle_breast_count`)
  - Existing `TotalML` remains `FormulaML + BottleBreastML`.
- **Extended `DailyTrendPoint` fields** (all existing fields preserved verbatim):
  - Feeding: `formula_ml`, `formula_count`, `bottle_breast_ml`, `bottle_breast_count`, `solid_count`, `feeding_count`
  - Sleep: `nap_hours`, `night_hours`, `nap_count` (derived from `records.SummarizeSleepByLocalDay`, where `nap_min = total_min - night_min`, each rounded to 0.1h)
  - Care: `pee_count`, `poop_count`, `bath_count` (from `records.AccumulateCareSummary`, preserving `both` = +1 pee & +1 poop)
  - Health: `max_temp_c` (`*float64`, `null` when no temperature recorded on that local day), `medicine_count` (`int`)
- **Added `PeriodTrendSummary` (`period_summary` on `TrendsResponse`)**:
  ```go
  type PeriodTrendSummary struct {
      ActiveDays      PeriodActiveDays      `json:"active_days"`
      BreastSide      BreastSideSummary     `json:"breast_side"`
      SolidAcceptance SolidAcceptanceSummary `json:"solid_acceptance"`
      Sleep           PeriodSleepSummary    `json:"sleep"`
      Stool           PeriodStoolSummary    `json:"stool"`
  }
  ```
  - `ActiveDays`: `{ feeding_days, sleep_days, care_days }` — counts of local days in the window with `feeding_count > 0`, `sleep_hours > 0`, or `(pee_count + poop_count + bath_count) > 0`. Allows the UI to display honest **有记录日均** (recorded-day average) alongside total counts so forgotten/unlogged days do not distort averages.
  - `BreastSide`: `{ left_count, right_count, both_count }` across direct breastfeeding records in `[windowStart, todayEnd)`.
  - `SolidAcceptance`: `{ like_count, neutral_count, dislike_count }` across solid food records in `[windowStart, todayEnd)`.
  - `Sleep`: `{ longest_night_min, avg_nap_min }` computed from `sleep_records` whose `started_at` falls in `[windowStart, todayEnd)` (`longest_night_min` = max `duration_min` of `night` sleeps; `avg_nap_min` = rounded mean `duration_min` of `nap` sleeps, `0` when none). Consistent with `daySlotLabel` window-start semantics so sleep sessions started before the window do not skew the period summary.
  - `Stool`: `{ total_poop_count, watery_count, hard_count, abnormal_color_count }` across `diaper` records with `poop`/`both` in `[windowStart, todayEnd)` (`stool_consistency == "watery"`, `"hard"`, `stool_color == "abnormal"`).

### 2. Zero-Dependency Go OOXML `.xlsx` Export (`backend/internal/export`)
- **Alternative considered A**: Adding `github.com/xuri/excelize/v2` to `backend/go.mod`. Rejected because it pulls ~10 transitive dependencies and adds >10 MB to the single-binary release for simple tabular exports.
- **Alternative considered B**: Client-side `xlsx`/`exceljs` generation. Rejected because it inflates frontend bundle size, hits `MaxListLimit=100` pagination caps on long ranges (requiring N paginated requests), and duplicates daily-summary aggregation logic in TypeScript.
- **Chosen design**: Dedicated `backend/internal/export` package using Go stdlib `archive/zip` + `encoding/xml` (~250 lines for minimal compliant SpreadsheetML):
  - Generates `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/styles.xml` (default font + bold tinted header row style), and `xl/worksheets/sheetN.xml` (inline strings `<c t="inlineStr"><is><t>...</t></is></c>` + numeric cells `<c t="n"><v>...</v></c>`, frozen header row `<sheetView><pane ySplit="1" state="frozen"/></sheetView>`, and sensible column width hints).
  - **Formula injection sanitization**: Any string cell whose trimmed or raw first rune is `=`, `+`, `-`, `@`, `\t`, or `\r` is prefixed with a leading single quote `'` before XML escaping, preventing spreadsheet formula execution if opened in Excel/WPS/Numbers.
  - **Query contract (`GET /api/babies/:babyId/export/xlsx`)**:
    - `tz`: optional IANA timezone (default `Asia/Shanghai`).
    - Date bounds: either `start=YYYY-MM-DD&end=YYYY-MM-DD` (inclusive, `start <= end`, span `<= 366` days) OR `days=<1..366>` (default `30` when neither is supplied). Supplying both `days` and `start`/`end`, supplying only one of `start`/`end`, invalid format, reversed range, or span `> 366` returns HTTP 400 with a Chinese message.
    - `categories`: optional comma-separated subset of `feeding,sleep,care,health,growth` (deduplicated, default all 5). Unknown or blank token returns HTTP 400.
    - Data fetch: Reuses `records.Store.ReadWindow(ctx, babyID, windowStart, windowEnd)` (already parameterized SQLite queries scoped strictly to `baby_id`), sorting detail records chronologically ascending (`recorded_at ASC, id ASC` / `started_at ASC, id ASC`) in memory or via deterministic sort before writing sheets.
    - Note on `health` vs `growth`: Both live in `health_records` (see ADR-0001). Export filters `temperature`/`medicine` into `健康明细` (when `health` selected) and `growth`/`teeth` into `生长发育明细` (when `growth` selected), matching BabyLog's domain separation.
    - Response headers: `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Cache-Control: no-store`, RFC 5987 `Content-Disposition: attachment; filename="babylog-export-YYYYMMDD-YYYYMMDD.xlsx"; filename*=UTF-8''<url-encoded-nickname-and-range>.xlsx` (sanitizing nickname control chars/path separators).

### 3. Frontend Information Architecture: Dedicated `/insights` + Lightweight `/dashboard`
- **Navigation (`src/navigation/menu.ts`)**:
  - Under `成长概览`: `/dashboard` (`首页看板`) + `/insights` (`统计分析`, `BarChart3` icon).
  - Also registered in Command Palette (`页面导航` + `导出数据 (Excel)` quick action).
- **Dashboard (`/dashboard`)**:
  - Upgrade the trend card header with a compact `7天 / 30天` segmented toggle (persisted only in component state, defaulting to `7` so initial load stays crisp) and a subtle `详细分析 →` link to `/insights`.
  - Keep existing feeding/sleep area chart + Care Rhythm bar chart concise so `/dashboard` remains fast to scan.
- **Insights (`/insights`) layout** (mobile-first, `@container/main` responsive grid, following `docs/design-system.md`):
  1. **Header toolbar**: Page title (`统计分析`), `SegmentedControl` for `近 7 天 / 近 14 天 / 近 30 天 / 近 90 天`, and `导出 Excel` button (opens `ExportExcelDrawer`).
  2. **Period summary strip (4 compact KPI cards)**: 日均奶量/亲喂 (based on `feeding_days`), 日均睡眠 + 最长夜觉 (based on `sleep_days`), 日均嘘嘘/便便 (based on `care_days`), and 当前筛选周期天数与有效记录天提示 (with `InfoPopover` explaining "有记录日均"口径).
  3. **Feeding section (2-card or tabbed deep card)**:
     - **奶量结构与喂养次数**: Switchable tabs inside the card:
       - `奶量结构`: Stacked `BarChart` (`配方奶 ml` + `瓶喂母乳 ml`) with daily total in tooltip.
       - `亲喂时长`: `AreaChart` (`direct_breast_min`) + tooltip showing `direct_breast_count`, plus compact side-balance bar (`左侧 / 右侧 / 双侧` from `period_summary.breast_side`) when direct feeds exist.
       - `喂养次数`: Stacked `BarChart` (`配方奶`, `瓶喂母乳`, `亲喂`, `辅食` counts); when `solid_count > 0`, displays a compact footer pill strip for `辅食接受度` (`喜欢 / 一般 / 抗拒`).
  4. **Sleep & Care row (2-column on desktop `@4xl/main:grid-cols-2`, stacked on mobile)**:
     - **睡眠昼夜趋势**: Stacked `BarChart` (`夜间睡眠 h` + `白天小睡 h`) with tooltip showing total hours + nap count, and header/footer continuity summary (`最长夜觉` · `平均小睡`).
     - **排泄趋势（嘘嘘 / 便便）**: Grouped or dual-series `BarChart` (`嘘嘘次数` + `便便次数`); when `watery_count`, `hard_count`, or `abnormal_color_count` > 0, renders a calm compact notice pill summarizing the period's stool observation counts for medical reference.
  5. **Health & Care Rhythm row**:
     - **体温与用药观察** (rendered prominently when any day in the window has `max_temp_c != null` or `medicine_count > 0`, otherwise collapsed into a compact empty/quiet card): `ComposedChart` with `max_temp_c` line + `ReferenceLine` at `37.3℃` (warning) and `38.5℃` (destructive) + daily `medicine_count` in tooltip.
     - **照护时段节律**: Reuses the 5-slot `BarChart` across the selected `days` window.
  - **Dense X-axis ticks (`30d` / `90d`)**: Compute `interval="preserveStartEnd"` or explicit `minTickGap={24}` on X-axis so 30/90 daily bars remain legible on both 390px mobile and desktop viewports.

### 4. OKLCH-Safe Chart Image Export (`src/lib/chart-export.ts`) & Growth Deltas
- **Alternative considered**: `html2canvas` / `dom-to-image`. Rejected because Tailwind v4 OKLCH color functions (`oklch(...)`) frequently fail CSS parsing in DOM-to-canvas libraries, and adding dependencies increases bundle size.
- **Chosen design**: Pure browser SVG → Canvas 2D renderer:
  1. Locate the `<svg>` inside the chart card ref (`container.querySelector('.recharts-wrapper svg')`).
  2. Deep-clone the SVG, walk elements to resolve `var(--...)` references via `getComputedStyle(root)` and convert any CSS color string (including `oklch(...)`) through an offscreen 1x1 canvas context (`ctx.fillStyle = value` or `getComputedStyle` on a temporary probe element where Chrome/Safari/Firefox return computed `rgb(...)`/`oklch(...)` that Canvas 2D natively paints). Ensure `<linearGradient>` stops, `stroke`, `fill`, and `<text>` `fill`/`font-family` are inlined explicitly onto the cloned SVG attributes so standalone SVG serialization via `XMLSerializer` is self-contained.
  3. Load serialized SVG into an `Image` (`data:image/svg+xml;charset=utf-8,...`), draw onto a 2x-scaled `<canvas>` with:
     - Solid `--card` background + subtle rounded border.
     - Header: chart title, baby nickname + age label, range subtitle (e.g., `2026-10-28 至 2026-11-26 · 近 30 天`), and inline legend dots/labels.
     - Rasterized chart SVG + optional one-line summary footer (`BabyLog · 导出于 YYYY-MM-DD`).
  4. Export via `canvas.toBlob('image/png')` and trigger browser file download (`<宝宝昵称>-<图表名>-<日期>.png`).
- **Growth delta hints (`src/lib/growth-chart.ts` & `src/routes/_app/growth.tsx`)**:
  - Add pure helper `computeGrowthDeltas(metric, series)` returning `deltaFromPrev` (value diff + interval days/months) and `deltaFromBirth` (when birth baseline exists and at least one post-birth measurement exists).
  - Display concisely inside `GrowthTrendCard`'s summary strip alongside the existing WHO status badge and new `保存图片` button.

### 5. Excel Export Drawer (`src/components/insights/export-excel-drawer.tsx`)
- Reuses `EntityDrawer` (desktop right drawer / mobile bottom drawer with `data-base-ui-swipe-ignore` on scrollable body), `SegmentedControl` (preset `近 7 天 / 近 14 天 / 近 30 天 / 近 90 天 / 自定义`), `DatePicker` (for custom `start` and `end`, `maxDate = today`), and `Checkbox` (for `喂养 / 睡眠 / 护理 / 健康观察 / 生长发育`, all checked by default).
- Client-side guard disables submit or shows clear Chinese validation error if zero categories are checked, dates are missing/reversed, or span > 366 days.
- Downloads via authenticated `fetch` (`credentials: 'include'`), inspects non-2xx JSON `{ error }` for Chinese error toasts, parses `Content-Disposition` filename (with clean fallback), and triggers blob download cleanly without opening blank tabs.

## Risks / Trade-offs

- **[Risk] Excel compatibility across Microsoft Excel, Apple Numbers, WPS, and LibreOffice with a custom OOXML writer** → Mitigation: Emit minimal spec-compliant OOXML (`xl/styles.xml` with standard numFmts, `t="inlineStr"` avoiding shared-strings index bugs, proper XML 1.0 character sanitization stripping illegal control chars `0x00–0x08/0x0B/0x0C/0x0E–0x1F`, valid `dimension` and cell refs like `A1..AA99`), and add comprehensive Go unit tests that unpack the generated ZIP and validate every XML part and cell structure.
- **[Risk] OKLCH color serialization inside standalone SVG data URLs in older Safari/WebView** → Mitigation: Normalize resolved CSS colors through a tiny 1x1 canvas pixel readback helper (`cssColorToRgba`) when serializing SVG attributes, guaranteeing standard `rgba(r, g, b, a)` values inside the standalone SVG across all browsers.
- **[Risk] Large 366-day export query memory usage** → Mitigation: A single baby's 1-year daily log is typically ~5,000–10,000 rows (~2–4 MB in memory), well within single-node server budgets; enforcing the hard 366-day span limit prevents unbounded queries.
- **[Risk] 90-day stacked bar charts becoming visually cramped on 390px mobile** → Mitigation: Configure responsive `minTickGap` / `interval` on `XAxis`, hide bar corner rounding on dense `>=60d` series if needed, and keep full daily breakdown accessible via tap/hover tooltip.
