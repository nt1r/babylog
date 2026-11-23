# AGENTS.md

以下原则适用于本项目的人工与 Agent 协作开发、测试规划、编写和执行。

## 技术栈与架构边界

- 前端：React 19、Vite 8、TypeScript 7、shadcn（`base-nova` 风格）+ `@base-ui/react`、Tailwind CSS v4、TanStack Router / TanStack Query、Zustand、Recharts、`lucide-react`。
- 后端：Go（见 `backend/go.mod`）、Gin、GORM + 纯 Go 零 CGO SQLite 驱动（`github.com/glebarez/sqlite` / `modernc.org/sqlite`）、`goose` 内嵌迁移、`cobra` CLI、`log/slog`、`embed.FS` 静态前端单二进制打包；构建与测试保持 `CGO_ENABLED=0`。
- TypeScript 严格遵守 `tsconfig.json` 中的 `strict`、`erasableSyntaxOnly`、`verbatimModuleSyntax` 与 `allowImportingTsExtensions`。
- 前端包管理器固定为 `pnpm`（见 `package.json` 的 `packageManager`），依赖版本按项目既有风格精确固定；后端模块根目录为 `backend/`。

## shadcn / Base UI 与前端样式约束

- 配色、排版、圆角与业务分类色以 `docs/design-system.md`、`src/styles/tokens.css` 与 `src/styles/globals.css` 为准；业务组件须复用语义 Token（含 `feeding`/`sleep`/`health`/`care` 分类色）与 Tailwind v4 工具类，禁止硬编码十六进制色值或 Tailwind 原始色阶（如 `bg-blue-500`、`text-gray-500`）。
- 基础交互原语统一放在 `src/components/ui/`，基于 `@base-ui/react` 与 `class-variance-authority` 构建（配置见 `components.json`）；页面布局优先使用 Tailwind v4 语义工具类与 `@container` 响应式栅格，避免在全局 CSS 中堆积一次性页面样式类。
- 状态管理边界：TanStack Query 负责服务端业务数据查询与缓存，Zustand 负责认证会话与本地 UI 偏好；`src/routeTree.gen.ts` 由 `@tanstack/router-plugin` 自动生成并纳入版本控制以保证直接运行 `pnpm check`，禁止手动编辑。
- 所有亮/暗双色语义变量在 `src/styles/tokens.css` 中成对维护，亮色覆写限定在 `:root:not(.dark):not([data-theme="dark"]), .light, [data-theme="light"]`，暗色覆写限定在 `.dark, [data-theme="dark"]`，禁止用无条件的 `:root` 亮色规则覆盖暗色作用域。
- 中文界面须确保组件无障碍文本（如 `Spinner` 的 `aria-label`、抽屉/弹窗关闭按钮的 `aria-label`、面包屑 `aria-label`）使用中文，避免嵌套 live region 或中英文混播。
- 列表分页与会话边界：列表翻页须与后端 `limit` 上限对齐，优先使用 TanStack Query `useInfiniteQuery` 按 `offset`/游标递增拉取，禁止通过不断累加 `limit` 代替翻页；全局请求层收到非认证接口 `401` 时须统一清空认证状态与 Query 缓存并退回登录页。
- 表单受控与模块拆分：数字/小数输入框一律以 `string` 受控，仅在步进操作或提交时解析与校验，避免退格删空卡死；异步智能默认值须通过状态守卫仅在「新建态且用户尚未编辑」时回填一次，禁止覆盖用户输入或编辑态；多品类表单按子模块拆分，避免单文件巨型抽屉。

## Go 后端工程原则

- 构建与依赖边界：后端开发、静态检查、测试与发布全链路保持 `CGO_ENABLED=0`；使用条件编译标签时，静态检查须覆盖所有标签，开发态与发布态内嵌资源互不污染，开发工具不写入主 `backend/go.mod` 依赖。
- 配置、路径与持久化：环境变量在入口阶段显式校验，避免非法配置触发 `panic`；跨目录脚本调用的相对路径统一基于调用方工作目录解析；SQLite 连接参数、WAL 配置与 `goose` 迁移保持单一事实来源，不在业务层重复配置。
- 响应与日志边界：HTTP 错误与异常恢复统一返回结构化中文 JSON，CLI 提示保持中文一致；服务端日志统一经 `log/slog` 输出，禁止将原始请求头、Cookie、凭据或个人敏感数据写入日志或 `stderr`。
- 模块边界与中文注释：按职责分层组织 `backend/internal/`，不在路由或组件构造函数中修改包级全局状态；所有 Go 包及关键安全或反直觉设计须提供简明中文注释，说明意图而非复述代码。
- 确定性时钟、前置中间件与持久化一致性：凡依赖 `time.Now()` 做校验或聚合的 Store/Service 均须支持 `WithClock` 注入，集成测试统一使用固定时钟以消除宿主机日期依赖；跨多接口的公共前置检查（如已建档校验）下沉为 Gin 中间件；跨模块同口径统计抽为单一共享函数；GORM 错误判断统一使用 `errors.Is`，读后写更新包入事务。

