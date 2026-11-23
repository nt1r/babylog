# Test Plan

以下测试计划仅覆盖纳入 Git 管理的后端单元测试与集成测试（均在 `CGO_ENABLED=0` 下通过 `go test` 运行）；前端交互与页面表现按临时验证约束在实施阶段另行核验。

## Unit Tests

| Requirement / Scenario | Verification | Expected Result |
| --- | --- | --- |
| `baby-profile` / `Single baby profile creation` / `Reject invalid baby profile input` | 对 `baby` 包输入校验函数传入空昵称、超长昵称（>32 字符）、非法日期、未来出生日期、非法性别、负数或越界出生体重/身高进行表驱动测试 | 每类非法输入均返回明确中文业务错误，合法输入（含前后空白裁剪后的昵称与可选空测量值）通过校验 |
| `daily-records` / `Authenticated access and baby-profile precondition for records` / `Reject future record timestamp beyond clock skew` | 对记录时间校验函数传入过去时间、超前 4 分钟时间与超前 6 分钟时间 | 过去时间与 +4 分钟通过；+6 分钟返回校验错误 |
| `daily-records` / `Feeding record CRUD and structured validation` / `Reject invalid feeding payload` | 对喂养校验函数覆盖 `breast`（`direct` 缺侧别或时长<=0、`bottle` 缺 `amount_ml`）、`formula`（`amount_ml` 越界）、`solid`（空食物名、非法接受度）与合法组合 | 非法组合全部返回中文错误；合法组合标准化后返回正确结构体 |
| `daily-records` / `Sleep record CRUD with backfill validation` / `Create sleep record from start and end times`、`Reject invalid sleep time interval` | 对睡眠校验与时长计算函数测试正常区间、`ended_at <= started_at`、超过 24 小时区间 | 正常区间计算出精确 `duration_min`；逆序、零时长及超过 24 小时均返回错误 |
| `daily-records` / `Care record CRUD and structured validation` / `Reject invalid care payload` | 对护理校验函数覆盖 `diaper`（缺/非法 `diaper_kind`、纯嘘嘘忽略或拒绝便便性状、便便/混合携带合法或非法性状与颜色）、`bath`、`other`（空标题） | 非法输入返回中文错误；合法输入通过 |
| `daily-records` / `Health and growth record CRUD` / `Reject empty growth or medicine record` | 对健康校验函数覆盖体温上下界（34.0–43.0 ℃）、用药空药名、生长三项全空或非正数、长牙空说明 | 越界与缺失必填项返回中文错误；单填体重/身高/头围任一项的生长记录通过 |
| `dashboard-insights` / `Timezone-aware daily KPI summary and recency indicators` / `Split cross-midnight sleep across local natural days`、`Reject invalid IANA timezone parameter` | 对 `timeutil` 时区解析与跨夜睡眠自然日切分函数输入单日、跨零点（22:00→次日 06:00）、跨多日区间以及非法时区名 | 跨零点区间精确切分为前一日 120 分钟与次日 360 分钟；空时区默认 `Asia/Shanghai`；非法时区返回错误 |
| `dashboard-insights` / `Seven-day feeding, sleep, and care rhythm trends` / `Return contiguous 7-day trend series with zero-filled empty days` | 对时段归桶函数测试 `05:00`、`08:59`、`09:00`、`12:00`、`18:00`、`21:00`、`04:59` 边界时刻与 7 天日期序列生成 | 边界时刻准确落入 `清晨/上午/下午/傍晚/夜间` 对应桶；连续日期序列长度为 7 且无缺口 |

## Integration Tests

