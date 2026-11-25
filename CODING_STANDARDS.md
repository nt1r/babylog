# CODING_STANDARDS.md

代码审查、前端交互编写与后端模块实现时的判断性规范清单。自动化工具与静态门禁（见 `package.json` 与 `scripts/lint-guardrails.sh`）已覆盖的格式、类型、循环依赖、设计系统禁令与注释格式基线由 `pnpm lint` / `pnpm check` 保障，此处仅记录需要工程判断的准则。

## 前端规范（React / TypeScript / Tailwind v4）

### 设计系统与无障碍
- 配色、圆角与业务分类色以 `docs/design-system.md`、`src/styles/tokens.css` 与 `src/styles/globals.css` 为准；业务界面统一复用语义 Token（含 `feeding` / `sleep` / `health` / `care` 分类色）与 `src/components/ui/` 原语（机械色阶、字号与裸控件禁令由 `scripts/lint-guardrails.sh` 自动兜底）。
- 移动端原生 `<input>` / `<select>`（含透明覆盖层）保持 `text-base md:text-sm`（`>= 16px`）避免 iOS 放大，桌面紧凑覆写须带 `md:` 前缀；同层级表单标签与 `FieldLabel`（`13px`）对齐、卡片单选块与 `ChoiceCardButton`（`h-10 text-sm`）对齐。
- 响应式宽度与布局断点与 `useIsMobile`（`768px` = `md:`）保持一致；含内部滚动区的底部 `Drawer` 在滚动容器标注 `data-base-ui-swipe-ignore`，浮层与抽屉（`Popover`/`Drawer`）在 `disabled` 时仅拦截打开、始终放行关闭并在转为 `disabled` 时自动收起。
- 亮/暗双色语义变量在 `src/styles/tokens.css` 中成对维护：亮色覆写限定在 `:root:not(.dark):not([data-theme="dark"]), .light, [data-theme="light"]`，暗色覆写限定在 `.dark, [data-theme="dark"]`。
- 所有无障碍文案（`Spinner`、抽屉/弹窗关闭按钮、面包屑、步进按钮的 `aria-label`）使用中文；按钮内的 `Spinner` 标注 `aria-hidden="true" role="presentation"`，避免嵌套 live region 或中英文混播。
- 375px 窄屏下关键提醒与医疗/安全提示文案允许自然换行或 `line-clamp-2`，避免单行 `truncate` 截断；3 列及以上数值磁贴须核对单格可用宽度与 `whitespace-nowrap`，防止带徽章或小数数值异常折行。
- 中文输入法与全局快捷键守卫：在 `<input>` 上自定义 `Enter` 快捷键行为时须跳过 IME 组合态（`event.nativeEvent.isComposing || event.keyCode === 229`）；全局快捷键（如 `⌘K` / 单键快记）须检测并拦截活跃的弹窗、抽屉、Popover 与下拉菜单，防止叠开或打断提交中（`pending`）抽屉。

### 状态边界、分页与异步交互
- TanStack Query 负责服务端数据查询与缓存，Zustand 负责认证会话、主题偏好与抽屉意图；全局请求层收到非认证接口 `401` 时统一清空认证状态与 Query 缓存并退回登录页。
- 列表翻页使用 `useInfiniteQuery` 按 `offset` 递增拉取并与后端 `MaxListLimit` 对齐。翻页请求失败（`isFetchNextPageError`）时保留已加载列表并在底部提供内联重试按钮（重试中禁用并展示加载态），仅在首屏无数据且报错时渲染整页错误态。
- 图表与全量趋势聚合使用专用查询（显式指定对齐 `MaxListLimit` 的 `limit`，并透传错误重试态与上限提示），不直接复用 `PAGE_SIZE = 20` 的列表分页 Hook，避免静默截断早期历史。按日统计或绘图的时序数据以本地自然日 `YYYY-MM-DD` 去重，不用四舍五入后的近似月龄/天数作为去重键。
- 提交或删除进行中（`isPending`）时，抽屉与确认弹窗须拦截关闭操作（遮罩点击 / `Esc` / 返回键 / 下滑手势）：基于 `@base-ui/react/drawer` 的抽屉调用 `eventDetails.cancel()`，同步开启 `disablePointerDismissal` 并禁用顶部关闭按钮，防止异步失败错误被写入已关闭容器而丢失反馈。
- 高频直记按钮除禁用态外须配备 `useRef` 同步防重入锁；一次性撤销回调（如 Toast 撤销按钮）须配备单次执行守卫，防止连点重复请求导致误报 404。
- 抽屉关闭动画期间保持当前意图稳定，由下次打开动作写入新意图，避免标题与表单区在滑出瞬间闪烁；表单初始化 `useEffect` 仅依赖 `[open, entityId]`（其余默认值通过 `useRef` 读取），避免后台 Query 刷新冲掉未保存编辑，且校验与提交仅覆盖当前激活状态下可见的字段。

