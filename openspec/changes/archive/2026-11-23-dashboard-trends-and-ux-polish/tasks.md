# Tasks

## 1. 后端趋势接口扩展与测试

- [x] 1.1 更新 `backend/internal/dashboard/service.go`：`DailyTrendPoint` 新增 `direct_breast_min` 与 `direct_breast_count`，在 `GetTrends` 中复用 `records.AccumulateFeedingSummary` 按本地自然日汇总，并验证 `pnpm test` 通过
- [x] 1.2 依据 `test-plan.md` 扩展 `backend/internal/httpapi/records_dashboard_test.go` 中的 `TestDashboardTimezoneSummaryAndCrossMidnightTrends`，覆盖空日零值与跨 UTC 零点亲喂聚合断言，并验证 `pnpm test` 通过

## 2. 全局壳层、导航与未上线入口收敛

- [x] 2.1 从 `src/navigation/menu.ts` 隐藏「提醒待办」导航入口，清理 `src/routes/_app/reminders.tsx` 的排期话术与无效新建入口，并在 `src/components/quick-record-drawer.tsx` 中移除提醒分类与排期 Toast，验证 `pnpm check` 通过
- [x] 2.2 更新 `src/components/app-shell/app-sidebar.tsx`、`src/components/app-shell/admin-header.tsx`、`src/components/ui/sidebar.tsx` 与 `src/components/list-page-card.tsx`：移除侧边栏小贴士、消除桌面端双主色「记一笔」按钮重叠、移动端侧栏触发器改为 `Menu` 图标并消除列表页移动端重复标题，验证 `pnpm check` 通过

## 3. 首页看板重排、亲喂趋势与健壮性补齐

- [x] 3.1 更新 `src/lib/dashboard.ts` 与 `src/lib/time.ts`：补充趋势亲喂字段类型并将看板睡眠时长格式化为自然中文，验证 `pnpm check` 通过
- [x] 3.2 重构 `src/routes/_app/dashboard.tsx`：精简问候区、将一键直记置顶至首屏高频区、移除底部绘本装饰卡、补齐一键直记撤销异常处理与默认奶量加载守卫、补齐看板报错重试与空状态，并实现喂养趋势单 Tab 自动适配奶量/亲喂时长与复合 Tooltip，验证 `pnpm check` 通过

## 4. 列表页交互与窄屏适配

- [x] 4.1 更新 `src/components/record-list-section.tsx` 与 `src/components/ui/tabs.tsx`：支持点击记录行主体编辑、放大操作按钮触控区并拉大编辑与删除间距、为窄屏 Tabs 增加横向滚动支持，验证 `pnpm check` 通过
- [x] 4.2 更新 `src/routes/_app/feeding.tsx`、`sleep.tsx`、`health.tsx`、`care.tsx`：删除确认弹窗展示记录时间与摘要并去掉废话、移除跨夜睡眠重复说明、统一日汇总量词为「共 X 次」、筛选空状态提供快捷放宽时间范围按钮，验证 `pnpm check` 通过

## 5. 快捷录入抽屉、设置页与登录建档页精简和校验

- [x] 5.1 更新 `src/components/quick-record-drawer.tsx` 与 `src/components/quick-record/*`：精简顶部副标题/重复 Badge/洗澡提示框与睡眠文案、将表单错误固定至 Footer 上方并补全前端校验、防止手动选择睡眠类型被自动覆写、统一全角括号单位，验证 `pnpm check` 通过
- [x] 5.2 更新 `src/routes/_app/settings.tsx`、`src/components/app-shell/user-menu.tsx`、`src/routes/onboarding.tsx`、`src/routes/login.tsx`：独立运行态隐藏安装卡片并去除技术术语、去掉管理员徽章与登录状态废话、修复设置页后台刷新覆盖编辑并补齐前端校验、统一退出确认文案并精简登录与建档页文案，验证 `pnpm check` 通过

## 6. 集成验证与收尾

- [x] 6.1 运行 `pnpm lint`、`pnpm check`、`pnpm test`、`openspec validate --strict` 并同步更新主 spec（归档前验证全部通过）
