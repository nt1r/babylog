# 贡献指南

感谢你关注并愿意参与 BabyLog 的建设！

## 开发环境准备

运行时版本以仓库根目录的 `.node-version` 与 `package.json` 中的 `packageManager` 为准。

```bash
pnpm install
pnpm admin:init --password-file "$PASSWORD_FILE"
pnpm dev
```

常用校验命令：

- `pnpm lint`：运行 Biome 代码规范与格式检查（`pnpm format` 可自动格式化）
- `pnpm check`：运行 TypeScript 类型检查（`tsc --noEmit`）
- `pnpm test`：运行后端单元与集成测试（`node --test`）
- `pnpm build`：构建前端生产产物

## 分支与 PR 流程

1. 默认日常开发分支为 `dev`，请从 `dev` 拉取特性或修复分支，并将 PR 提交到 `dev`（`main` 用于稳定发布）。
2. 涉及系统行为、接口、认证或数据模型变更的功能，建议先按 `openspec/` 规范完成变更提案（`proposal.md`、`specs/`、`design.md`、`test-plan.md`、`tasks.md`）再实施代码。
3. 遵循 [AGENTS.md](./AGENTS.md) 中的测试与验证约束：
   - 纳入 Git 的自动化测试仅限后端单元测试与集成测试；
   - 临时验证程序、日志、截图放在系统临时目录，不写入仓库。
4. PR 描述请填写变更说明及实际执行的验证命令与结果。

## AI / Agent 辅助贡献约定

欢迎使用 AI 编码助手参与开发，但提交 PR 前请确保：

- 遵守 [AGENTS.md](./AGENTS.md) 中的架构、shadcn / Base UI、安全与测试约束；
- 改动聚焦于当前目标，不夹带无关重构或无意义格式变更；
- 本地实际执行与本次变更相关的检查命令并确认通过。
