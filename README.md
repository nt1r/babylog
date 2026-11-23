# BabyLog

[![CI](https://github.com/nt1r/babylog/actions/workflows/ci.yml/badge.svg)](https://github.com/nt1r/babylog/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/nt1r/babylog?include_prereleases&label=Release)](https://github.com/nt1r/babylog/releases)
[![GHCR](https://img.shields.io/badge/GHCR-ghcr.io%2Fnt1r%2Fbabylog-blue?logo=docker)](https://github.com/nt1r/babylog/pkgs/container/babylog)
[![License](https://img.shields.io/github/license/nt1r/babylog)](./LICENSE)

奶爸视角的开源自托管宝宝日常记录应用。单一零 CGO 二进制 + SQLite 轻量运行，基于 React 19、shadcn（`base-nova`）+ `@base-ui/react` 与 Tailwind CSS v4 构建，延续温暖鼠尾草绿绘本风，支持浅色/深色护眼主题、PWA 安装与移动端单手快捷录入。

### 核心能力

- **单家庭隐私优先**：无开放注册入口，仅管理员凭 CLI 初始化登录，SQLite 本地持久化，Cookie 会话支持过期与注销失效。
- **宝宝建档与日常记录**：支持母乳/奶粉/辅食喂养、睡眠、排便、体温与生长发育等核心日常记录，新建时自动回填智能默认值。
- **数据看板与趋势洞察**：首页提供今日摘要与多日趋势图表，快速掌握喂养、作息与健康变化。
- **PWA 与移动端体验**：适配 iOS 安全区、底部快捷导航与单手录入抽屉，可添加到手机主屏幕使用。

---

## 快速自部署

### 方式一：服务器端一键安装 / 升级脚本（推荐）

要求服务器已安装 Docker Engine 与 Docker Compose v2。脚本会从 `main` 分支拉取官方 [compose.yaml](./compose.yaml) 与预构建多架构镜像（`linux/amd64`、`linux/arm64`），引导设置目录与端口，并安全交互式初始化管理员密码（不落盘明文密码文件）：

```sh
curl -fsSL https://raw.githubusercontent.com/nt1r/babylog/main/scripts/install.sh | sh
```

常用参数与平滑升级：

```sh
# 原地升级到最新版本（保留现有数据卷与 .env 配置）
curl -fsSL https://raw.githubusercontent.com/nt1r/babylog/main/scripts/install.sh | sh -s -- --upgrade

# 指定版本、安装目录或监听地址（局域网直连可用 --bind 0.0.0.0）
curl -fsSL https://raw.githubusercontent.com/nt1r/babylog/main/scripts/install.sh | sh -s -- \
  --dir /opt/babylog --version v0.1.0 --bind 127.0.0.1 --port 21115
```

> 如需先审查脚本再执行，可下载脚本或从 [GitHub Releases](https://github.com/nt1r/babylog/releases) 获取随版本发布的 `install.sh` 与 `SHA256SUMS.txt` 校验后运行。

### 方式二：手动 Docker Compose 部署

```bash
mkdir -p /opt/babylog && cd /opt/babylog
curl -fsSLO https://raw.githubusercontent.com/nt1r/babylog/main/compose.yaml

# 1. 拉取预构建镜像
docker compose pull

# 2. 首次部署：交互式初始化管理员账号（密码长度 12–1024 字符，不落盘宿主机明文文件）
read -rsp "输入 BabyLog 管理员密码: " BABYLOG_PASS; echo
printf '%s\n' "$BABYLOG_PASS" | docker compose run --rm -T --no-deps --entrypoint sh babylog -c '
  set -eu
  umask 077
  trap "rm -f /tmp/babylog-init.pass" EXIT
  cat > /tmp/babylog-init.pass
  /usr/local/bin/babylog admin init --password-file /tmp/babylog-init.pass --username admin
'
unset BABYLOG_PASS

# 3. 启动服务
docker compose up -d
```

SQLite 数据库持久化保存在 Docker 命名卷 `babylog_data`（挂载至容器内 `/data`，归属 UID `1000`）。可在同目录创建 `.env` 覆盖默认配置：

```dotenv
BABYLOG_IMAGE=ghcr.io/nt1r/babylog
BABYLOG_VERSION=latest
BABYLOG_BIND=127.0.0.1
BABYLOG_PORT=21115
```

日常升级仅需执行：

```bash
docker compose pull && docker compose up -d
```

### 方式三：GitHub Release 单二进制运行（无 Docker）

从 [GitHub Releases](https://github.com/nt1r/babylog/releases) 下载对应平台（`linux/amd64`、`linux/arm64`、`darwin/amd64`、`darwin/arm64`）的压缩包与 `SHA256SUMS.txt`：

```bash
# 校验并解压（macOS 可用 shasum -a 256 -c --ignore-missing SHA256SUMS.txt）
sha256sum -c --ignore-missing SHA256SUMS.txt
tar -xzf babylog_v0.1.0_linux_amd64.tar.gz

# 查看版本
./babylog version

# 初始化管理员（PASSWORD_FILE 须放在安全目录且权限为 0600，长度 12–1024 字符）
BABYLOG_DATA_DIR=/var/lib/babylog ./babylog admin init --password-file /path/to/init.pass --username admin

# 启动服务（默认监听 127.0.0.1:21115）
BABYLOG_DATA_DIR=/var/lib/babylog GIN_MODE=release ./babylog serve
```

---

## HTTPS 反向代理配置

默认配置仅监听 `127.0.0.1:21115`，公网部署建议通过宿主机反向代理（如 Caddy / Nginx）提供 Let's Encrypt HTTPS。

### Caddy 示例

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

### 反向代理注意事项

- **保留原始 `Host` 头**：所有写接口均启用 Same-Origin 校验，Caddy 默认透传 `Host`；若使用 Nginx，须显式设置 `proxy_set_header Host $http_host;` 与 `proxy_cookie_flags babylog_session secure;`。
- **透传缓存头**：请勿在反代层覆盖后端返回的 `Cache-Control`（`/api/*` 为 `no-store`，`index.html`/`sw.js`/`manifest.webmanifest` 为 `no-cache`，`/assets/*` 为 `immutable`），以确保 iOS / Android PWA 正常更新。

---

## 数据库备份

可在本地克隆仓库后，在根目录创建被 `.gitignore` 忽略的 `.env.deploy`：

```sh
DEPLOY_HOST=user@your-server
DEPLOY_DIR=/opt/babylog
DEPLOY_DOMAIN=baby.example.com
```

执行 [scripts/backup.sh](./scripts/backup.sh) 即可从远程运行中的容器拉取 SQLite 数据库（含 WAL 日志），在本地合并为单文件并执行 `PRAGMA integrity_check` 后保存到 `~/Desktop/babylog-backups/`：

```sh
./scripts/backup.sh
./scripts/backup.sh -o /custom/backup/dir
```

---

## 本地开发与源码构建

### 技术栈

- **前端**：React 19、Vite 8、TypeScript 7、shadcn（`base-nova`）+ `@base-ui/react`、Tailwind CSS v4、TanStack Router / Query、Zustand、Recharts；Node 26.13.1 LTS（见 `.node-version`）与 pnpm 12.21.0。已安装 NVS 时，`nvs use` 会按 `.node-version` 切换版本。
- **后端**：Go（见 `backend/go.mod`）、Gin、GORM + 零 CGO SQLite（`glebarez/sqlite` / `modernc.org/sqlite`）、`goose` 内嵌迁移、`cobra` CLI、`embed.FS` 单二进制打包。

### 开发命令

```bash
pnpm install
pnpm admin:init --password-file "$PASSWORD_FILE"
pnpm dev
```

`PASSWORD_FILE` 由操作者设置为仓库外已有的私有密码文件。密码长度须为 12–1024 字符，文件末尾仅一个 LF 或 CRLF 会被移除，其余空白原样保留。默认用户名为 `admin`，可用 `--username` 指定；重复执行初始化会拒绝覆盖已有管理员。

数据写入 `data/babylog.sqlite`（已被 `.gitignore` 忽略）；设置 `BABYLOG_DATA_DIR` 可改用其他目录，初始化与运行需使用同一取值。开发页面为 http://127.0.0.1:11115，Go 后端（经 `air` 热重载）默认监听 21115；可用 `PORT` 覆盖端口，Vite 代理同步使用该值。

- `pnpm lint`：执行 Biome 检查与 `go vet`。
- `pnpm check`：执行 TypeScript 类型检查。
- `pnpm test`：执行 Go 后端单元与集成测试（`CGO_ENABLED=0`）。
- `pnpm build`：构建前端产物并内嵌打包为单二进制 `bin/babylog`。
- `pnpm start`：运行 `bin/babylog serve` 提供 UI 与 API（21115 端口）。

### 从源码构建 Docker 镜像与远程推送

如需本地直接从源码构建镜像，可叠加 [compose.build.yaml](./compose.build.yaml)：

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

维护者也可配合上述 `.env.deploy` 使用 [scripts/deploy.sh](./scripts/deploy.sh) 完成本地检查、白名单源码同步、远程重建容器与健康验证：

```sh
./scripts/deploy.sh              # 默认执行 pnpm lint && pnpm check 后发布
./scripts/deploy.sh --skip-checks
./scripts/deploy.sh --no-cache
```

---

## 功能规划

- [x] 单管理员安全认证与 Cookie 会话管理
- [x] 宝宝建档、核心日常记录（喂养 / 睡眠 / 排便 / 体温 / 生长发育）与智能默认值
- [x] 首页数据看板与多日趋势图表
- [x] PWA 支持、浅色/深色护眼主题与移动端适配
- [x] Docker Compose / GHCR 多架构镜像、跨平台单二进制发版与一键部署/备份脚本
- [ ] 提醒管理（疫苗接种、定时用药、健康检查与自定义待办）
- [ ] 多账号与多宝宝隔离管理

---

## 参与贡献与安全披露

- 贡献流程、分支规范与维护者发版指南请见 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [AGENTS.md](./AGENTS.md)。
- 安全漏洞请勿在公开 Issue 披露，请按 [SECURITY.md](./SECURITY.md) 通过 GitHub Security Advisories 私下报告。
- 本项目基于 [Apache-2.0](./LICENSE) 协议开源。

### 参考文档

- Base UI：https://base-ui.com/react/overview/quick-start
- shadcn/ui：https://ui.shadcn.com/docs
- TanStack Router：https://tanstack.com/router/latest
- 设计参考项目：https://github.com/ppxb/continew-ui-next
