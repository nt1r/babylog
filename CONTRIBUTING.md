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

BabyLog 采用 `dev`（日常开发）+ `main`（稳定发布）双分支模型，由推送到 `main` 分支的语义化版本标签（`vX.Y.Z` 或预发布 `vX.Y.Z-rc.1`）触发 `.github/workflows/release.yml` 自动发版。

### CHANGELOG 编写规范

[CHANGELOG.md](./CHANGELOG.md) 中对应版本的正文会被自动提取为 **GitHub Release 发布说明** 与 `dev -> main` Release PR 正文，日常维护请遵循以下约定：

- **面向使用者与运维者**：只记录用户或自部署运维者可感知的功能、交互、安全与部署变更；纯内部重构、测试拆分、注释整理与 Lint 门禁微调等无感知工程改动无需写入。
- **平时持续记入 `## [Unreleased]`**：随特性或修复 PR 顺手补充到顶部的 `## [Unreleased]` 下，发版时交由 `scripts/release.sh` 自动切分为 `## [X.Y.Z] - YYYY-MM-DD` 并保留新的空 `## [Unreleased]`。
- **按标准分组精简书写**（仅保留本次实际有内容的分组）：
  - `### Added`：新增功能或部署能力（首个正式版可视为面向用户的首发功能总览）
  - `### Changed`：已有功能、接口或部署配置的调整与体验优化（涉及不兼容变更时注明 **Breaking**）
  - `### Fixed`：修复影响线上使用或部署的问题
  - `### Security`：安全加固或漏洞修复
  - `### Deprecated` / `### Removed`：废弃或移除的特性/配置（按需使用）

### 方式一：一键发版脚本（推荐）

先确保目标变更已合入 `dev` 且 [CHANGELOG.md](./CHANGELOG.md) 的 `## [Unreleased]` 已记录本次发布条目，随后运行 [scripts/release.sh](./scripts/release.sh)（需已登录 `gh` CLI）：

```bash
# 1. 先演练校验与预览变更计划（不改仓库、不推远端）
pnpm release 0.1.0 --dry-run

# 2. 正式执行自动发版（要求当前工作区干净；推送准备分支后自动切回原分支）
pnpm release 0.1.0
```

脚本会在当前仓库/worktree 目录直接运行，自动校验 SemVer 格式、工作区干净状态与标签唯一性/单调递增，并按仓库「`dev`/`main` 强制 PR」规则自动串联：
1. 若 `origin/dev` 尚未切出目标版本，则基于 `origin/dev` 在当前目录临时切出 `release/vX.Y.Z`，更新 `package.json` 并将 `CHANGELOG.md` 的 `[Unreleased]` 切出为 `## [X.Y.Z] - YYYY-MM-DD`，提交推送后立即切回原分支并清理本地临时分支，随后提 PR 合入 `dev` 并等待 CI 通过；
2. 创建（或复用）`dev -> main` Release PR，等待 CI 通过后以 merge commit 合入 `main`；
3. 复核 `origin/main` 并推送附注标签 `vX.Y.Z`，实时跟踪 `.github/workflows/release.yml` 直至多架构 GHCR 镜像（含 `:latest`）与 GitHub Release 发布完成。

### 方式二：手动分步发版

1. **在 `dev` 准备版本变更并本地预检**：
   - 更新 `package.json` 中的 `"version"` 字段为目标版本（如 `0.1.0`）；
   - 将 [CHANGELOG.md](./CHANGELOG.md) 中的 `[Unreleased]` 整理为对应的 `## [0.1.0] - YYYY-MM-DD` 章节，并保留新的空 `## [Unreleased]` 供后续迭代使用；
   - 运行发版预检脚本校验版本号、`CHANGELOG.md` 章节与测试门禁：
     ```bash
     pnpm release:check --with-tests
     ```
2. **合并 `dev` 到 `main`**：
   - 创建 `dev -> main` 的 Release PR，等待 CI 全量检查通过后合并。
3. **打标签并触发自动发布**：
   ```bash
   git checkout main
   git pull origin main
   pnpm release:check --tag v0.1.0 --require-main --require-clean
   git tag -a v0.1.0 -m "Release v0.1.0"
   git push origin v0.1.0
   ```
   `release.yml` 会复用 [scripts/release-check.sh](./scripts/release-check.sh) 校验标签位于 `main` 历史内、版本号与 `package.json` 一致并提取 `CHANGELOG.md` 对应章节，随后执行完整 lint / 类型检查 / 单元与竞态测试，构建镜像并执行容器级冒烟校验（版本信息、只读根文件系统启动、健康检查与优雅停机），最后推送多架构 GHCR 镜像（`linux/amd64`、`linux/arm64`；仅正式版本标签会更新 `latest` 与 `vX.Y`）、编译 4 平台单二进制及 `SHA256SUMS.txt` 并创建 GitHub Release。
4. **首次发版的一次性仓库核对与线上更新验证**：
   - 在 GitHub 仓库 Settings 中为 `main` 与 `dev` 开启分支保护（要求 CI 通过、禁止强推）；
   - 首次推送镜像后，在 GitHub Packages 页面确认 `ghcr.io/nt1r/babylog` 的可见性设为 **Public**（否则未登录服务器无法拉取镜像）；
   - 在已部署 `latest` 的服务器上执行 `docker compose up -d --force-recreate --wait` 并通过 `docker compose logs --tail=20 babylog` 确认新版本号已生效。

## AI / Agent 辅助贡献约定

欢迎使用 AI 编码助手参与开发，但提交 PR 前请确保：

- 遵守 [AGENTS.md](./AGENTS.md) 中的架构、shadcn / Base UI、安全与测试约束；
- 改动聚焦于当前目标，不夹带无关重构或无意义格式变更；
- 本地实际执行与本次变更相关的检查命令并确认通过。
