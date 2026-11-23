# Design

## Context

详见 [proposal.md](./proposal.md) 中的背景与目标。当前技术栈为 React 19 + TanStack Router/Query + Zustand + shadcn Base UI 前端，以及 Go + Gin + GORM + 零 CGO SQLite（`glebarez/sqlite` + `goose` 内嵌迁移）后端。现有路由层（`backend/internal/httpapi/router.go`）已具备 `apiSecurityMiddleware`（`Cache-Control: no-store` 与写请求 `Same-Origin` 校验）和基于 SQLite 的 `babylog_session` Cookie 会话，但尚未提供业务鉴权中间件与任何业务数据表。

## Goals / Non-Goals

**Goals:**
- 建立清晰、类型安全、可演进的 SQLite 分表模型（所有记录表预留 `baby_id`），通过 `goose` 迁移 `00002_core_records.sql` 一次性落库。
- 提供低摩擦的 REST API：统一鉴权与错误语义、精确校验请求体、按本地自然日时区切分聚合与跨夜睡眠、返回历史智能默认值。
- 前端实现强制单宝宝建档、全套减负录入（智能预填 + 相对时间偏移胶囊 + 首页 1-Tap 一键直记与 5 秒撤销 Toast + 列表「再记一笔」）、按自然日分组与每日小计、以及真实看板统计图表。

**Non-Goals:**
- 第 1 期**不做**睡眠/亲喂进行中实时计时器（`ended_at IS NULL` 状态机留待后续按需演进）。
- 第 1 期**不做**多宝宝切换 UI（仅在数据库保留 `baby_id` 外键）。
- 第 1 期**不做**提醒待办持久化（`/reminders` 与抽屉提醒入口保持现有占位提示）、全局混排时间线、Web 修改密码与数据导出（规划在第 2 期）。

## Decisions

### 1. 分表建模而非单一万能 JSON 表
- **决策**：新增 5 张领域表：`baby_profiles`、`feeding_records`、`sleep_records`、`care_records`、`health_records`。
- **表结构要点**：
  - `baby_profiles`: `id` (PK, autoinc), `nickname` (TEXT NOT NULL), `birth_date` (TEXT NOT NULL, `YYYY-MM-DD`), `gender` (TEXT NOT NULL, `male|female|unknown`), `birth_weight_kg` (REAL NULL), `birth_height_cm` (REAL NULL), `created_at` (TEXT NOT NULL, UTC RFC3339), `updated_at` (TEXT NOT NULL, UTC RFC3339)。第 1 期单宝宝策略通过 `CHECK (id = 1)` 或应用层唯一性保证；为平滑扩展多宝宝，**不加 `CHECK (id = 1)`**，由应用层在单宝宝模式下限制创建单条并在所有子表建 `baby_id INTEGER NOT NULL REFERENCES baby_profiles(id) ON DELETE CASCADE`。
  - `feeding_records`: `id`, `baby_id`, `subtype` (`breast|formula|solid`), `feeding_mode` (`direct|bottle` 仅母乳), `breast_side` (`left|right|both` 仅亲喂), `amount_ml` (INTEGER NULL), `duration_min` (INTEGER NULL), `solid_food` (TEXT NULL), `solid_amount` (TEXT NULL), `acceptance` (`like|neutral|dislike` NULL), `recorded_at` (TEXT NOT NULL, UTC RFC3339), `note` (TEXT NOT NULL DEFAULT ''), `created_at`, `updated_at`。索引：`(baby_id, recorded_at DESC)`、`(baby_id, subtype, recorded_at DESC)`。
  - `sleep_records`: `id`, `baby_id`, `subtype` (`nap|night`), `started_at` (TEXT NOT NULL, UTC RFC3339), `ended_at` (TEXT NOT NULL, UTC RFC3339), `duration_min` (INTEGER NOT NULL), `note` (TEXT NOT NULL DEFAULT ''), `created_at`, `updated_at`。索引：`(baby_id, started_at DESC)`、`(baby_id, ended_at DESC)`。
  - `care_records`: `id`, `baby_id`, `subtype` (`diaper|bath|other`), `diaper_kind` (`pee|poop|both` NULL), `stool_consistency` (`watery|soft|formed|hard` NULL), `stool_color` (`yellow|green|brown|abnormal` NULL), `care_title` (TEXT NULL), `recorded_at` (TEXT NOT NULL, UTC RFC3339), `note` (TEXT NOT NULL DEFAULT ''), `created_at`, `updated_at`。索引：`(baby_id, recorded_at DESC)`、`(baby_id, subtype, recorded_at DESC)`。
  - `health_records`: `id`, `baby_id`, `subtype` (`temperature|medicine|growth|teeth`), `temperature_c` (REAL NULL), `medicine_name` (TEXT NULL), `medicine_dosage` (TEXT NULL), `weight_kg` (REAL NULL), `height_cm` (REAL NULL), `head_cm` (REAL NULL), `tooth_note` (TEXT NULL), `recorded_at` (TEXT NOT NULL, UTC RFC3339), `note` (TEXT NOT NULL DEFAULT ''), `created_at`, `updated_at`。索引：`(baby_id, recorded_at DESC)`、`(baby_id, subtype, recorded_at DESC)`。
