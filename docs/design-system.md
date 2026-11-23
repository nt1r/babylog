# BabyLog 前端设计规范

本文档定义 BabyLog Web 端的配色、排版、圆角间距、双色主题与组件复用约定。所有设计 Token 以 [src/styles/tokens.css](../src/styles/tokens.css) 与 [src/styles/globals.css](../src/styles/globals.css) 为代码级单一事实来源，前端组件架构对齐 `shadcn`（`base-nova`）+ `@base-ui/react`。

## 设计原则

- **温暖克制**：保留暖米白与鼠尾草绿的品牌调性，搭配低饱和度绘本暖色与清晰细边框层级，兼顾现代仪表盘质感与亲子温度。
- **昼夜护眼与单手友好**：同时提供浅色暖米白与深色深森绿灰护眼主题（支持跟随系统、首屏无闪烁注入）；移动端提供底部导航与底部滑出录入抽屉，保证核心入口单手可达、触控目标充足。
- **语义优先**：业务代码禁止硬编码十六进制色值或 Tailwind 原始色阶（如 `bg-blue-500`、`text-gray-500`），统一使用语义 Token 与工具类。

## 色彩体系（OKLCH · 亮/暗双色）

### 1. 基础表面与品牌色

| 用途 | CSS 变量 | Tailwind 工具类示例 | 说明 |
| --- | --- | --- | --- |
| 页面画布 | `--background` | `bg-background` | 浅色暖米白 / 深色柔和深森绿灰 |
| 卡片与浮层表面 | `--card` / `--popover` | `bg-card` / `bg-popover` | 卡片、抽屉、下拉菜单前景承载面 |
| 主文字 | `--foreground` | `text-foreground` | 浅色深森绿墨色 / 深色柔暖象牙白 |
| 次要文字 | `--muted-foreground` | `text-muted-foreground` | 辅助说明、时间戳、次级标签 |
| 品牌主色 | `--primary` / `--primary-foreground` | `bg-primary` / `text-primary` | 鼠尾草绿，用于主按钮、焦点环、关键强调 |
| 次级与弱交互底色 | `--secondary` / `--accent` / `--muted` | `bg-secondary` / `bg-accent` | 次级按钮、导航高亮、轻底块 |
| 侧边栏表面 | `--sidebar` / `--sidebar-accent` / `--sidebar-border` | `bg-sidebar` | Inset 侧边栏独立画布层 |
| 边框与输入框 | `--border` / `--input` / `--ring` | `border-border` / `border-input` | 低存在感灰绿细线与鼠尾草绿聚焦环 |

### 2. 语义状态色

| 状态 | CSS 变量 | Tailwind 工具类示例 | 适用场景 |
| --- | --- | --- | --- |
| 成功 / 正常 | `--success` / `--success-soft` | `bg-success-soft text-success-soft-foreground` | 记录已保存、提醒已完成、正常指标 |
| 提醒 / 注意 | `--warning` / `--warning-soft` | `bg-warning-soft text-warning-soft-foreground` | 即将到期提醒、低烧或轻度波动提示 |
| 错误 / 异常 | `--destructive` / `--destructive-soft` | `bg-destructive-soft text-destructive-soft-foreground` | 表单校验、网络错误、高热预警、删除确认 |

### 3. 育儿业务分类色

直接从品牌插画调色盘提炼，并针对亮/暗主题分别校准对比度，用于记录类型徽章、快捷入口与 Recharts 图表系列色：

| 业务分类 | CSS 变量 | Tailwind 工具类示例 | 覆盖场景 |
| --- | --- | --- | --- |
| 喂养（暖蜜黄） | `--feeding` / `--feeding-soft` / `--feeding-soft-foreground` | `bg-feeding-soft text-feeding-soft-foreground` | 母乳、奶粉、辅食、奶量曲线 |
| 睡眠（柔薄荷） | `--sleep` / `--sleep-soft` / `--sleep-soft-foreground` | `bg-sleep-soft text-sleep-soft-foreground` | 小睡、夜觉时长、作息节律 |
| 健康（暖蜜桃） | `--health` / `--health-soft` / `--health-soft-foreground` | `bg-health-soft text-health-soft-foreground` | 体温、用药、疫苗、体检、长牙 |
| 护理（柔木棕） | `--care` / `--care-soft` / `--care-soft-foreground` | `bg-care-soft text-care-soft-foreground` | 大小便、洗澡、身高体重生长记录 |

