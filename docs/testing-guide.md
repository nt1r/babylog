# BabyLog 测试体系与编写指南

本文档是 BabyLog 测试分层、编写规范、环境隔离、数据生成与 OpenSpec 场景追溯的单一权威指南，适用于常驻后端测试、临时验证及 OpenSpec `test-plan.md`。

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
| **3. API 全链路集成测试（核心主力）** | `backend/internal/integration/*_test.go` | 以黑盒 App 视角经真实 `httpapi.NewRouter` + 独立临时 SQLite 验证全部 OpenSpec Given-When-Then 业务流程、跨模块联动、事务原子回滚、权限/建档门禁、安全中间件及落库终态。 |
| **4. CLI 与进程集成测试** | `backend/cmd/babylog/cli_test.go` | 验证真实编译产物的 `admin init`、`serve` 监听与 `SIGTERM` 优雅退出、`version` 输出。 |

## 3. 断言、时间与造数红线

- **断言真实可观察结果**：验证 HTTP 状态码、关键响应头/Cookie 属性、JSON 契约字段、具体中文错误语义与持久化终态；不以刚写入的内存结构体作为唯一断言，也不冻结无关动态 ID。
- **写操作必须回读验证落库终态**：测试 `Update`（尤其跨子类型切换清空可空列为 `NULL`）、`Delete`、`BatchUpdate` 事务回滚、会话过期清理时，须通过 API 回读或只读 SQLite 查询核验落库终态。
- **业务前置数据 100% 经真实对外 HTTP API 构造**：使用 `internal/integration` 的 `Scenario` 生成器通过真实 API 建立宝宝档案、日常记录与疫苗上下文；**严禁通过测试 SQL 直接插入业务行伪造上下文**。数据库直接访问仅限两种场景：① `NewTestApp` 初始化管理员账号；② 写操作后的**只读落库终态断言**。
- **确定性时间，严禁 `sleep`**：凡涉及跨零点、多日趋势、未来时钟偏移、疫苗提醒窗口与 7 天会话过期的用例，统一使用 `FakeClock`（`WithClock` / `Advance`）注入全部 Store 与 Service，彻底消除宿主机日期依赖与等待抖动。
- **先核对 Handler 契约再写集成断言**：编写或迁移 API 集成测试前，先核对目标 `backend/internal/httpapi/*_handler.go` 的真实入参校验与错误映射，不按底层 Service 内部兜底逻辑推断 HTTP 行为。
- **判空防 panic 与克制底座**：测试断言解引用可空指针前须先判空并 `t.Fatalf`；测试底座不提前预留零调用选项或辅助函数（按需引入、及时清理）。
- **禁止源码文本测试**：严禁通过读取源码文本、正则匹配或 AST 特征推断业务逻辑正确性，也不得以读取单个 SQL 迁移文件代替 `database.Open` 真实迁移执行。

## 4. 目录结构、命名规范与用例顺序

### 4.1 集成测试目录与 OpenSpec 映射

`backend/internal/integration/`（`package integration_test`，仅包含 `*_test.go` 文件，零生产二进制体积开销）遵循统一命名约定：

- **业务场景文件**：`<capability>_test.go` 与 `openspec/specs/<capability>/spec.md` 一一对应（`capability` 连字符转为下划线，如 `baby-profile` → `baby_profile_test.go`）。
- **共用支撑与基础设施文件**：`harness_test.go`（`FakeClock`、`TestApp`、`AppClient`、泛型只读 SQLite 回读断言）、`scenario_test.go`（纯真实 API 的 `Scenario` 数据生成器）、`security_and_static_test.go`（全局安全中间件与 SPA/路径穿越防护）。
- `scripts/check-spec-refs.mjs`（已接入 `pnpm lint`）自动校验全部 `Spec:` 注释均精确匹配现存 `openspec/specs/` 中的 Requirement 与 Scenario。

### 4.2 命名与阅读顺序

