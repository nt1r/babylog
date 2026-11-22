# BabyLog

奶爸视角的宝宝日常记录应用，用于记录喂养、健康状况和提醒事项。界面采用 HeroUI，追求简洁、美观与良好的移动端体验。

当前已实现响应式管理端登录：仅管理员可登录，无注册入口。管理员由 CLI 从本地密码文件初始化，凭据与会话保存在 SQLite 中，登录使用 cookie 会话，支持过期与注销失效。

## 开发与使用

技术栈：React 19、Vite 8、TypeScript 7、HeroUI v3、Tailwind CSS v4；运行时为 Node 26.13.1 LTS（见 `.node-version`）与 pnpm 12.21.0。已安装 NVS 时，`nvs use` 会按 `.node-version` 切换版本，缺失版本按 NVS 文档自动安装。

```bash
pnpm install
pnpm admin:init --password-file "$PASSWORD_FILE"
pnpm dev
```

`PASSWORD_FILE` 由操作者设置为仓库外已有的私有密码文件。密码长度须为 12–1024 字符，文件末尾仅一个 LF 或 CRLF 会被移除，其余空白原样保留。默认用户名为 `admin`，可用 `--username` 指定；重复执行初始化会拒绝覆盖已有管理员。

数据写入 `data/babylog.sqlite`（已被 `.gitignore` 忽略）；设置 `BABYLOG_DATA_DIR` 可改用其他目录，初始化与运行需使用同一取值。

开发页面为 http://127.0.0.1:5173，API 默认监听 3001；可用 `PORT` 覆盖端口，Vite 代理同步使用该值。

- `pnpm check`：执行 TypeScript 类型检查。
- `pnpm build`：构建前端产物。
- `pnpm start`：用构建产物提供 UI 与 API（3001 端口）。

## 功能计划

1. **喂养记录**：支持母乳、奶粉混合喂养和辅食，记录喂养时间、时长、奶量等信息。
2. **日常健康记录**：记录大小便、用药、体温、身高、体重、长牙等信息，支持自定义记录类型。
3. **提醒管理**：支持疫苗接种、定时用药、健康检查及自定义待办，提供每日定时主动提醒。
4. **数据看板**：首页展示喂养、排便、体温及生长发育等统计信息，以折线图等方式呈现数据趋势。
5. **多账号与多宝宝**：服务端支持多个账号，账号间数据隔离；每个账号可管理多个宝宝，同一账号支持多设备登录及数据同步。

## 技术实现要求

1. **先读规范再动手**：实施界面前阅读 HeroUI 仓库中的项目规范，核对本项目现有技术栈、包管理器、目录结构和 UI 实现方式；在现有结构上扩展，保留已有功能和无关改动。
2. **按平台集成**：Web 端使用 HeroUI v3 与 Tailwind CSS v4（官方要求 React 19+），React Native 端使用 HeroUI Native 并遵循其官方规范，原生实现中不混用 Web API。项目已安装 HeroUI 时复用现有版本与配置。
3. **核对最新 API**：实施前阅读对应平台的最新 Quick Start，确认所用组件的最新 API、属性与官方示例，按当前版本文档编写。
4. **遵循设计体系**：优先使用官方组件、语义化设计 Token 与复合组件，交互满足无障碍要求，保持视觉风格、间距和反馈一致。
5. **完成前自检**：检查桌面端与移动端的布局适配，运行项目已有的相关检查命令，修复本次改动引入的问题。

## 参考文档

- React Quick Start：https://heroui.com/docs/react/getting-started/quick-start
- React Native Quick Start：https://heroui.com/docs/native/getting-started/quick-start
- Agent Skills：https://heroui.com/docs/react/getting-started/agent-skills
- Design Taste：https://heroui.pro/docs/react/getting-started/design-taste
