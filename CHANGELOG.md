# Changelog

本文件记录 BabyLog 的重要变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

### Added
- 响应式管理员登录界面（基于 React 19、Vite 8、HeroUI v3 与 Tailwind CSS v4）。
- 基于 Node.js 原生 `node:http` 与 `node:sqlite` 的管理员认证与 Cookie 会话服务。
- 管理员 CLI 初始化脚本（`pnpm admin:init`），支持从外部密码文件安全初始化单管理员账号。
- 开源工程化与质量门禁基础设施：Biome 检查、GitHub Actions CI、Dependabot、Issue/PR 模板、`SECURITY.md`、`CONTRIBUTING.md` 及后端单元/集成测试。
- `admin-auth` OpenSpec 基线规格文档与完善后的 `AGENTS.md` 协作规范。