- 顶层测试函数按业务能力聚合命名（如 `TestAuthSessionLifecycle`、`TestFeedingCRUDAndValidation`、`TestVaccinesBatchAtomicity`），避免数百行多主题混杂的“巨型流水账”函数。
- 同一主题下的用例及 `t.Run(...)` 子测试统一按 **「正常主流程 → 边界/变体 → 失败/拒绝」** 排列。
- 每个独立测试（或需要独立状态的子测试）独占各自的 `NewTestApp(t, ...)` 并启用 `t.Parallel()`，用例间严禁共享状态或依赖执行顺序。

## 5. 中文场景注释模板

`backend/internal/integration/` 中的集成测试用例在 `func Test...` 或关键 `t.Run` 前使用中文块注释标明四项，且 `目标` 编号与方法体内的 `// 1.`、`// 2.` 分段注释一一对应：

```go
/*
 * Spec: <capability> / <Requirement> / <Scenario>
 * 场景：简述本次端到端业务场景。
 * 前置：已登录管理员、宝宝档案参数、通过 Scenario 准备的前置业务记录（无则写「无」）。
 * 目标：
 * 1. 验证被测动作的 HTTP 状态码、响应契约或拒绝错误语义。
 * 2. 验证回读 API 或 SQLite 落库终态符合业务规则（拒绝场景写明无脏写/已回滚）。
 */
```

- 单个函数覆盖同一 Requirement 下多个关联 Scenario 时，可在 `Spec:` 行用 `;` 分隔或分多行 `Spec:` 列出。
- 纯单元测试保持简洁表驱动命名（中文 `name` 字段）即可，不强制套用此模板。

## 6. 环境隔离与数据清理

- **后端测试**：`NewTestApp(t, ...)` 为每个用例在 `t.TempDir()` 下创建全新目录并执行 `database.Open` 完整迁移，内建路径防呆断言确保数据库位于系统临时目录、绝不触碰项目根目录 `data/`；通过 `t.Cleanup` 按逆序先关闭 `httptest.Server` 再关闭 SQLite 连接，测试结束由 Go 自动递归清理临时目录。
- **前端临时验证**：临时脚本、预览入口与截图必须放在仓库外的 `mktemp -d "${TMPDIR:-/tmp}/babylog-verify.XXXXXX"`，使用 `trap 'rm -rf "$TMP_DIR"' EXIT` 与 `finally` 关闭服务并删除临时工件，不写入仓库、`.gitignore` 目录或 CI。`scripts/lint-guardrails.sh` 会静态拦截 `src/` 下的前端测试文件、`*__temp_preview__*` 及误入源码或 Git 索引的 `*.sqlite*` 文件。

## 7. OpenSpec `test-plan.md` 联动规范

编写 OpenSpec 变更的 `test-plan.md` 与执行 `apply` 验收时遵守：

- **Unit Tests**：仅列出纯计算、校验规则、状态机或底层不变量用例；若本次变更属于常规接口编排或 CRUD，无新增纯算法时写 `None` 并说明原因，不为普通 CRUD 重复新增 `store_test.go`。
- **Integration Tests**：直接映射到 `backend/internal/integration/<capability>_test.go`，明确引用的 `capability / requirement / scenario`、使用的 `Scenario` 前置数据、真实 HTTP 请求与落库回读断言。
- **审查核对**：勾选含测试的 task 前，逐条比对 `test-plan.md` 与 `Spec:` 注释及断言实现，确认断言来自真实写入数据而非冷启动兜底值。

## 8. 常用验证命令

```bash
# 运行全部后端单测与集成测试（默认静默输出，无缓存验证可加 -count=1）
pnpm test

# 仅运行后端 API 集成测试（按需传 -v / -run 查看明细）
pnpm test:integration
cd backend && CGO_ENABLED=0 go test -v -run TestAuthSessionLifecycle ./internal/integration/...

# 全仓静态检查（含 staticcheck、Spec 引用校验与 OpenSpec 校验）与类型检查
pnpm lint && pnpm check

# 可选：启用本地 Git pre-commit 门禁钩子
pnpm hooks:install
```