> 图表多系列色板通过 `--chart-1` 至 `--chart-5` 按 `feeding -> sleep -> health -> care -> primary` 顺序映射，避免在同一视图引入未登记的临时色值。

### 4. 插画专用色

`--art-*`（`--art-meadow`、`--art-ink`、`--art-honey`、`--art-peach`、`--art-mint` 等）仅用于品牌插画、空状态与引导 SVG（[src/components/brand/little-moments.tsx](../src/components/brand/little-moments.tsx)），并同步维护亮/暗两套调色盘。

## 排版与数据规范

- **字体栈**：英文与数字优先使用 `@fontsource-variable/geist`（`Geist Variable`），中文自然回落至 `PingFang SC`、`Hiragino Sans GB`、`Microsoft YaHei`。
- **字号阶梯**：
  - 页面主标题：`24px–28px`，字重 `600`
  - 区块/卡片标题：`16px–18px`，字重 `600`
  - 正文与列表项：`14px–15px`
  - 辅助说明/标签：`12px–13px`（**全站最小字号不低于 `12px`**）
  - 移动端输入框：`16px`（`text-base md:text-sm`），避免 iOS Safari 聚焦缩放
- **数值展示**：奶量（`ml`）、时长（`h`/`min`）、体温（`℃`）、身高体重与时间刻度统一使用 `tabular-nums`。

## 布局壳层与交互范式

- **桌面端主框架**：采用 `Inset Sidebar` + 吸顶 `AdminHeader`（侧栏折叠、面包屑、快捷「记一笔」、主题切换、用户菜单），支持 `Ctrl/Cmd + B` 折叠侧栏至图标态。
- **移动端主框架**：顶部保留抽屉导航与主题/账号入口，底部提供 5 槽位单手导航栏（核心 4 个入口 + 中央突出「快速记一笔」按钮，点击区不低于 `44px × 44px`）。
- **页面与抽屉模板**：
  - 看板页：使用 `@container/main` 响应式栅格（问候区 -> 一键直记条 -> 4 列 KPI 卡 -> `2:1` Recharts 图表 -> 四分类快捷录入）；
  - 记录列表页：统一复用 [ListPageCard](../src/components/list-page-card.tsx) + `Tabs` 筛选 + [Empty](../src/components/ui/empty.tsx)；
  - 录入/详情抽屉：统一复用 [EntityDrawer](../src/components/entity-drawer.tsx)（桌面端右侧滑出、移动端底部滑出）；
  - 危险操作确认：统一复用 [DeleteConfirmDialog](../src/components/delete-confirm-dialog.tsx)。

## 样式组织与组件复用约定

1. **基础 UI 原语**：统一放在 `src/components/ui/`，基于 `@base-ui/react` 与 `class-variance-authority` 编写（配置见 [components.json](../components.json)）。
2. **主题启动无闪烁**：主题模式（`light` / `dark` / `system`）由 [src/scripts/theme-boot-script.ts](../src/scripts/theme-boot-script.ts) 在 HTML 渲染前同步写入 `<html>` 与 `<meta name="theme-color">`。
3. **品牌与动效**：
   - UI 图标统一使用 `lucide-react`，线宽保持 `1.75–1.8`；
   - 品牌标识统一使用摇摇小木马（[BrandMark](../src/components/brand/brand-mark.tsx) / [public/favicon.svg](../public/favicon.svg)）；
   - 所有装饰动效包裹在 `@media (prefers-reduced-motion: no-preference)` 中。
