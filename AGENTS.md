# AGENTS.md

本项目人工与 Agent 协作开发的核心边界与导航索引。

## 文档指针（按需读取）

- **代码审查、前端交互/视觉改动、维护中文注释或 Go 跨模块改动** → 先读 `CODING_STANDARDS.md`
- **新增/修改测试或制定 OpenSpec `test-plan.md`** → 先读 `docs/testing-guide.md`
- **架构设计、模块命名、核对业务术语或既有架构权衡** → 先读 `GLOSSARY.md` 与 `docs/adr/`
- **调整视觉样式、亮暗主题或分类色 Token** → 先读 `docs/design-system.md`
- **验证前端纯 TS 逻辑、复杂交互链路，或新建页面/大幅调整布局后做免登录视觉自查（390px 移动 + 桌面亮暗态无头截屏审图）** → 先读 `docs/temp-verification.md`
- **查看可用脚本与依赖版本** → 以 `package.json`、`backend/go.mod` 与 `tsconfig.json` 为单一事实来源

## 工程硬边界

- 后端根目录为 `backend/`；全链路保持 `CGO_ENABLED=0`，开发态与发布态内嵌资源互不污染，开发工具不写入主 `backend/go.mod`。
- 前端包管理器固定为 `pnpm`；若当前 shell 的 `node -v` 与 `.node-version` 不一致，先经本机版本管理器（如 `nvs`）切换；新增或修改路由后运行 `pnpm build:web` 重新生成 `src/routeTree.gen.ts` 并纳入版本控制（保证直接运行 `pnpm check`），避免手动编辑。

## 安全与隐私红线

- 禁止将 `data/`、`*.sqlite`、密码文件、`.env` 或任何真实凭据/个人数据写入仓库、测试或日志。
- 所有 SQL 使用参数化查询，禁止拼接用户输入。
- 维持既有安全基线：加盐 `scrypt` 派生与常量时间比较（`subtle.ConstantTimeCompare`）、`HttpOnly; SameSite=Strict` Cookie、Same-Origin 校验、`os.OpenRoot` / `embed.FS` 防路径穿越、请求体大小与 `Content-Type` 限制、脱敏 `log/slog` 输出。

## OpenSpec 与变更工作流

- 新增或修改系统对外行为、接口契约、认证逻辑或数据结构时，按 `openspec/` 流程（`proposal` -> `specs` -> `design` -> `test-plan` -> `tasks`）推进，并保持 `openspec/specs/` 为系统行为的单一事实来源（`pnpm lint` 已内置 `openspec validate --all --strict`，无需重复串联）。
- 涉及后端框架、数据库或整体架构切换等重大工程重构前，先与维护者确认是否需要通过 `openspec/` 留档。
- 纯样式微调、文案修正、工程配置或局部缺陷修复可直接实施，但仍须执行对应验证；若 `openspec/changes/` 存在覆盖相同页面或接口的未归档活动变更，或 UI 交互/布局改版涉及 `openspec/specs/` 已记录的页面核心区块与强制提示形态，须同轮同步规格或先与维护者确认。
- 仓库内 `.omp/` 与 `.pi/` 为不同客户端工具的 OpenSpec 目录；调整 OpenSpec 工作流时保持一致，不单边删除。
- 每个 OpenSpec 变更均须生成 `test-plan.md`（编写计划本身不启动实施）；具体编写与任务编排规则见 `openspec/config.yaml`。

## 测试范围与临时验证

- 纳入 Git 的常驻测试仅限后端 Go 测试，前端与临时验证统一放系统临时目录（`$TMPDIR`）并在结束时清理。

## 执行与记录

- 只运行本次变更需要的验证，优先复用 `package.json` 现有脚本（有代码修改时先 `pnpm format` 再跑检查），不默认执行全仓测试或完整构建；参考明确的外部公开 GitHub 仓库时，优先通过只读 GitHub API 直取目标文件，减少无效网页搜索。
- 验证结论如实记录实际执行的命令与观察结果，未验证部分明确说明；PR 保留简短测试与验证说明。
