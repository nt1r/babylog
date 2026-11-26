# Tasks

## 1. 数据库迁移、配置与认证底座

- [x] 1.1 新增 `backend/internal/database/migrations/00005_multi_user_and_multi_baby.sql`（使用 `-- +goose NO TRANSACTION` 执行表重建：迁移 `administrator` → `users` 并建单管理员部分唯一索引 `idx_users_single_admin`、重建 `sessions` 为 `user_id` + 索引、重建 `baby_profiles` 增加 `user_id` 回填与非唯一索引，并在提交前执行 `PRAGMA foreign_key_check`），并在 `backend/internal/database/` 补充 `test-plan.md` 中的 v4→v5 存量迁移、空库迁移及单管理员唯一索引单元测试；运行 `cd backend && CGO_ENABLED=0 go test ./internal/database/...` 验证通过。
- [x] 1.2 在 `backend/internal/config/config.go` 增加可选布尔环境变量 `BABYLOG_COOKIE_SECURE`（默认 `false`），并在 `config_test.go` 补充 `test-plan.md` 中的解析单元测试；运行 `cd backend && CGO_ENABLED=0 go test ./internal/config/...` 验证通过。
- [x] 1.3 重构 `backend/internal/auth/` 支持多用户（`User` / `AuthUser` / `UserSummary`、小写归一化 `username_normalized`、恒定 `scrypt` 耗时与密码通过后检查 `disabled`、会话关联 `user_id` 并过滤 `disabled = 0`、自助改密 `ChangePassword`、管理员用户管理方法、以及无外部依赖的内存 `LoginGuard` 限流与 `scrypt` 并发信号量），并落地 `test-plan.md` 中的 `limiter_test.go` 单元测试；运行 `cd backend && CGO_ENABLED=0 go test ./internal/auth/...` 验证通过。

## 2. 多宝宝存储层、HTTP 鉴权链路与用户管理接口

- [x] 2.1 重构 `backend/internal/baby/` 为强制 `userID` 作用域（`ListByUser`、`GetByIDForUser`、`CreateForUser` 含单用户最多 10 个宝宝校验、`UpdateForUser`、`DeleteForUser` 硬删除、`UpdateDefaultClinic` 校验 `id` 与 `user_id`），确认无遗留无参单例查询；运行 `cd backend && CGO_ENABLED=0 go test ./internal/baby/...` 验证通过。
- [x] 2.2 更新 `backend/internal/httpapi/` 中间件与路由装配：`requireAuthMiddleware` 注入 `*auth.AuthUser`、新增 `requirePasswordChangedMiddleware`（待改密返回 403 `PASSWORD_CHANGE_REQUIRED`）、`requireAdminMiddleware`（非管理员返回 403）、`requireBabyOwnershipMiddleware`（校验 `:babyId` 归属当前用户，不命中返回 404）；新增 `POST /api/auth/change-password`、`/api/admin/users*`、`/api/babies`、`/api/babies/:babyId` 并将 `records` / `dashboard` / `vaccines` 全部迁移至 `/api/babies/:babyId/*`，同时在 `auth_handler.go` 接入 `LoginGuard` 与 `CookieSecure`；运行 `cd backend && CGO_ENABLED=0 go test ./internal/httpapi/...`（编译检查）验证通过。
- [x] 2.3 扩展 `backend/cmd/babylog/`：保持 `admin init` 兼容，新增 `user.go` 实现 `babylog user create | list | reset-password | disable | enable`（严格 `--password-file`、支持 `--force-change`、允许重置唯一 `admin` 密码、拒绝停用 `admin`），并在 `backend/cmd/babylog/cli_test.go` 落地 `test-plan.md` 中的 CLI 全量测试；运行 `cd backend && CGO_ENABLED=0 go test ./cmd/babylog/...` 验证通过。
- [x] 2.4 更新 `backend/internal/integration/` 测试底座（`harness_test.go`、`scenario_test.go`）与既有集成测试至多用户与 `/api/babies/:babyId/*` 契约，并按 `test-plan.md` 落地 `auth_test.go`、`user_management_test.go`、`baby_profile_test.go`、`daily_records_test.go`、`dashboard_insights_test.go`、`vaccine_management_test.go` 与 `cross_module_journeys_test.go` 的全部多用户/多宝宝隔离、越权防护与级联硬删除集成用例；同步更新 `docs/testing-guide.md` 集成测试索引表；运行 `pnpm test` 验证后端全量测试通过。