- **备选方案与权衡**：也曾评估过单表 `records(category, subtype, payload_json)`。但本项目使用 Go + GORM + SQLite，分表能让字段约束、索引、每日奶量求和、最近体温查询、上次亲喂侧别查询完全类型安全且 SQL 极简，避免 JSON 提取函数丧失索引与校验弱化。

### 2. 时间存储、时区解析与跨夜睡眠切分
- **决策**：
  - 数据库所有事件时间戳统一标准化存储为 **UTC RFC3339（精确到秒，`2006-01-02T15:04:05Z`）**，可直接按字典序比较与索引排序。
  - 客户端查询 `/api/records/*` 与 `/api/dashboard/*` 时附带查询参数 `tz`（由浏览器 `Intl.DateTimeFormat().resolvedOptions().timeZone` 提供），缺失时后端默认回落 `Asia/Shanghai`；非法时区返回 `400`。
  - 在 `backend/cmd/babylog/main.go` 与时间处理包显式导入 `_ "time/tzdata"`，确保在极简 Linux 容器或无系统时区数据库的环境中 `time.LoadLocation` 始终可用且零 CGO。
  - **跨夜睡眠切分**：统计某个本地日期窗口 `[dayStart, dayEnd)` 的睡眠时长时，查询所有满足 `started_at < windowEndUTC AND ended_at > windowStartUTC` 的睡眠记录，在 Go 领域逻辑中对每条记录与每个本地自然日 `[dayStart, dayEnd)` 求交集（`min(ended, dayEnd) - max(started, dayStart)`），按分钟累加。这在单家庭数据量下微秒级完成，逻辑无夏令时/跨零点偏差且极易做纯单元测试。
  - **未来时间校验**：写入记录时，校验 `recorded_at`（及睡眠 `ended_at`）不得晚于 `now.UTC().Add(5 * time.Minute)`，允许合理补录历史记录并防止客户端时钟轻微漂移被误杀。

### 3. 统一 API 契约与安全中间件复用
- **决策**：
  - 新增 `requireAuthMiddleware(store *auth.Store)` 挂载到 `/api/baby`、`/api/records/*`、`/api/dashboard/*`；有效会话将 `AdminUser` 注入 Gin Context，无效/过期会话返回 `401`（过期 Cookie 同时清理）。
  - 复用严格的 JSON 请求体解析 helper：校验 `Content-Type: application/json`（415）、限制最大载荷 `64 KiB`（413）、拒绝非法 JSON / 字段类型错误（400），并延续全局 `apiSecurityMiddleware` 的 `no-store` 与写操作 `Same-Origin` 防护。
  - 业务路由设计：
    - `GET /api/baby`、`POST /api/baby`、`PUT /api/baby`
    - `GET /POST /api/records/{feeding,sleep,care,health}`、`PUT /DELETE /api/records/{feeding,sleep,care,health}/:id`
    - `GET /api/records/defaults`
    - `GET /api/dashboard/summary`、`GET /api/dashboard/trends`
- **列表与小计返回结构**：
  - `GET /api/records/:category` 返回 `{ items, total, has_more, daily_summaries }`，其中 `daily_summaries` 按本地日期键 `YYYY-MM-DD` 给出该查询条件下的当日汇总（例如喂养页给 `total_ml`、`formula_count`、`direct_breast_count`、`direct_breast_min`、`solid_count`；睡眠页给 `total_min`、`nap_count`、`night_min`；护理页给 `total_count`、`pee_count`、`poop_count`；健康页给 `total_count`、`latest_temp_c`），保证分页场景下当前展示日期的每日小计仍然准确。

