# BabyLog 测试体系与编写指南

本文档是 BabyLog 测试分层、编写规范、环境隔离、数据生成、中文场景注释模板与 OpenSpec 场景追溯的单一权威指南，适用于常驻后端测试、临时验证及 OpenSpec `test-plan.md`。

## 1. 测试范围与边界

- **纳入 Git 的常驻自动化测试仅限后端 Go 测试**（单元测试、API 集成测试与 CLI 进程测试），直接纳入默认 `pnpm test` 与 CI，运行总耗时控制在数秒内。
- **前端不维护常驻自动化 UI 测试**：UI 视觉与交互验收归维护者手动验证；开发期前端纯 TS 逻辑断言与免登录视觉预览统一在系统临时目录（`$TMPDIR`）执行并立即清理，操作手册见 [temp-verification.md](temp-verification.md)。
- **零第三方测试依赖与零生产代码侵入**：仅使用 Go 标准库 `testing`、`net/http/httptest`、`t.TempDir()` 与项目既有依赖注入能力（`httpapi.Options`、`WithClock`），不向 `backend/go.mod` 引入测试框架，不为测试新增生产抽象或修改生产接口语义。

## 2. 后端测试分层定位（Testing Trophy）

避免在 Store 层与 HTTP 层重复验证同一套业务规则，四类测试各司其职：

| 层级 | 位置 | 职责范围 |
| --- | --- | --- |
| **1. 纯单元测试（无 DB/IO）** | `backend/internal/<domain>/*_test.go` | 高密度输入校验表驱动、时区与跨午夜切分算法、疫苗月龄钳位与 7 态提醒边界、内置目录完整性、环境变量加载、纯累加函数。 |
| **2. 底层持久化/基础设施专项** | `backend/internal/<domain>/store_test.go`（极少量） | 仅覆盖 HTTP 层无法直接表达的底层不变量：SQLite 目录 `0700`/文件 `0600` 权限与 WAL 模式、旧版 Node.js scrypt 哈希兼容、`ReadWindow` 底层窗口边界与多 `babyID` 隔离等。常规 CRUD、筛选与业务流不在此层重复测试。 |
| **3. API 全链路集成测试（核心主力）** | `backend/internal/integration/*_test.go` | 以黑盒 App 视角经真实 `httpapi.NewRouter` + 独立临时 SQLite 验证全部 OpenSpec Given-When-Then 业务流程、跨模块真实使用闭环、并发唯一键、事务原子回滚、权限/建档门禁、安全中间件及落库终态。 |
| **4. CLI 与进程集成测试** | `backend/cmd/babylog/cli_test.go` | 验证真实编译产物的 `admin init`、`serve` 监听、重启持久化与 `SIGTERM` 优雅退出、`version` 输出。 |

## 3. 断言、时间与造数红线

- **从真实业务/使用场景出发**：围绕家长或管理员的真实使用闭环设计用例，用场景生成器准备该场景必需的前置数据，再对关键业务结果、跨模块联动与落库终态做完整查证；不写空洞的“为覆盖率凑数”调用。
- **断言真实可观察结果**：验证 HTTP 状态码、关键响应头/Cookie 属性、JSON 契约字段、具体中文错误语义与持久化终态；不以刚写入的内存结构体作为唯一断言，也不冻结无关动态 ID。
- **写操作必须回读验证落库终态**：测试 `Update`（尤其跨子类型切换清空可空列为 `NULL`）、`Delete`、`BatchUpdate` 事务回滚、会话过期清理时，须通过 API 回读或只读 SQLite 查询核验落库终态。
- **业务前置数据 100% 经真实对外 HTTP API 构造**：使用 `internal/integration` 的 `Scenario` 生成器通过真实 API 建立宝宝档案、日常记录与疫苗上下文；**严禁通过测试 SQL 直接插入业务行伪造上下文**。数据库直接访问仅限两种场景：① `NewTestApp` 初始化默认管理员账号（复用预计算真实 `scrypt` 模板）与默认测试会话（`authStore.CreateSession`）；② 写操作后的**只读落库终态断言**。
- **确定性时间，严禁 `sleep`**：凡涉及跨零点、多日趋势、未来时钟偏移、疫苗 7 态提醒窗口演进与 7 天会话过期的用例，统一使用 `FakeClock`（`WithClock` / `Advance`）注入全部 Store 与 Service，彻底消除宿主机日期依赖与等待抖动；累计 `Advance` 超过 7 天（会话 TTL）后须调用 `app.Relogin()` 按真实流程续期会话。
- **先核对接口与领域契约再写集成断言**：编写或迁移 API 集成测试前，先核对目标 `backend/internal/httpapi/*_handler.go` 及对应领域 `backend/internal/<domain>/{model,validate,catalog}.go` 中的真实 JSON 字段、合法枚举、模板码与错误映射，不凭记忆猜测，也不按底层 Service 内部兜底逻辑推断 HTTP 行为。
- **防错解码与判空防 panic**：响应体反序列化统一使用 `DecodeOK` / `DecodeStatus`（先断言 HTTP 状态码再解包，禁止跳过状态码直接反序列化）；断言解引用可空指针或访问切片末项前须先判空/判长并 `t.Fatalf`；测试底座不提前预留零调用选项或辅助函数（按需引入、及时清理）。
- **禁止源码文本测试**：严禁通过读取源码文本、正则匹配或 AST 特征推断业务逻辑正确性，也不得以读取单个 SQL 迁移文件代替 `database.Open` 真实迁移执行。

