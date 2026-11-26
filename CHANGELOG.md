# Changelog

本文件记录 BabyLog 面向用户与自部署运维者的可感知变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/)。编写规范与发版流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## [Unreleased]

### Added

- **日常照护与 3 秒单手快录**：完整覆盖喂养（亲喂、瓶喂母乳、配方奶、辅食）、睡眠（小睡与夜觉跨夜切分）、护理（尿布性状颜色、洗澡与自定义护理）及健康（体温、用药、出牙等）记录；提供首页一键直记、移动端单手底部抽屉、时间快捷偏移、常用奶量/亲喂侧别智能默认值回填，以及按本地自然日汇总的分类列表页。
- **生长发育与 WHO 曲线**：支持身高、体重、头围记录管理，并提供结合 WHO 生长参考线的趋势图表，直观追踪宝宝发育轨迹。
- **疫苗接种计划与提醒**：内置国家免疫规划疫苗懒初始化、常见自费疫苗模板与自定义疫苗；支持默认接种门诊、时间线与日历双视图、单剂/批量录入、到期提醒及日历（`.ics`）导出。
- **首页数据看板与护眼工作台**：实时汇总宝宝月龄、距上次喂养/换尿布时长、今日照护概览、近 7/14 日趋势图、全天 5 时段照护节律与近期疫苗提醒；支持浅色暖米白与深夜深色护眼双主题（跟随系统、首屏无闪烁）、桌面端 `⌘K` 快捷命令面板，以及 iOS / Android PWA 主屏幕安装与离线提示。
- **多账号行级隔离与多宝宝档案**：无开放注册入口，支持唯一管理员经 CLI 初始化与救灾重置，并通过 CLI 或 Web 端「用户管理」创建、启停及重置普通家庭账号（支持强制/自助改密）；单个账号可管理最多 10 个宝宝档案并随时切换，跨账号数据行级严格隔离且管理员无法查看他人宝宝与记录。
- **自托管安全基线**：采用加盐 `scrypt` 密码派生与常量时间比较、登录防爆破限流、`HttpOnly; SameSite=Strict` 会话 Cookie（支持 `BABYLOG_COOKIE_SECURE` 适配 HTTPS 反代）、写接口 Same-Origin 校验与脱敏日志，所有业务数据仅存于本地 SQLite（WAL 模式）。
- **零 CGO 单二进制与极简自部署**：后端使用 Go、Gin、GORM 与零 CGO SQLite，并通过 `embed.FS` 内嵌前端产物与 `goose` 启动自动迁移，打包为单二进制；同步提供多架构 GHCR Docker 镜像（`linux/amd64`、`linux/arm64`）、4 平台单二进制压缩包与 `SHA256SUMS.txt`、一键安装/升级脚本（`scripts/install.sh`）及远程 SQLite 合并备份脚本（`scripts/backup.sh`）。官方 `compose.yaml` 默认启用只读根文件系统、15 秒优雅停机宽限期与 `pull_policy: always`，部署 `latest` 时可直接执行 `docker compose up -d --force-recreate --wait` 单命令平滑更新，并通过启动日志或 `babylog version` 核对当前版本。