| Requirement / Scenario | Verification | Expected Result |
| --- | --- | --- |
| `baby-profile` / `Authenticated access to baby profile endpoints` / `Reject unauthenticated baby profile request` | 启动带临时 SQLite 数据库的完整 Gin 路由，未携带有效 Cookie 调用 `GET/POST/PUT /api/baby` | 全部返回 HTTP 401 与中文 JSON 错误信息 |
| `baby-profile` / `Baby profile retrieval and onboarding status` + `Single baby profile creation` + `Baby profile update` / 全场景 | 登录后依次执行 `GET /api/baby`（空）、`PUT /api/baby`（未建档）、`POST /api/baby`（建档）、再次 `POST /api/baby`（重复）、`PUT /api/baby`（更新）并查询 SQLite 持久化终态 | 依次返回 200 `{baby:null}`、404、201、409、200；更新后字段持久化且 `updated_at` 变化 |
| `daily-records` / `Authenticated access and baby-profile precondition for records` / `Reject unauthenticated record request`、`Reject record write before baby onboarding` | 未登录调用 `/api/records/feeding`；登录后未建档调用 `POST /api/records/feeding`；跨源 `Origin` 调用 `POST /api/records/feeding` | 分别返回 HTTP 401、409、403 且数据库无新增行 |
| `daily-records` / `Feeding`、`Sleep`、`Care`、`Health` CRUD 全场景 + `Reject unknown record ID on update or delete` | 建档后对四类记录分别通过 HTTP 接口执行 `POST` 创建、`GET` 查询、`PUT` 修改、`DELETE` 删除及对不存在 ID 执行 `PUT`/`DELETE` | 创建返回 201 含生成 ID，修改返回 200 且落库更新，删除返回 200 且列表不再出现，不存在 ID 返回 404；复用既有测试的 `database.Open` 迁移链路验证 `00002_core_records.sql` 外键与索引生效 |
| `daily-records` / `Filtered, timezone-scoped listing with pagination and daily subtotals` / `Filter feeding records by subtype and date range` | 写入跨多天、多子类型的喂养/睡眠/护理/健康记录，按 `subtype`、`range=today|7d|30d|all`、`tz=Asia/Shanghai`、`limit`、`offset` 分页请求列表 | 返回记录顺序为时间倒序、`total`/`has_more` 准确、跨零点记录按本地自然日归组且 `daily_summaries` 与该日完整记录小计一致（不受分页截断影响） |
| `daily-records` / `Smart defaults endpoint for low-friction entry` / `Compute smart defaults from recent history`、`Return sensible starter defaults when history is empty` | 在无记录时及写入多条配方奶、左右亲喂、辅食、体温、用药记录后分别请求 `GET /api/records/defaults` | 空历史返回合理兜底预设；有历史时准确返回最近奶量、高频前 3 档、上次亲喂侧别与对侧推荐、最近体温及常用药/辅食 |
| `dashboard-insights` / `Authenticated access to dashboard endpoints` + `Timezone-aware daily KPI summary and recency indicators` / 全场景 | 未登录与未建档请求 `/api/dashboard/summary`；建档后写入跨 UTC 日界线的本地凌晨喂养（`00:30+08:00`）、跨夜睡眠（`22:00→次日 06:00+08:00`）、尿布与体温记录，请求 `GET /api/dashboard/summary?tz=Asia/Shanghai` 与非法 `tz` | 未登录 401、未建档 409、非法 `tz` 400；正常请求 200，今日奶量包含本地凌晨喂养、今日睡眠仅计入当日 360 分钟、最近体温与上次喂养/换尿布时间戳准确 |
| `dashboard-insights` / `Seven-day feeding, sleep, and care rhythm trends` / `Return contiguous 7-day trend series with zero-filled empty days`、`Split cross-midnight sleep accurately across consecutive trend days` | 在最近 7 个本地日中仅两天写入含跨夜睡眠与多时段照护记录的数据，调用 `GET /api/dashboard/trends?days=7&tz=Asia/Shanghai` | 返回 HTTP 200，包含 7 个连续本地日期桶（空日补 0，跨夜睡眠准确拆分到相邻两天 `2.0h` 与 `6.0h`）及 5 个按顺序排列的时段照护频次桶 |