## 4. 目录结构、命名规范与阅读顺序

### 4.1 集成测试目录与 OpenSpec 映射

`backend/internal/integration/`（`package integration_test`，仅包含 `*_test.go` 文件，零生产二进制体积开销）遵循统一命名约定：

- **单能力业务场景文件**：`<capability>_test.go` 与 `openspec/specs/<capability>/spec.md` 一一对应（`capability` 连字符转为下划线，如 `baby-profile` → `baby_profile_test.go`）。
- **跨模块真实使用闭环文件**：`cross_module_journeys_test.go`，覆盖跨越认证、宝宝档案、日常记录、首页看板与疫苗管理的端到端用户旅程。
- **共用支撑与基础设施文件**：`harness_test.go`（`FakeClock`、`TestApp`、`AppClient`、泛型只读 SQLite 回读断言）、`scenario_test.go`（纯真实 API 的 `Scenario` 数据生成器）、`security_and_static_test.go`（全局安全中间件与 SPA/路径穿越防护）。
- `scripts/check-spec-refs.mjs` 与 `scripts/check-comments.mjs`（均已接入 `pnpm lint`）自动校验全部 `Spec:` 引用、场景注释模板、步骤编号一致性与集成测试中文注释规范。

### 4.2 用例粒度与阅读顺序

- **单场景单函数**：每个顶层 `func Test...` 对应一个独立完整的业务场景并启用 `t.Parallel()`，独占各自的 `NewTestApp(t, ...)`，用例间严禁共享状态或依赖执行顺序；**不在集成测试顶层函数内用 `t.Run` 拼接多主题巨型聚合用例**，确保每条用例都拥有独立的前置数据清单与 1:1 对应的编号步骤（同类负向输入表驱动可在对应步骤内使用 `for _, tc := range ...`）。
- **统一排列顺序**：同一文件内按 **「正常主流程 → 边界/变体 → 失败/拒绝」** 排列，函数声明顺序与下方索引表保持一致。

### 4.3 集成测试场景索引表（推荐阅读顺序）