## 3. 前端多用户、多宝宝切换与管理工作区

- [x] 3.1 升级前端认证与全局客户端状态管理：`src/lib/auth.ts` 与 `src/stores/auth.ts` 适配 `{ id, username, role, must_change_password }` 与 `POST /api/auth/change-password`；新增 `src/stores/baby.ts`（按 `userId` 命名空间持久化 `activeBabyId`，切娃时关闭并重置 `useQuickRecordStore` / `useGrowthRecordStore`）；集中封装 `resetClientSessionState()` 并在登出、401 与登录切号时全量清理 `queryClient` 与抽屉状态；运行 `pnpm check` 确认状态层类型无误。
- [x] 3.2 迁移前端数据请求层与 QueryKey：`src/lib/query-client.ts`、`src/lib/baby.ts`、`src/lib/records.ts`、`src/lib/dashboard.ts`、`src/lib/vaccines.ts` 与相关页面/抽屉全部切换至 `/api/babies` 与 `/api/babies/:babyId/*`，并保证所有宝宝作用域 QueryKey 均包含 `babyId`；运行 `pnpm check` 验证类型一致。
- [x] 3.3 新增并调整前端路由与门禁：新增 `src/routes/change-password.tsx`（全屏强制改密页）与 `src/routes/_app/admin.users.tsx`（仅 `admin` 可访问的用户管理页，普通用户跳 `/dashboard`），更新 `src/routes/_app.tsx`、`src/routes/login.tsx`、`src/routes/onboarding.tsx`（无宝宝时仅拦截育儿业务页，放行 `/settings` 与 `/admin/users`）；运行 `pnpm build:web` 重新生成 `src/routeTree.gen.ts` 并纳入版本控制。
- [x] 3.4 实现多宝宝切换与账号/用户管理 UI：在 `src/components/app-shell/app-sidebar.tsx` 与 `admin-header.tsx` 增加全局宝宝切换器（含「+ 添加宝宝」弹窗）并在 `设置` 导航组按 `user.role === 'admin'` 条件展示「用户管理」入口；在 `src/routes/_app/settings.tsx` 增加多宝宝列表管理（编辑/新增/输入宝宝昵称确认硬删除，删最后一个回 `/onboarding`）与「修改密码」卡片；完成 `/admin/users` 的用户列表（零宝宝/记录统计）、创建用户（支持随机密码生成与一次性复制）、重置密码与启停用交互；按 `docs/temp-verification.md` 在 `$TMPDIR` 完成 390px 移动与桌面亮暗态关键页面视觉自查并清理临时目录。

## 4. 全链路验证与文档同步

- [x] 4.1 核对并同步部署与说明文档（如 `README.md` / `SECURITY.md` 中新增的 `babylog user` 命令与 `BABYLOG_COOKIE_SECURE` 说明），保持与 `GLOSSARY.md` 和 `docs/adr/0003-multi-user-row-isolation-and-explicit-baby-api-scope.md` 一致。
- [x] 4.2 执行全套工程与质量门禁：`pnpm format && pnpm lint && pnpm check && pnpm test && pnpm test:race` 全部通过，确认工作区无残留临时文件或 `.sqlite` 文件。

## Workflow follow-up

- 待所有实现与验证任务完成并通过人工审查后，归档该 OpenSpec 变更以同步更新 `openspec/specs/` 主规格，并复核 `openspec validate --all --strict`。
