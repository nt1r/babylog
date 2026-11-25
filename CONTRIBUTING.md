# 贡献指南

感谢你关注并愿意参与 BabyLog 的建设！

## 开发环境准备

运行时版本以仓库根目录的 `.node-version`、`package.json` 中的 `packageManager` 与 `backend/go.mod` 中的 Go 版本为准。

```bash
pnpm install
pnpm admin:init --password-file "$PASSWORD_FILE"
pnpm dev
```

常用校验命令：

- `pnpm lint`：运行全仓静态检查、格式校验与工程门禁（详见 `package.json` 与 `scripts/lint-guardrails.sh`；`pnpm format` 可自动格式化前后端代码）
- `pnpm check`：运行 TypeScript 类型检查（`tsc --noEmit`）
- `pnpm test`：运行 Go 后端单元与集成测试（`CGO_ENABLED=0 go test`）
- `pnpm build`：构建前端生产产物并打包单二进制 `bin/babylog`

## 分支与 PR 流程

1. 默认日常开发分支为 `dev`，请从 `dev` 拉取特性或修复分支，并将 PR 提交到 `dev`（`main` 用于稳定发布）。
2. 涉及系统行为、接口、认证或数据模型变更的功能，建议先按 `openspec/` 规范完成变更提案（`proposal.md`、`specs/`、`design.md`、`test-plan.md`、`tasks.md`）再实施代码。
3. 遵循 [AGENTS.md](./AGENTS.md) 中的测试与验证约束：
   - 纳入 Git 的自动化测试仅限后端单元测试与集成测试；
   - 临时验证程序、日志、截图放在系统临时目录，不写入仓库。
4. PR 描述请填写变更说明及实际执行的验证命令与结果。

## 发版流程（维护者）

BabyLog 采用 `dev`（日常开发）+ `main`（稳定发布）双分支模型，由推送到 `main` 分支的语义化版本标签（`vX.Y.Z` 或预发布 `vX.Y.Z-rc.1`）触发 `.github/workflows/release.yml` 自动发版：

1. **在 `dev` 准备版本变更**：
   - 更新 `package.json` 中的 `"version"` 字段为目标版本（如 `0.1.0`）；
   - 将 [CHANGELOG.md](./CHANGELOG.md) 中的 `[Unreleased]` 整理为对应的 `## [0.1.0] - YYYY-MM-DD` 章节，并保留新的空 `## [Unreleased]` 供后续迭代使用。
2. **合并 `dev` 到 `main`**：
   - 创建 `dev -> main` 的 Release PR，等待 CI 全量检查通过后合并。
3. **打标签并触发自动发布**：
   ```bash
   git checkout main
   git pull origin main
   git tag -a v0.1.0 -m "Release v0.1.0"
   git push origin v0.1.0
   ```
   `release.yml` 会自动校验标签位于 `main` 历史内、版本号与 `package.json` 一致、提取 `CHANGELOG.md` 对应章节作为发布说明，随后执行测试门禁、推送多架构 GHCR 镜像（`linux/amd64`、`linux/arm64`；预发布标签不会覆盖 `latest`）、编译 4 平台单二进制及 `SHA256SUMS.txt` 并创建 GitHub Release。
4. **首次发版的一次性仓库核对**：
   - 在 GitHub 仓库 Settings 中为 `main` 与 `dev` 开启分支保护（要求 CI 通过、禁止强推）；
   - 首次推送镜像后，在 GitHub Packages 页面确认 `ghcr.io/nt1r/babylog` 的可见性设为 **Public**。

## AI / Agent 辅助贡献约定

欢迎使用 AI 编码助手参与开发，但提交 PR 前请确保：

- 遵守 [AGENTS.md](./AGENTS.md) 中的架构、shadcn / Base UI、安全与测试约束；
- 改动聚焦于当前目标，不夹带无关重构或无意义格式变更；
- 本地实际执行与本次变更相关的检查命令并确认通过。
