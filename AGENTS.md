# AGENTS.md

本项目人工与 Agent 协作开发的核心边界与导航索引。

## 文档指针（按需读取）

- **新增或修改前后端代码、维护中文注释或代码审查** → 先读 `CODING_STANDARDS.md`
- **架构设计、模块命名或核对业务术语** → 先读 `GLOSSARY.md`
- **调整视觉样式、亮暗主题或分类色 Token** → 先读 `docs/design-system.md`
- **验证前端纯 TS 模块，或新建页面/大幅调整布局后做免登录视觉自查（390px 移动 + 桌面亮暗态无头截屏审图）** → 先读 `docs/temp-verification.md`
- **查看可用脚本与依赖版本** → 以 `package.json`、`backend/go.mod` 与 `tsconfig.json` 为单一事实来源

## 工程硬边界

- 后端根目录为 `backend/`；开发、静态检查、测试与发布全链路保持 `CGO_ENABLED=0`，静态检查覆盖所有构建标签（含 `embedwebui`），开发态与发布态内嵌资源互不污染，开发工具不写入主 `backend/go.mod`。
- 前端包管理器固定为 `pnpm`，依赖版本保持精确固定；新增或修改路由后运行 `pnpm build:web` 重新生成 `src/routeTree.gen.ts` 并纳入版本控制（保证直接运行 `pnpm check`），避免手动编辑。

## 安全与隐私红线

- 禁止将 `data/`、`*.sqlite`、密码文件、`.env` 或任何真实凭据/个人数据写入仓库、测试或日志。
- 所有 SQL 使用参数化查询，禁止拼接用户输入。
- 维持既有安全基线：加盐 `scrypt` 派生与常量时间比较（`subtle.ConstantTimeCompare`）、`HttpOnly; SameSite=Strict` Cookie、Same-Origin 校验、`os.OpenRoot` / `embed.FS` 防路径穿越、请求体大小与 `Content-Type` 限制、脱敏 `log/slog` 输出。

## OpenSpec 与变更工作流

- 新增或修改系统对外行为、接口契约、认证逻辑或数据结构时，按 `openspec/` 流程（`proposal` -> `specs` -> `design` -> `test-plan` -> `tasks`）推进，并保持 `openspec/specs/` 为系统行为的单一事实来源（校验命令：`openspec validate --all --strict`）。
- 涉及后端框架、数据库或整体架构切换等重大工程重构前，先与维护者确认是否需要通过 `openspec/` 留档。
- 纯样式微调、文案修正、工程配置或局部缺陷修复可直接实施，但仍须执行对应验证；若 `openspec/changes/` 存在覆盖相同页面或接口的未归档活动变更，后续交互或布局改版须同轮同步该变更文档。
- 仓库内 `.omp/` 与 `.pi/` 为不同客户端工具的 OpenSpec 目录；调整 OpenSpec 工作流时保持一致，不单边删除。
- 每个 OpenSpec 变更均须生成 `test-plan.md`（编写计划本身不启动实施）；具体编写与任务编排规则见 `openspec/config.yaml`。

## 测试范围与临时验证

- **纳入 Git 管理的自动化测试仅限后端单元测试与集成测试**及其直接需要的 fixture；新增、改写或删除纳入 Git 的测试时，范围以对应 OpenSpec 变更的测试计划或用户明确要求为准。
- **前端、移动端和端到端等其他自动化测试按临时验证执行**：临时脚本、数据、日志和截图必须放在系统临时目录（真实路径在任何 Git 工作区之外，仓库内未跟踪目录或 `.gitignore` 目录不满足要求）；使用隔离数据，不写入常驻脚本/Hook/CI，任务结束时清理。

## 执行与记录

- 只运行本次变更需要的验证，优先复用 `package.json` 现有命令（`pnpm lint`、`pnpm format`、`pnpm check`、`pnpm test`、`pnpm build`），不默认执行全仓测试或完整构建。
- 验证结论如实记录实际执行的命令与观察结果，未验证部分明确说明；PR 保留简短测试与验证说明。
