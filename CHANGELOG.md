# Changelog

本文件记录 BabyLog 的重要变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- **后端架构与单二进制打包**：基于 Go、Gin、GORM 与零 CGO SQLite（`glebarez/sqlite` / `modernc.org/sqlite`）实现后端服务，内嵌 `goose` 数据库迁移与 `embed.FS` 静态前端单二进制打包，支持 `babylog serve`、`babylog admin init` 与 `babylog version`（及 `-v`/`--version`）CLI 命令。
- **管理员安全认证**：仅支持经 CLI 从本地密码文件初始化单管理员账户，采用加盐 `scrypt` 派生与常量时间比较、`HttpOnly; SameSite=Strict` Cookie 会话与写接口 Same-Origin 校验。
- **前端工作台与主题体系**：基于 React 19、Vite 8、TypeScript 7、shadcn（`base-nova`）+ `@base-ui/react`、Tailwind CSS v4 与 TanStack Router/Query 构建响应式家庭空间壳层，支持浅色/深色护眼主题、移动端底栏与快捷录入抽屉。
- **宝宝建档、日常记录与数据看板**：支持宝宝建档引导、喂养/睡眠/排便/体温/生长发育等核心日常记录、新建智能默认值回填，以及首页摘要与多日趋势看板图表。
- **PWA 与移动端适配**：提供 Web App Manifest、Service Worker 版本化更新、静态资源分级缓存头与 iOS 安全区适配。
- **发版自动化与自部署体系**：
  - 新增 `.github/workflows/release.yml` 与 `.github/release.yml`，推送 `main` 分支上的 `v*` 标签即可自动发布 GHCR 多架构镜像（`linux/amd64`、`linux/arm64`）与 GitHub Release 跨平台单二进制及 `SHA256SUMS.txt`；
  - 将根目录 `compose.yaml` 调整为面向终端用户的预构建镜像配置，拆出 `compose.build.yaml` 供源码构建与 `scripts/deploy.sh` 使用；
  - 新增服务器端一键安装与平滑升级脚本 `scripts/install.sh` 及远程 SQLite 合并备份脚本 `scripts/backup.sh`。
- **开源工程化基建**：配置 Biome、`go vet`、`tsc` 与 Go 单元/集成测试门禁（GitHub Actions CI）、Dependabot（覆盖 `npm`、`gomod`、`docker`、`github-actions`）、Issue/PR 模板、`SECURITY.md`、`CONTRIBUTING.md` 及 OpenSpec 基线规格文档。
