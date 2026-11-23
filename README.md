# BabyLog

奶爸视角的宝宝日常记录应用，用于记录喂养、健康状况和提醒事项。界面基于 shadcn（`base-nova`）+ `@base-ui/react` 与 Tailwind CSS v4 构建，延续温暖鼠尾草绿绘本风，支持浅色/深色护眼主题与移动端单手操作。

当前已实现响应式管理端登录与家庭空间工作台壳层（Inset 侧边栏、移动端底栏、首页看板视图、快捷录入抽屉与主题偏好设置）：仅管理员可登录，无注册入口。管理员由 CLI 从本地密码文件初始化，凭据与会话保存在 SQLite 中，登录使用 cookie 会话，支持过期与注销失效。

## 开发与使用

技术栈：
- 前端：React 19、Vite 8、TypeScript 7、shadcn（`base-nova`）+ `@base-ui/react`、Tailwind CSS v4、TanStack Router / Query、Zustand、Recharts；Node 26.13.1 LTS（见 `.node-version`）与 pnpm 12.21.0。已安装 NVS 时，`nvs use` 会按 `.node-version` 切换版本。
- 后端：Go（见 `backend/go.mod`）、Gin、GORM + 零 CGO SQLite（`glebarez/sqlite` / `modernc.org/sqlite`）、`goose` 内嵌迁移、`cobra` CLI、`embed.FS` 单二进制打包。

```bash
pnpm install
pnpm admin:init --password-file "$PASSWORD_FILE"
pnpm dev
```

`PASSWORD_FILE` 由操作者设置为仓库外已有的私有密码文件。密码长度须为 12–1024 字符，文件末尾仅一个 LF 或 CRLF 会被移除，其余空白原样保留。默认用户名为 `admin`，可用 `--username` 指定；重复执行初始化会拒绝覆盖已有管理员。

数据写入 `data/babylog.sqlite`（已被 `.gitignore` 忽略）；设置 `BABYLOG_DATA_DIR` 可改用其他目录，初始化与运行需使用同一取值。

开发页面为 http://127.0.0.1:11115，Go 后端（经 `air` 热重载）默认监听 21115；可用 `PORT` 覆盖端口，Vite 代理同步使用该值。

- `pnpm lint`：执行 Biome 检查与 `go vet`。
- `pnpm check`：执行 TypeScript 类型检查。
- `pnpm test`：执行 Go 后端单元与集成测试（`CGO_ENABLED=0`）。
- `pnpm build`：构建前端产物并内嵌打包为单二进制 `bin/babylog`。
- `pnpm start`：运行 `bin/babylog serve` 提供 UI 与 API（21115 端口）。

## Docker Compose 部署（HTTPS）

项目提供多阶段构建的 [Dockerfile](./Dockerfile) 与单容器 [compose.yaml](./compose.yaml)，默认仅绑定宿主机回环地址 `127.0.0.1:21115`，由宿主机反向代理（如 Caddy / Nginx）统一提供 Let's Encrypt HTTPS。

### 1. 构建并初始化管理员

```bash
docker compose build

# 交互式写入 0600 临时密码文件（长度 12–1024 字符），初始化后立即删除
umask 077
read -rsp "输入 BabyLog 管理员密码: " BABYLOG_PASS; echo
printf '%s\n' "$BABYLOG_PASS" > /tmp/babylog-init.pass
unset BABYLOG_PASS

docker compose run --rm --no-deps \
  -v /tmp/babylog-init.pass:/tmp/init.pass:ro \
  babylog admin init --password-file /tmp/init.pass --username admin
rm -f /tmp/babylog-init.pass

docker compose up -d
```

SQLite 数据库持久化保存在 Docker 命名卷 `babylog_data`（挂载到容器内 `/data`，归属 UID `1000`）。

### 2. 反向代理配置要点（以 Caddy 为例）

```caddyfile
baby.example.com {
	encode zstd gzip

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
	}

	reverse_proxy 127.0.0.1:21115 {
		# 后端内网走 HTTP，由反代补齐会话 Cookie 的 Secure 标记
		header_down Set-Cookie "(?i)(^babylog_session=.*)" "$1; Secure"
	}
}
```

- **保留原始 `Host` 头**：所有写接口均启用 Same-Origin 校验，Caddy 默认透传 `Host`；若使用 Nginx，须显式设置 `proxy_set_header Host $http_host;` 与 `proxy_cookie_flags babylog_session secure;`。
- **透传缓存头**：不要在反代覆盖后端返回的 `Cache-Control`（`/api/*` 为 `no-store`，`index.html`/`sw.js`/`manifest.webmanifest` 为 `no-cache`，`/assets/*` 为 `immutable`），以确保 iOS / Android PWA 正常更新。

### 3. 本地一键推送更新

在仓库根目录创建本地配置文件 `.env.deploy`（已被 `.gitignore` 忽略，不会入库）：

```sh
DEPLOY_HOST=user@your-server
DEPLOY_DIR=/opt/babylog
DEPLOY_DOMAIN=baby.example.com
```

本地修改完成后执行 [scripts/deploy.sh](./scripts/deploy.sh) 即可完成检查、白名单同步、远程重建容器与健康验证：

```sh
./scripts/deploy.sh              # 默认执行 pnpm lint && pnpm check 后发布
./scripts/deploy.sh --skip-checks
./scripts/deploy.sh --no-cache
```

### 4. 本地一键备份数据库

复用上述 `.env.deploy` 中的 `DEPLOY_HOST`，执行 [scripts/backup.sh](./scripts/backup.sh) 即可从远程运行中的容器拉取 SQLite 数据库（含 WAL），在本地合并为单文件并校验完整性后保存到 `~/Desktop/babylog-backups/`：

```sh
./scripts/backup.sh
./scripts/backup.sh -o /custom/backup/dir
```

## 功能计划

1. **喂养记录**：支持母乳、奶粉混合喂养和辅食，记录喂养时间、时长、奶量等信息。
2. **日常健康记录**：记录大小便、用药、体温、身高、体重、长牙等信息，支持自定义记录类型。
3. **提醒管理**：支持疫苗接种、定时用药、健康检查及自定义待办，提供每日定时主动提醒。
4. **数据看板**：首页展示喂养、排便、体温及生长发育等统计信息，以折线图等方式呈现数据趋势。
5. **多账号与多宝宝**：服务端支持多个账号，账号间数据隔离；每个账号可管理多个宝宝，同一账号支持多设备登录及数据同步。

## 技术实现要求

1. **先读规范再动手**：实施界面前阅读 [AGENTS.md](./AGENTS.md) 与 [docs/design-system.md](./docs/design-system.md)，核对本项目现有技术栈、包管理器、目录结构和 UI 实现方式；在现有结构上扩展，保留已有功能和无关改动。
2. **统一组件与 Token 体系**：Web 端基础原语统一基于 `@base-ui/react` + Tailwind CSS v4 放在 `src/components/ui/`，业务色与亮/暗双色主题以 `src/styles/tokens.css` 为单一事实来源，交互满足中文无障碍要求。
3. **完成前自检**：检查桌面端与移动端的布局适配，运行 `pnpm lint`、`pnpm check`、`pnpm test`、`pnpm build`，修复本次改动引入的问题。

## 参考文档

- Base UI：https://base-ui.com/react/overview/quick-start
- shadcn/ui：https://ui.shadcn.com/docs
- TanStack Router：https://tanstack.com/router/latest
- 设计参考项目：https://github.com/ppxb/continew-ui-next
