# AGENTS.md

以下原则适用于本项目的人工与 Agent 协作开发、测试规划、编写和执行。

## 技术栈与架构边界

- 前端：React 19、Vite 8、TypeScript 7、HeroUI v3（`@heroui/react` + `@heroui/styles`）、Tailwind CSS v4。
- 后端：Node.js LTS（见 `.node-version`），直接使用原生 `node:http`、`node:sqlite`、`node:crypto` 运行 `.ts` 源码，保持零运行时框架依赖；未经明确讨论不引入 Express/Fastify/ORM 等重依赖。
- TypeScript 严格遵守 `tsconfig.json` 中的 `strict`、`erasableSyntaxOnly`、`verbatimModuleSyntax` 与 `allowImportingTsExtensions`（Node 原生类型剥离执行要求）。
- 包管理器固定为 `pnpm`（见 `package.json` 的 `packageManager`），依赖版本按项目既有风格精确固定。

## HeroUI v3 与前端样式约束

- 配色、排版、圆角与业务分类色以 `docs/design-system.md` 和 `src/styles/tokens.css` 为准；业务组件须复用语义 Token（含 `feeding`/`sleep`/`health`/`care` 分类色）与 Tailwind v4 工具类，禁止硬编码十六进制色值或 Tailwind 原始色阶（如 `bg-blue-500`、`text-gray-500`）。
- 仅使用 HeroUI v3 与 Tailwind CSS v4 API；禁止套用 v2/NextUI 的旧模式（如 `NextUIProvider`、`tailwind.config.js`）。
- 在 `src/styles.css` 中按需引入当前实际使用的 `@heroui/styles/components/*.css`，新增组件时同步补充对应样式导入；新页面布局优先使用 Tailwind 语义工具类，避免在 `src/styles.css` 堆积一次性页面样式类。
- 优先使用 HeroUI 语义化设计 Token 与 Tailwind `@layer utilities`；覆写组件样式前须先核对 `node_modules/@heroui/styles` 中的真实选择器、变量与层顺序，避免：
  - 使用低优先级类硬盖 HeroUI 内部状态样式或破坏 `--input-group-bg` 等自动填充变量；
  - 编写匹配不到真实 DOM 结构的死规则（如依赖子元素隐藏 `::after` 伪元素）；
  - 用无条件的 `:root` 亮色规则覆盖 `.dark` / `[data-theme="dark"]` 作用域。
- 中文界面须核对 HeroUI 组件自带的默认英文无障碍文本（如 `Spinner` 默认的 `role="status"` 与 `aria-label="Loading"`），避免嵌套 live region 或中英文混播。

## 安全与隐私红线

- 禁止将 `data/`、`*.sqlite`、密码文件、`.env` 或任何真实凭据/个人数据写入仓库、测试或日志。
- 所有 SQL 必须使用参数化查询，禁止拼接用户输入。
- 认证、会话、文件访问与写操作接口须维持既有安全基线：密码加盐派生与常量时间比较（`timingSafeEqual`）、`HttpOnly; SameSite=Strict` Cookie、Same-Origin 校验、静态文件 `realpath` 防路径穿越、请求体大小与 `Content-Type` 限制。

## OpenSpec 与变更工作流

- 涉及新增或修改系统对外行为、接口契约、认证逻辑或数据结构时，先按 `openspec/` 流程（`proposal` -> `specs` -> `design` -> `test-plan` -> `tasks`）推进，并保持 `openspec/specs/` 为系统行为的单一事实来源。
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
  - 代码规范与格式：`pnpm lint`（自动修复：`pnpm format`）
  - 类型检查：`pnpm check`
  - 后端测试：`pnpm test`
  - 前端构建：`pnpm build`
  - OpenSpec 规格校验：`openspec validate --specs --strict`
- 验证结论描述实际执行的命令和观察到的结果，未验证的部分如实说明。
- PR 保留简短的测试与验证说明即可。