## 安全与隐私红线

- 禁止将 `data/`、`*.sqlite`、密码文件、`.env` 或任何真实凭据/个人数据写入仓库、测试或日志。
- 所有 SQL 必须使用参数化查询，禁止拼接用户输入。
- 认证、会话、文件访问与写操作接口须维持既有安全基线：密码加盐 `scrypt` 派生与常量时间比较（`subtle.ConstantTimeCompare`）、`HttpOnly; SameSite=Strict` Cookie、Same-Origin 校验、静态文件 `os.OpenRoot` / `embed.FS` 防路径穿越、请求体大小与 `Content-Type` 限制。

## OpenSpec 与变更工作流

- 涉及新增或修改系统对外行为、接口契约、认证逻辑或数据结构时，先按 `openspec/` 流程（`proposal` -> `specs` -> `design` -> `test-plan` -> `tasks`）推进，并保持 `openspec/specs/` 为系统行为的单一事实来源。
- 涉及后端框架、数据库或整体架构切换等重大工程重构时，动工前先与维护者确认是否需要通过 `openspec/` 留档记录。
- 纯样式微调、文案修正、工程配置或局部缺陷修复可直接实施，但仍须执行对应验证。
- 仓库内 `.omp/` 与 `.pi/` 为不同客户端工具的 OpenSpec 命令与技能目录；调整 OpenSpec 工作流时注意保持一致，不随意单边删除。

## 测试范围

纳入 Git 管理的自动化测试仅限后端单元测试与集成测试，以及这些测试直接需要的 fixture。

- 单元测试验证单个模块的确定性逻辑，集成测试验证模块之间或与持久化边界的协作。
- 断言真实可观察结果：返回值、状态变化、持久化终态、错误语义。不用 mock 调用次数、内部结构或源码文本替代行为验证。
- 复用已有测试中仍然有效的覆盖，只补本次变更产生的真实风险；两类测试按实际风险分配，各自覆盖适用的场景。
- 新增、改写或删除纳入 Git 的测试时，范围以对应 OpenSpec 变更的测试计划或用户明确要求为准。

前端、移动端和端到端等其他自动化测试按临时验证约束执行。

## 临时验证

当前任务需要的临时程序、数据装配、运行日志和截图放在系统临时目录，真实路径必须在任何 Git 工作区之外。仓库内未跟踪目录或 `.gitignore` 目录不满足此要求。

- 临时工件不复制回仓库，不写入常驻命令、脚本入口、Git hook 或 CI。
- 临时验证使用隔离的数据与依赖，不连接生产或共享环境，不修改生产接口、配置和业务语义。
- 任务结束时清理临时工件；需要保留的结论写进 PR 的验证说明。

## OpenSpec 变更的测试计划

每个 OpenSpec 变更都生成 `test-plan.md`，记录该变更需要的后端测试范围。编写计划本身不启动测试实施。

- Unit Tests 与 Integration Tests 各列出适用用例，引用对应的 capability、requirement、scenario 名称，写明验证方式和可观察的预期结果。
- 某一类确实没有适用用例时写 `None` 并说明真实原因，例如纯逻辑变更只有单元用例。实现尚未开始不构成不适用。
- 计划可以复用已有测试覆盖，写明复用的用例即可，不要求为每个场景新增代码。
- 用户明确要求实施该变更时，计划中列出的后端测试和必要 fixture 属于实施范围，不再逐项确认。
- `tasks.md` 的测试项引用测试计划，并与对应实现工作放在同一任务组；不在任务中复制计划内容，也不把测试集中到最后一个阶段。

## 执行与记录

- 只运行本次变更需要的验证，优先复用现有命令；不默认执行全仓测试或完整构建。
- 常用项目校验命令：
  - 代码规范与格式：`pnpm lint`（Biome + `go vet`，自动修复：`pnpm format`）
  - 类型检查：`pnpm check`
  - 后端测试：`pnpm test`（`CGO_ENABLED=0 go test -v ./...`）
  - 全量构建：`pnpm build`（前端 `vite build` + 内嵌静态资源的单二进制 `bin/babylog`）
  - OpenSpec 规格校验：`openspec validate --specs --strict`
- 验证结论描述实际执行的命令和观察到的结果，未验证的部分如实说明。
- PR 保留简短的测试与验证说明即可。
