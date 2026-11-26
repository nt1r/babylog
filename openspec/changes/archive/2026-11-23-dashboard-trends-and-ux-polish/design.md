# Design: 看板亲喂趋势扩展与前端体验优化

## Context

详见 [proposal.md](./proposal.md) 中的动机与变更范围。现有后端 `dashboard.Service.GetTrends` 仅手工累加了喂养记录的 `AmountML`，未复用 `records.AccumulateFeedingSummary`，导致纯亲喂家庭在首页趋势图中看不到任何喂养数据；前端也存在多处冗余文本与单手交互障碍。

## Goals / Non-Goals

### Goals
- 扩展 `/api/dashboard/trends` 每日聚合结构，复用 `records.AccumulateFeedingSummary` 保证奶量、亲喂时长与次数在全系统内口径唯一。
- 重构看板信息层级与错误/空状态，让高频操作触手可及，自动适配纯亲喂与混合/瓶喂家庭。
- 精简全站多余文案、技术术语和重复 UI 元素，修复移动端导航、窄屏 Tab 溢出、记录行误触、录入抽屉校验与设置页状态覆盖等问题。

### Non-Goals
- 不实现「提醒待办」完整业务功能（仅隐藏未上线入口并保留路由文件）。
- 不新增数据库表或迁移文件，不改动既有认证与写操作安全基线。

## Decisions

1. **后端趋势聚合复用共享函数**：
   - 在 `dashboard.Service.GetTrends` 中以 `map[string]*records.FeedingDailySummary` 替代 `map[string]int`，对每条喂养记录调用 `records.AccumulateFeedingSummary`，并在 `DailyTrendPoint` 中输出 `feeding_ml`、`direct_breast_min` 与 `direct_breast_count`。
   - 备选方案：在 `GetTrends` 中单独写 `if subtype == "breast"` 分支；放弃原因：违反单一口径原则，后续调整喂养统计逻辑易产生漂移。
2. **前端喂养趋势单 Tab 自动切换**：
   - 趋势图保持「喂养 / 睡眠」两个 Tab，避免界面碎片化。
   - 若近 7 日 `feeding_ml` 全部为 0 且存在 `direct_breast_min > 0`，喂养 Tab 自动展示「每日亲喂时长（分钟）」，Tooltip 同时展示亲喂次数与时长；其余情况默认展示「每日奶量（ml）」，并在 Tooltip 中当该日存在亲喂时附加亲喂次数与时长。
3. **全局壳层与按钮去重**：
   - 顶部 Header 的全局「+ 记一笔」仅在非记录列表页（看板、设置页等）展示；四类记录列表页保留卡片内主按钮（可携带当前子类型筛选），消除桌面端双主按钮重叠。
   - 移动端顶部栏保留抽屉菜单入口（图标改为通用 `Menu`）与页面标题；列表页在移动端隐藏卡片内重复的标题行，直接展示操作与筛选区。
4. **记录行防误触与高效编辑**：
   - 点击记录行主体进入编辑，操作按钮区阻止事件冒泡；保留行内直观的「再记一笔 / 编辑 / 删除」按钮，将图标按钮放大至 36px 触控区并在「编辑」与「删除」之间拉大间距分隔，降低单手误触删除概率。
5. **睡眠类型防覆写与设置页防覆盖**：
   - 睡眠表单记录用户是否主动切换过睡眠类型（`subtypeTouched`），手动选择后调整入睡时间或快捷时长不再覆盖用户选择。
   - 设置页使用 `dirty` 守卫（或按 `baby.updated_at` 同步且仅在未编辑时回填），避免后台 Query 重新聚焦刷新冲掉未保存修改。

## Risks / Trade-offs

- [风险] 移动端列表页隐藏卡片内 `h1` 标题后，屏幕阅读器或桌面端标题层级可能缺失 → 缓解：仅在桌面端保留 `ListPageCard` 的标题区，或在移动端将头部标题设为语义 `h1`、卡片内标题使用 `hidden md:flex`（避免页面缺少 `h1` 或双 `h1`）。
- [风险] 一键直记在 `defaultsQuery` 加载完成前禁用按钮可能短暂不可点 → 缓解：按钮展示轻量骨架/禁用态，接口通常毫秒级返回，优于用错误的 `90 ml` 写入脏数据。