| 分组 | 文件与测试函数 | 类别 | 中文场景说明 |
| --- | --- | --- | --- |
| 账号认证 | `auth_test.go` / `TestAuthLoginRestoreAndLogoutClosedLoop` | 正常主流程 | 匿名探测、登录签发安全 Cookie、会话恢复与登出吊销清理 |
| 账号认证 | `auth_test.go` / `TestAuthSessionRotationOnRelogin` | 边界/变体 | 持有效会话重复登录轮换令牌并吊销旧 Cookie |
| 账号认证 | `auth_test.go` / `TestAuthSessionExpirationCleanup` | 边界/变体 | 推进时钟超 7 天后受保护接口 401 清 Cookie 且会话探测清理过期行 |
| 账号认证 | `auth_test.go` / `TestAuthForcedAndSelfServicePasswordChangeClosedLoop` | 正常主流程 | 强制改密门禁 403 `PASSWORD_CHANGE_REQUIRED`、拒同密码、改密放行与自助改密吊销他端会话 |
| 账号认证 | `auth_test.go` / `TestAuthInvalidCredentialsThrottleAndDisabledGuards` | 失败/拒绝 | 错误凭据、停用用户密码通过后 403、连续失败限流 429、未初始化管理员 401 与畸形 Cookie 清除 |
| 用户管理 | `user_management_test.go` / `TestAdminUserManagementLifecycleClosedLoop` | 正常主流程 | 管理员列表零隐私泄露、创建普通用户、重置密码吊销会话、停用即时吊销与重新启用 |
| 用户管理 | `user_management_test.go` / `TestAdminUserManagementRoleAndSelfProtectionGuards` | 失败/拒绝 | 普通用户 403 越权拦截、重复用户名不区分大小写 409、非法入参 400 与管理员自保防停用/重置 |
| 宝宝档案 | `baby_profile_test.go` / `TestBabyProfileOnboardingAndUpdateClosedLoop` | 正常主流程 | 空列表探测、首次与多宝宝建档、允许同户重名、更新刷新 `updated_at` 与清空可选出生体格落库 `NULL` |
| 宝宝档案 | `baby_profile_test.go` / `TestBabyProfileTimezoneTodayBirthDateBoundary` | 边界/变体 | 同一 UTC 时刻按 UTC 与 Asia/Shanghai 校验本地当天出生日及省略出生体格建档 |
| 宝宝档案 | `baby_profile_test.go` / `TestBabyProfileDefaultClinicTriStateUpdate` | 边界/变体 | `default_clinic_name` 裁剪设置、省略保留、超 80 字拒绝与空串清空 |
| 宝宝档案 | `baby_profile_test.go` / `TestBabyProfileHardDeleteCascadeAndCrossUserGuards` | 边界/变体 | 硬删除级联清空 5 张子表与删除最后宝宝、跨账号读写删 404 及管理员不可访问他人宝宝 |
| 宝宝档案 | `baby_profile_test.go` / `TestBabyProfileAuthOnboardingValidationAndLimitGuards` | 失败/拒绝 | 未认证 401、未知宝宝 404、非法入参 400 零脏写与单用户 10 个宝宝上限第 11 个 400 拒绝 |
| 日常记录 | `daily_records_test.go` / `TestFeedingCRUDSubtypeClearingAndNotFound` | 正常主流程 | 四类喂养形态创建、跨子类型切换清零可空列与删除 404 |
| 日常记录 | `daily_records_test.go` / `TestSleepCRUDDurationRecalcAndCrossMidnightList` | 正常主流程 | 睡眠创建算时长、更新重算、删除 404 及跨夜列表交集与双日小计切分 |
| 日常记录 | `daily_records_test.go` / `TestCareCRUDSubtypeClearingAndFilteredList` | 正常主流程 | 尿布/洗澡/其他护理 CRUD、便便改嘘嘘清零列及列表筛选分页与每日小计 |
| 日常记录 | `daily_records_test.go` / `TestHealthAndGrowthCRUDSubtypeClearing` | 正常主流程 | 体温/用药/生长/长牙 CRUD、多方向跨子类型清零废弃列与删除 404 |
| 日常记录 | `daily_records_test.go` / `TestRecordsBatchCreateAtomicityAndSummaryIntegration` | 正常主流程 | 批量补录亲喂/瓶喂母乳/配方奶与合并尿布原子落库，联动验证列表、每日小计、看板与智能默认值 |
| 日常记录 | `daily_records_test.go` / `TestFeedingAndHealthFilteredPaginationSummaries` | 边界/变体 | 喂养跨 UTC 日界线与稀疏跨月分页不截断小计、健康逗号多子类型隔离与非法 token 400 |
| 日常记录 | `daily_records_test.go` / `TestRecordsSmartDefaultsStarterAndEvolution` | 边界/变体 | 空历史冷启动默认值与多品类历史演进（Top-3 奶量破平局、亲喂换侧、辅食/用药去重保最新份量剂量、睡眠中位数、护理去重限 5 条） |
| 日常记录 | `daily_records_test.go` / `TestRecordsAuthOnboardingAndQueryParamGuards` | 失败/拒绝 | 未认证 401、未知/跨宝宝与跨账号 `:babyId` 404、非法列表查询参数/`:id` 400 |
| 日常记录 | `daily_records_test.go` / `TestRecordsFutureClockSkewAndInvalidPayloads` | 失败/拒绝 | 超前 5 分钟未来时间与四大品类非法载荷全部 400 零脏写 |
| 日常记录 | `daily_records_test.go` / `TestRecordsBatchCreateValidationRollbackAndAuthGuards` | 失败/拒绝 | 批量补录鉴权/强制改密/跨宝宝隔离、空批与超限拒绝及混合非法项整事务回滚零脏写 |
| 首页看板 | `dashboard_insights_test.go` / `TestDashboardSummaryTimezoneSplitAndMedicine` | 正常主流程 | 跨 UTC 日界线喂养、跨夜睡眠切分、多条今日用药聚合与跨时区查询对比 |
| 首页看板 | `dashboard_insights_test.go` / `TestDashboardSevenDayTrendsAndCareRhythm` | 正常主流程 | 7 日连续趋势空日零填充、跨夜双日切分、瓶喂与亲喂分列、5 时段全覆盖、窗口起点边界与 `days` 参数校验 |
| 首页看板 | `dashboard_insights_test.go` / `TestDashboardMultiDimensionTrendsAndPeriodSummary` | 正常主流程 | 30 日多维趋势拆解（喂养/睡眠昼夜/排泄/体温用药）与周期洞察摘要（侧别均衡、辅食接受度、睡眠连续性、便便关注与空窗冷启动） |
| 首页看板 | `dashboard_insights_test.go` / `TestDashboardGrowthPartialResolutionAndColdStart` | 边界/变体 | 无记录冷启动全零校验、出生体格兜底与体重/身高/头围跨记录独立解析及出牙统计 |
| 首页看板 | `dashboard_insights_test.go` / `TestDashboardAuthOnboardingAndTimezoneGuards` | 失败/拒绝 | `summary`/`trends` 未认证 401、未知/跨账号 `:babyId` 404 与非法时区 400 |
| 数据导出 | `data_export_test.go` / `TestDataExportMultiSheetXLSXAndSanitization` | 正常主流程 | 自定义区间全五类与子集多 Sheet `.xlsx` 导出、跨夜睡眠汇总、多宝宝严格隔离与公式前缀注入中和 |
| 数据导出 | `data_export_test.go` / `TestDataExportAuthScopeAndQueryParamGuards` | 失败/拒绝 | 导出接口未认证 401、待强制改密 403、未知/跨用户 `:babyId` 404 与非法时区/日期/跨度/分类参数 400 |
| 疫苗管理 | `vaccine_management_test.go` / `TestVaccinesSeedClampingAndSevenAlertStates` | 正常主流程 | 幂等初始化 22 剂 NIP、月末 1/31→2/28 钳位、推进时钟演进 7 态提醒及 `next_focus` 优先级与同日合并 |
| 疫苗管理 | `vaccine_management_test.go` / `TestVaccinesOptionalTemplatesCustomAndDeletion` | 正常主流程 | 默认/定制模板导入、重复 409、`flu` 阶段文案、单剂改月龄契约（自费重算 vs NIP 保护）、删中间剂重排、整套移出及非法/404 拒绝 |
| 疫苗管理 | `vaccine_management_test.go` / `TestVaccinesSingleDoseTransitionsAndValidation` | 正常主流程 | 单剂 `pending → scheduled → completed → pending` 清空废弃列、`recent_clinics` 更新与越界接种日期 400 |
| 疫苗管理 | `vaccine_management_test.go` / `TestVaccinesBatchOperationsAtomicityAndDetailSemantics` | 边界/变体 | 产院两针批量确认不污染默认门诊、批量三态字段保留/清空、批量完成保细节 vs 预约清细节、含非法 ID 整事务回滚 |
| 疫苗管理 | `vaccine_management_test.go` / `TestVaccinesDefaultClinicAndAutoRemember` | 边界/变体 | 常去门诊独立接口（设置/同步/超长 400/清空）、产院不污染 → 首次常规自动记住 → 偶发不覆盖 → 显式置顶覆写 → 批量预约自动记住 |
| 疫苗管理 | `vaccine_management_test.go` / `TestVaccinesConcurrentSeedAndTemplateGuards` | 边界/变体 | 并发首访 NIP 初始化幂等 22 剂、并发重复导入自费模板严格一成 201 一败 409 |
| 疫苗管理 | `vaccine_management_test.go` / `TestVaccinesAuthOnboardingAndTimezoneGuards` | 失败/拒绝 | 疫苗读写端点未认证 401、未知/跨账号 `:babyId` 404 与非法时区 400 |
| 跨模块闭环 | `cross_module_journeys_test.go` / `TestNewParentFirstDayClosedLoop` | 跨模块主流程 | 登录 → 建档 → 首页首访初始化疫苗 → 全天多品类照护 → 看板/趋势/默认值联动 → 预约常规疫苗同步默认门诊 |
| 跨模块闭环 | `cross_module_journeys_test.go` / `TestRecordEditAndDeleteCrossModuleRollback` | 跨模块边界 | 修改/删除发烧体温、删除最新亲喂、删除唯一手工体重后，看板健康观察、出生体格兜底与默认值换侧建议实时回退 |
| 跨模块闭环 | `cross_module_journeys_test.go` / `TestBabyBirthDateCorrectionRecalculatesVaccines` | 跨模块边界 | 更正宝宝出生日期后，未手填 `planned_date` 的待接种疫苗自动按新出生日重算排期与状态，手动 `planned_date` 与已接种剂次不变 |
| 跨模块闭环 | `cross_module_journeys_test.go` / `TestMultiUserMultiBabyFullIsolationJourney` | 跨模块主流程 | 管理员创建普通用户 → 强制改密 → 双娃记录/看板/疫苗严格按 `:babyId` 隔离 → 管理员与用户间零越权 |
| 安全与基础设施 | `security_and_static_test.go` / `TestAPISecurityGuards` | 安全防线 | POST/PUT/DELETE 跨源 403、无 Origin 放行、415、413、未知字段与尾随 JSON 400、405、404 与 Panic 500 恢复 |
| 安全与基础设施 | `security_and_static_test.go` / `TestStaticAssetsAndSPAFallback` | 基础设施 | SPA 回退 `index.html`、PWA manifest/SW/哈希资源缓存策略及路径穿越/符号链接逃逸 404 |
| CLI 与进程 | `cmd/babylog/cli_test.go` / `TestCLIAdminInitSuccessAndDuplicateGuard` | 正常主流程 | 真实二进制 `admin init` 保留密码空格仅裁单个 CRLF、自定义用户名、重复拒绝保留原账号及相对路径默认 `admin` 初始化认证 |
| CLI 与进程 | `cmd/babylog/cli_test.go` / `TestCLIAdminInitInvalidPasswordAndArgsGuards` | 失败/拒绝 | 拒绝过短/超长密码文件、目录路径、非法参数与非法用户名，并验证 SQLite 零管理员落库 |
| CLI 与进程 | `cmd/babylog/cli_test.go` / `TestCLIServeRestartPersistenceLifecycle` | 正常主流程 | 编译产物启动监听、登录建档写入记录、`SIGTERM` 优雅退出并复用同目录重启回读数据完好 |
| CLI 与进程 | `cmd/babylog/cli_test.go` / `TestCLIUserLifecycleAndAdminRecovery` | 正常主流程 | `babylog user create/list/reset-password/disable/enable` 全闭环、支持 `--force-change`、管理员密码恢复与拒绝停用管理员 |
| CLI 与进程 | `cmd/babylog/cli_test.go` / `TestCLIVersionMetadata` | 基础设施 | 验证开发态默认版本输出、非法参数用法提示及 `-ldflags` 注入发布版本元数据 |