### 表单受控、步进单调性与智能默认值
- 数字与小数输入框一律以 `string` 受控，仅在点击步进或提交时解析与校验，保证退格删空重输流畅。
- 数值步进控件须满足单调性：有限越界输入先收敛到 `[min, max]` 再微调（仅空串或非数值回退默认值）；当手动输入下限 `min` 小于步进下限 `stepMin` 时，减号永不增大数值、加号按实际步长递增。
- 异步智能默认值通过版本（`dataUpdatedAt` + `!isFetching`）与字段编辑态（`userTouched`）双守卫：仅在「新建态且用户尚未编辑任何字段」时回填并允许陈旧缓存刷新后同步最新值；切换顶部 L1 分类 Tab 不视为编辑字段。
- 多品类表单按品类垂直拆分为纯 codec（默认值、DTO 回填、校验与载荷组装）与薄字段视图，避免单文件巨型抽屉或把校验与 HTTP 调用耦在一起。
- 条件显隐的辅助开关（如按输入值动态显隐的复选框）在进入隐藏态时同步复位状态，防止再次显露时残留旧勾选导致误提交；提交中须同步禁用影响草稿的快捷胶囊。
- 主/副联动快捷胶囊（如辅食+份量、药品+剂量）在切换预设时同步覆写或清空副字段，防止残留上一预设值；批量表单预填默认值前先核对目标集合是否已有现值，保留后端 `*string` 留空不覆写语义。

## Go 后端规范

### 模块边界、配置与一致性
- 按职责分层组织 `backend/internal/`，不在路由或组件构造函数中修改包级全局状态；依赖目录或日志等外部配置通过 `Options` 显式注入，避免传输层隐式依赖配置包或运行时环境变量。
- 环境变量在入口阶段显式校验；跨目录脚本调用的相对路径基于调用方工作目录解析；SQLite 连接参数、WAL 配置与 `goose` 迁移保持单一事实来源。
- 凡依赖 `time.Now()` 做校验、会话过期或聚合的 Store/Service 均支持 `WithClock` 注入，测试统一使用固定时钟消除宿主机日期依赖。
- 跨多接口的公共前置检查（如已建档校验）下沉为 Gin 中间件；跨模块同口径统计（如列表小计与首页看板）收敛为单一共享累加函数。
- GORM 错误判断统一使用 `errors.Is`；读后写更新包入 `db.Transaction` 并显式 `Select` 更新列清单，确保跨子类型切换时废弃可空列落库为 `NULL`。
- HTTP 错误与异常恢复统一返回结构化中文 JSON，CLI 提示保持中文一致；服务端日志统一经 `log/slog` 输出且不含原始请求头、Cookie、凭据或个人敏感数据。

### 后端测试质量
- 分层定位、场景数据生成器、断言红线、中文场景注释模板与环境隔离细则以 `docs/testing-guide.md` 为单一事实来源；代码审查须核对写操作具备回读终态断言、业务前置数据经真实 HTTP API 构造，且与活动 OpenSpec 变更的 `test-plan.md` 逐项对应。

## 中文注释规范
- **聚焦“为什么”与高危隐性契约**：统一使用中文并对齐 `GLOSSARY.md` 术语（业务域操作者称“家长”或“管理员”）；重点阐明核心业务逻辑、复杂算法、面向非 Go 背景维护者的 Go 特有机制（就地讲清“机制 + 本处作用”，同包仅首处说明），以及重构易踩坑的高危隐性契约——如三态指针语义（`nil` 保留 vs `""` 清空）、批量与单条更新的字段保留差异、时间存储单位与 UTC/DST 假设、跨层安全耦合（如 `changeOrigin: false`、Same-Origin、`/dev/tty` 管道交互）与复杂前端状态守卫（双守卫、单次锁、主副联动覆写、防误关）。
- **保持克制与高信噪比**：Go 后端生产代码（含包、导出符号、关键常量组与 `[Symbol]` 关联链接）保持文档完整；SQL 迁移（表职责、字段单位、部分唯一索引）与关键构建/运维脚本点明核心约束；前端与后端测试仅在核心算法、codec、Store、自定义 Hook、复杂状态守卫或非直观边界补充说明，简单直观代码、路由 `Route`、自解释 DTO/标签表与基础 `src/components/ui/` 原语包装留白即可。
- **随代码同步演进**：修改行为或叠加新功能时同步更新包/文件总览注释与意图注释，保持静态事实描述（去掉“重构后的”“第 1 期”等过程时态词），清理废弃注释代码。机械格式基线与集成测试模板一致性由 `scripts/check-comments.mjs`、`scripts/check-spec-refs.mjs` 与 `// cross-table:` 门禁自动兜底（不以覆盖率或字数为指标）。

## 前后端契约与审查核对
- 修改或精简请求/响应字段前，同步核对三处事实来源：Go `json` tag、前端 `src/lib/*.ts` 类型定义与 `openspec/specs/*.md`。
- Go 后端以 `*string` 表达三态语义（`nil` 保留原值、`""` 显式清空）时，前端留空输入默认序列化为 `undefined`，仅在明确需要清空旧值时发送空字符串。
- 确认任何未消费字段或接口前，先检索全仓页面、导航、抽屉与 OpenSpec 规格，确保不破坏既有契约或引发回归。
- 保持模块边界清晰，避免跨业务模块横向耦合引用（前端未引用死导出已由 `pnpm lint` 自动门禁拦截）。
