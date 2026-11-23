# Tasks

## 1. 数据库迁移、时区工具与鉴权中间件基础

- [x] 1.1 新增内嵌迁移 `backend/internal/database/migrations/00002_core_records.sql`，创建 `baby_profiles`、`feeding_records`、`sleep_records`、`care_records`、`health_records` 五张表及索引（含 `Down` 回滚脚本），并通过 `CGO_ENABLED=0 go test ./internal/database/...` 或临时库迁移验证表结构与外键约束生效
- [x] 1.2 实现 `backend/internal/timeutil` 包（导入 `_ "time/tzdata"`，提供 IANA 时区解析、默认 `Asia/Shanghai`、本地自然日范围、跨夜睡眠按自然日切分、5 时段归桶），并按 `test-plan.md` 补充对应单元测试，运行 `CGO_ENABLED=0 go test -v ./internal/timeutil/...` 验证全部通过
- [x] 1.3 在 `backend/internal/httpapi` 中新增 `requireAuthMiddleware` 与通用严格 JSON 读包/错误响应辅助函数，确保受保护业务路由统一校验会话、Content-Type 与请求体大小，并通过对应认证拒绝集成测试验证返回 `401/413/415`

## 2. 宝宝档案模块（baby-profile）

- [x] 2.1 实现 `backend/internal/baby` 包（`BabyProfile` 模型、字段校验、`Get/Create/Update` Store 逻辑，限制第 1 期单宝宝创建并保留 `baby_id` 外键能力），并按 `test-plan.md` 补充 `baby` 单元测试，运行 `CGO_ENABLED=0 go test -v ./internal/baby/...` 验证通过
- [x] 2.2 在 `backend/internal/httpapi` 中实现 `GET/POST/PUT /api/baby` 路由与处理器，并按 `test-plan.md` 补充宝宝档案相关 HTTP 集成测试，运行 `CGO_ENABLED=0 go test -v ./internal/httpapi/...` 验证通过

## 3. 四大日常记录与智能默认值模块（daily-records）

- [x] 3.1 实现 `backend/internal/records` 包的喂养、睡眠、护理、健康领域模型与结构化校验（含未来时间 `+5 分钟` 容忍、睡眠区间与 `duration_min` 自动计算），并按 `test-plan.md` 补充四类记录的校验单元测试，运行 `CGO_ENABLED=0 go test -v ./internal/records/...` 验证通过
- [x] 3.2 实现 `backend/internal/records` Store 层 CRUD、按子类型与本地自然日范围筛选分页、分页不受截断的 `daily_summaries` 按日小计计算，以及 `GetSmartDefaults` 智能默认值聚合，并验证编译与单测通过
- [x] 3.3 在 `backend/internal/httpapi` 中实现 `/api/records/{feeding,sleep,care,health}` CRUD 与 `GET /api/records/defaults` 路由（含未建档 409 前置校验），并按 `test-plan.md` 补充四类记录 CRUD、筛选分页、小计与智能默认值集成测试，运行 `CGO_ENABLED=0 go test -v ./internal/httpapi/...` 验证通过

## 4. 首页看板聚合模块（dashboard-insights）

- [x] 4.1 实现 `backend/internal/dashboard` 包，完成时区感知的今日 KPI 汇总（含跨夜睡眠自然日切分、距上次喂奶/换尿布时间戳）、近 N 日奶量/睡眠趋势（空日补 0）及 5 时段照护节律聚合，并在 `backend/cmd/babylog/serve.go` 装配全部新依赖
- [x] 4.2 在 `backend/internal/httpapi` 中注册 `GET /api/dashboard/summary` 与 `GET /api/dashboard/trends` 路由，并按 `test-plan.md` 补充跨时区、跨夜睡眠拆分、空日补 0 与非法时区集成测试，运行 `CGO_ENABLED=0 go test -v ./internal/dashboard/... ./internal/httpapi/...` 验证通过

## 5. 前端 API 客户端与强制建档引导流

- [x] 5.1 新增前端类型定义、API 请求模块与 TanStack Query hooks（`src/lib/baby.ts`、`src/lib/records.ts`、`src/lib/dashboard.ts`，自动携带浏览器 IANA 时区并在写入后统一失效关联缓存），通过 `pnpm check` 验证类型无误
- [x] 5.2 实现首次登录强制建档引导页 `/onboarding` 与 `/_app` 路由建档门禁，并在 [settings.tsx](../../../src/routes/_app/settings.tsx) 增加宝宝档案编辑卡片，运行 `pnpm check` 验证路由生成与类型检查通过

## 6. 前端极速录入抽屉、真实看板与四大列表页

- [x] 6.1 改造 [quick-record-drawer.tsx](../../../src/components/quick-record-drawer.tsx) 支持新增与编辑双模式、结构化动态表单（喂养亲喂/瓶喂/辅食、睡眠入睡/醒来与快捷时长双向联动、护理尿布性状按需展开、健康体温 `±0.1℃` 步进与热态提示）、当前日期时间默认带出 + 快捷偏移胶囊（刚刚/15分前/30分前/1小时前）及智能默认值预填，运行 `pnpm check` 验证通过
- [x] 6.2 改造 [dashboard.tsx](../../../src/routes/_app/dashboard.tsx) 接入真实宝宝月龄问候、4 张实时 KPI 卡（含距上次喂奶/换尿布已过时长）、真实近 7 日 Recharts 图表（移除「示例数据」徽标）以及首页高频 1-Tap 一键直记按钮（附 5 秒撤销 Toast），运行 `pnpm check` 验证通过
- [x] 6.3 改造 [feeding.tsx](../../../src/routes/_app/feeding.tsx)、[sleep.tsx](../../../src/routes/_app/sleep.tsx)、[care.tsx](../../../src/routes/_app/care.tsx)、[health.tsx](../../../src/routes/_app/health.tsx) 四大列表页，实现按本地自然日分组与每日小计、子类型 Tab + 时间范围筛选、分页加载、点击编辑、删除二次确认弹窗及「再记一笔」快捷复用，运行 `pnpm check` 验证通过

## 7. 全链路验证与静态检查

- [x] 7.1 运行 `pnpm lint`、`pnpm check`、`pnpm test`（全量 `CGO_ENABLED=0 go test -v ./...`）与 `pnpm build`，确认代码规范、TypeScript 类型、后端单测/集成测试与单二进制构建全部通过
- [x] 7.2 使用系统临时目录中的隔离数据库启动构建产物或开发服务，端到端手工核验首次登录强制建档、1-Tap 一键直记与撤销、抽屉智能预填、跨零点/跨夜统计、列表分组小计与编辑删除流程，并在结束后清理临时数据目录

## Workflow follow-up

- 实施验收通过后归档 `core-records-and-dashboard` 变更至 `openspec/changes/archive/` 并同步更新 `openspec/specs/`。
- 运行 `openspec validate --specs --strict` 验证归档后的主规范完整无误。