### 4. 智能默认值与低摩擦前端架构
- **决策**：
  - `GET /api/records/defaults` 由后端聚合最近 30 条记录计算：
    - `feeding`: `last_milk_ml`（最近一次配方/瓶喂奶量，无历史默认 `90`）、`frequent_milk_ml`（最多 3 个最常用奶量，不足用 `[60, 90, 120]` 补齐）、`last_feeding_subtype`、`last_breast_side`、`suggested_breast_side`（上次 `left` → 推荐 `right`，上次 `right` → 推荐 `left`，其余默认 `left`）、`recent_solid_foods`（最近去重最多 5 项）。
    - `health`: `last_temperature_c`（无历史默认 `36.6`）、`recent_medicines`（最近去重最多 5 项含最近剂量）。
    - `care`: `recent_other_titles`（最近去重最多 5 项）。
  - **强制建档门禁**：在前端 `/_app` 布局加载 `useBabyProfileQuery()`；若 `baby === null` 且当前不在 `/onboarding`，重定向到 `/onboarding`（简洁 3 项必填表单：昵称、出生日期、性别 + 可折叠选填出生体重/身高）。建档完成后失效缓存并跳转 `/dashboard`。
  - **1-Tap 一键直记与撤销**：首页「快速记录」卡片提供高频一键直记（`嘘嘘`、`便便正常`、`再来一顿 {last_milk_ml} ml`、`洗澡`），点击直接调对应 `POST` 接口，成功后失效 `dashboard`、`records`、`defaults` Query 缓存并弹出带 5 秒「撤销」按钮的 Toast（撤销调用对应 `DELETE` 接口）。
  - **时间快捷偏移**：抽屉默认带出本地当前日期与时间（`YYYY-MM-DD` + `HH:mm`），下方提供 `刚刚 / 15分钟前 / 30分钟前 / 1小时前` 快捷胶囊；睡眠抽屉支持「入睡时间 + 醒来时间」与「快捷时长胶囊（30分 / 1小时 / 1.5小时 / 8小时）」双向联动，且按入睡时段（20:00–05:59 为 `night`，其余为 `nap`）自动默认子类型。

### 5. 后端包职责拆分
- `backend/internal/timeutil`：IANA 时区加载（内嵌 `time/tzdata`）、本地自然日起止计算、跨夜区间按自然日切分、时间段归桶（清晨/上午/下午/傍晚/夜间）。
- `backend/internal/baby`：宝宝档案模型、参数校验与 GORM Store。
- `backend/internal/records`：四大记录模型、结构化校验、CRUD Store、按日小计查询与智能默认值计算。
- `backend/internal/dashboard`：今日 KPI 聚合、跨夜睡眠拆分汇总与近 N 日趋势/节律聚合。
- `backend/internal/httpapi`：`requireAuthMiddleware`、`baby_handler.go`、`records_handler.go`、`dashboard_handler.go` 与统一 JSON 读包/错误响应辅助函数。

## Risks / Trade-offs

- **[单页分页边界与每日小计]** 当单页 `limit=20` 截断某一天的部分记录时，若由前端仅对已加载条目求和会导致当日小计偏小 → **Mitigation**：由后端基于当前筛选条件对返回记录所涉及的本地日期额外计算完整 `daily_summaries` 一并返回。
- **[客户端时区与服务器时钟偏差]** 手机本地时钟可能快于服务器几十秒，若严格拒绝 `> now` 会导致点「刚刚」报错 → **Mitigation**：服务端允许最多 `+5 分钟` 未来容忍窗口。
- **[1-Tap 一键直记误触]** 首页单点即写库可能因单手操作手滑误记 → **Mitigation**：写入接口立即返回新记录 `id`，Toast 提供醒目「撤销」按钮一键 `DELETE` 删除，同时列表页可随时编辑或删除。
- **[SQLite 单连接写锁]** 已在 `database.Open` 配置 `SetMaxOpenConns(1)` 与 WAL + `_txlock=immediate` → **Mitigation**：保持各 Handler 查询短小并全部命中 `(baby_id, recorded_at DESC)` 索引，不引入长事务。

## Migration Plan

1. 新增 `backend/internal/database/migrations/00002_core_records.sql`，通过现有内嵌 `goose` 迁移器在服务启动或测试初始化时自动执行 `Up`。
2. `00002_core_records.sql` 附带完整 `-- +goose Down` 按外键依赖逆序删除 4 张记录表与 `baby_profiles`，支持干净回滚。
3. 既有 `administrator` 与 `sessions` 表不受影响，老数据库升级零停机、无数据破坏。