## 5. 中文场景注释模板与用例内注释规范

### 5.1 顶层中文场景块注释模板

`backend/internal/integration/` 中的全部业务与安全集成测试用例（排除 `harness_test.go`、`scenario_test.go`）在 `func Test...` 前必须使用如下中文块注释：

```go
/*
 * Spec: <capability> / <Requirement> / <Scenario>
 * 测试场景：一句话概括本次端到端业务场景。
 * 业务背景：从家长/管理员真实使用出发，说明该场景为何发生及要守护的核心不变量。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：小汤圆（2026-07-15，female，出生 3.35kg / 50.2cm）
 * - 前置业务记录：通过 Scenario 准备的记录或疫苗状态（无则写「无」）
 * 测试目标：
 * 1. 验证被测动作的 HTTP 状态码、响应契约或拒绝错误语义。
 * 2. 验证回读 API 或 SQLite 落库终态符合业务规则（拒绝场景写明无脏写/已回滚）。
 */
```

- **多 Scenario 引用**：单个函数覆盖同一 Requirement 下多个关联 Scenario 时，可在 `Spec:` 行用 `;` 分隔或分多行 `Spec:` 列出。
- **无 OpenSpec 基础设施用例**：若集成测试覆盖全局基础设施（如静态资源托管与 SPA 回退），以 `范围：基础设施（无对应 OpenSpec 规格）` 替代 `Spec:` 行，避免触发 `Spec:` 引用校验报错。

