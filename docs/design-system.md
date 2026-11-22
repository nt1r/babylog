# BabyLog 前端设计规范

本文档定义 BabyLog Web 端的配色、排版、圆角间距与组件复用约定。所有设计 Token 以 [src/styles/tokens.css](../src/styles/tokens.css) 为代码级单一事实来源，供后续喂养、健康、提醒与数据看板页面统一复用。

## 设计原则

- **温暖克制**：以暖米白与鼠尾草绿为基底，搭配低饱和度绘本暖色，避免刺眼纯白高对比或生硬后台模板感。
- **高频单手友好**：面向父母日常及夜间单手操作，优先保证核心入口在移动端首屏清晰可达、触控目标充足。
- **语义优先**：业务代码禁止硬编码十六进制色值或 Tailwind 原始色阶（如 `bg-blue-500`、`text-gray-500`），统一使用语义 Token 与工具类，确保未来扩展暗色模式时零重构。

## 色彩体系（OKLCH）

### 1. 基础表面与品牌色

| 用途 | CSS 变量 | Tailwind 工具类示例 | 说明 |
| --- | --- | --- | --- |
| 页面画布 | `--background` | `bg-background` | 暖米白画布，降低长时间阅读疲劳 |
| 卡片表面 | `--surface` | `bg-surface` | 卡片、抽屉等前景承载面 |
| 主文字 | `--foreground` | `text-foreground` | 深森绿墨色，替代纯黑 |
| 次要文字 | `--muted` | `text-muted` | 辅助说明、时间戳、次级标签 |
| 品牌主色 | `--accent` / `--accent-foreground` | `bg-accent` / `text-accent` | 鼠尾草绿，用于主按钮、焦点环、关键强调 |
| 弱交互底色 | `--default` / `--default-foreground` | `bg-default` | 次级按钮、轻量胶囊底色 |
| 边框与分割线 | `--border` / `--separator` | `border-border` | 低存在感灰绿细线 |
| 输入框 | `--field-background` / `--field-border` / `--field-placeholder` | `bg-field` / `border-field-border` | 柔和浅底，无重阴影 |

### 2. 语义状态色

在 HeroUI 默认状态色基础上调整为与鼠尾草绿和谐的低饱和暖调（对应 `*-soft`、`*-soft-foreground`、`*-hover` 由 HeroUI 自动派生）：

| 状态 | CSS 变量 | Tailwind 工具类示例 | 适用场景 |
| --- | --- | --- | --- |
| 成功 / 正常 | `--success` | `bg-success-soft text-success-soft-foreground` | 记录已保存、提醒已完成、正常指标 |
| 提醒 / 注意 | `--warning` | `bg-warning-soft text-warning-soft-foreground` | 即将到期提醒、低烧或轻度波动提示 |
| 错误 / 异常 | `--danger` | `bg-danger-soft text-danger-soft-foreground` | 表单校验、网络错误、高热预警、删除确认 |

### 3. 育儿业务分类色

直接从品牌插画调色盘提炼，用于记录类型标签、时间线节点、快捷卡片与统计图表系列色：

| 业务分类 | CSS 变量 | Tailwind 工具类示例 | 覆盖场景 |
| --- | --- | --- | --- |
| 喂养（暖蜜黄） | `--feeding` / `--feeding-soft` / `--feeding-soft-foreground` | `bg-feeding-soft text-feeding-soft-foreground` | 母乳、奶粉、辅食、奶量曲线 |
| 睡眠（柔薄荷） | `--sleep` / `--sleep-soft` / `--sleep-soft-foreground` | `bg-sleep-soft text-sleep-soft-foreground` | 小睡、夜觉时长、作息节律 |
| 健康（暖蜜桃） | `--health` / `--health-soft` / `--health-soft-foreground` | `bg-health-soft text-health-soft-foreground` | 体温、用药、疫苗、体检、长牙 |
| 护理（柔木棕） | `--care` / `--care-soft` / `--care-soft-foreground` | `bg-care-soft text-care-soft-foreground` | 大小便、洗澡、身高体重生长记录 |