### 5.2 测试用例内的中文注释要求

1. **前置造数段**：在验证步骤前准备基础数据时，统一使用普通中文注释（如 `// 前置造数：...`），不占用 `// 1.` 编号。
2. **分段步骤注释与目标严格 1:1 对应**：每个 `测试目标` 编号（`1.`、`2.`…）必须在方法体内有且仅有一条对应的中文分段注释（`// 1. ...`、`// 2. ...`），由 `scripts/check-spec-refs.mjs` 自动校验。
3. **写清“意图与防漏点”而非复述代码**：步骤注释和关键断言注释重点写明业务意图、为什么在此刻查证或排除什么隐患（如跨 UTC 日界线归日、跨子类型清空可空列为 `NULL`、事务回滚零脏写、并发唯一索引保护）。
4. **全中文注释与清晰中文失败提示**：集成测试与 CLI 进程测试内禁止纯英文注释与英文分隔栏（由 `scripts/check-comments.mjs` 自动拦截）；`t.Fatalf`/`t.Errorf` 失败消息优先使用中文业务语义并附带实际观测值，便于排障一眼定位问题环节。
5. **纯单元测试**：保持简洁表驱动命名（中文 `name` 字段与中文 `t.Run` 名称），仅在复杂夹具或非直观边界补充意图注释，不强制套用集成测试块模板。