> 折线图/柱状图多系列对比优先按 `feeding -> sleep -> health -> care -> accent` 顺序取色，避免在同一视图引入未登记的临时色值。

### 4. 插画专用色

`--art-*`（`--art-meadow`、`--art-ink`、`--art-honey`、`--art-peach`、`--art-mint` 等）仅用于品牌插画、空状态与引导 SVG，不直接用于常规 UI 控件背景或文字。

## 排版与数据规范

- **字号阶梯**：
  - 页面主标题：`24px–26px`（移动端 `22px–24px`），字重 `650`
  - 区块/卡片标题：`16px–18px`，字重 `600`
  - 正文与列表项：`14px–15px`
  - 辅助说明/标签：`12px–13px`（**全站最小字号不低于 `12px`**）
  - 移动端输入框：固定 `16px`，避免 iOS Safari 聚焦缩放
- **数值展示**：奶量（`ml`）、时长（`min`）、体温（`℃`）、身高体重与时间轴刻度统一使用 `tabular-nums`，防止数值变化时横向跳动。

## 圆角、阴影与触控尺寸

| 元素类型 | 圆角 | 表面与阴影 |
| --- | --- | --- |
| 顶级页面主卡片 | `var(--card-radius)`（桌面 `28px` / 移动端 `24px`） | `bg-surface` + `shadow-card` + 淡边框 |
| 内容卡片 / 列表项 | `16px`（`rounded-2xl`） | `bg-surface` + `border border-border`（无重阴影） |
| 输入框 / 主按钮 | `var(--field-radius)`（`14px`） | 遵循 HeroUI 语义变体 |
| 提示条 / 紧凑模块 | `12px`（`rounded-xl`） | `*-soft` 浅底 + 20% 透明边框 |
| 分类标签 / 徽章 | `rounded-full` | `bg-<category>-soft text-<category>-soft-foreground` |

- **移动端触控底线**：常用交互控件（切换按钮、快捷记一笔、列表操作项）点击区域不低于 `44px × 44px`。

## 样式组织与组件复用约定

1. **交互组件优先 HeroUI v3**：按钮、输入框、表单、卡片、弹窗、抽屉、标签页、下拉选择、Toast 等一律使用 `@heroui/react`，并同步在 [src/styles.css](../src/styles.css) 顶部按需补充对应的 `@import "@heroui/styles/components/*.css" layer(components)`。
2. **页面布局优先 Tailwind v4 Utilities**：新建业务页面优先使用语义化工具类（如 `flex`、`gap-4`、`p-4`、`bg-surface`、`text-muted`、`rounded-2xl`），不在 `src/styles.css` 为每个页面堆积一次性 class。
3. **样式文件职责划分**：
   - [src/styles/tokens.css](../src/styles/tokens.css)：全局设计 Token 与 `@theme inline` 映射；
   - [src/styles.css](../src/styles.css)：HeroUI 按需引入、全局基础重置、跨页共享原语及插画/动效样式。
4. **图标与品牌视觉**：
   - UI 图标统一使用 `lucide-react`，线宽保持 `1.7–1.8`，尺寸通过 Tailwind `size-*` 工具类控制；
   - 品牌标识统一使用摇摇小木马（`BrandMark` / `public/favicon.svg`），空状态或引导插画延续鼠尾草描边（`--art-ink`）+ 低饱和暖色绘本风格；
   - 所有装饰动效必须包裹在 `@media (prefers-reduced-motion: no-preference)` 中。
5. **暗色模式预留**：亮色覆写始终限定在 `:root:not(.dark):not([data-theme="dark"]), .light, [data-theme="light"]`；后续新增暗色主题只需在 `tokens.css` 中补充 `.dark, [data-theme="dark"]` 变量块，无需修改组件代码。