## 6. 环境隔离与数据清理

- **后端测试**：`NewTestApp(t, ...)` 为每个用例在 `t.TempDir()` 下创建全新目录并执行 `database.Open` 完整迁移，内建路径防呆断言确保数据库位于系统临时目录、绝不触碰项目根目录 `data/`；通过 `t.Cleanup` 按逆序先关闭 `httptest.Server` 再关闭 SQLite 连接，测试结束由 Go 自动递归清理临时目录。
- **前端临时验证**：临时脚本、预览入口与截图必须放在仓库外的 `mktemp -d "${TMPDIR:-/tmp}/babylog-verify.XXXXXX"`，使用 `trap 'rm -rf "$TMP_DIR"' EXIT` 与 `finally` 关闭服务并删除临时工件，不写入仓库、`.gitignore` 目录或 CI。`scripts/lint-guardrails.sh` 会静态拦截 `src/` 下的前端测试文件、`*__temp_preview__*` 及误入源码或 Git 索引的 `*.sqlite*` 文件。

## 7. OpenSpec `test-plan.md` 联动规范

编写 OpenSpec 变更的 `test-plan.md` 与执行 `apply` 验收时遵守：

- **Unit Tests**：仅列出纯计算、校验规则、状态机或底层不变量用例；若本次变更属于常规接口编排或 CRUD，无新增纯算法时写 `None` 并说明原因，不为普通 CRUD 重复新增 `store_test.go`。
- **Integration Tests**：直接映射到 `backend/internal/integration/<capability>_test.go`（或 `cross_module_journeys_test.go`），明确引用的 `capability / requirement / scenario`、使用的 `Scenario` 前置数据、真实 HTTP 请求与落库回读断言。
- **审查核对**：勾选含测试的 task 前，逐条比对 `test-plan.md` 与 `Spec:` 注释及断言实现，确认断言来自真实写入数据而非冷启动兜底值。

## 8. 常用验证命令

```bash
# 运行全部后端单测与集成测试（默认静默输出，无缓存验证可加 -count=1）
pnpm test

# 仅运行后端 API 集成测试（按需传 -v / -run 查看明细）
pnpm test:integration
cd backend && CGO_ENABLED=0 go test -v -run TestAuthLoginRestoreAndLogoutClosedLoop ./internal/integration/...

# 运行集成测试与 CLI 进程测试竞态检测（需本机支持 CGO，CI 默认执行）
pnpm test:race

# 全仓静态检查（含 staticcheck、Spec 引用与模板校验、中文注释门禁与 OpenSpec 校验）与类型检查
pnpm lint && pnpm check

# 可选：启用本地 Git pre-commit 门禁钩子
pnpm hooks:install
```
