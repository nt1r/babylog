<div align="center">

<img src="./docs/assets/hero-banner.png" alt="BabyLog 温暖绘本风插画横幅" width="100%" />

<br />

<h1>
  <img src="./public/favicon.svg" alt="BabyLog 摇摇小木马 Logo" width="34" height="34" align="absmiddle" />
  &nbsp;BabyLog
</h1>

<p><strong>奶爸视角的开源自托管宝宝日常记录应用</strong></p>
<p>把喂养、睡眠、护理与健康点滴留在自己家里——单手 3 秒记完，昼夜护眼不刺眼，零云端依赖。</p>

<p>
  <a href="https://github.com/nt1r/babylog/actions/workflows/ci.yml"><img src="https://github.com/nt1r/babylog/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/nt1r/babylog/releases"><img src="https://img.shields.io/github/v/release/nt1r/babylog?include_prereleases&label=Release" alt="Release" /></a>
  <a href="https://github.com/nt1r/babylog/pkgs/container/babylog"><img src="https://img.shields.io/badge/GHCR-ghcr.io%2Fnt1r%2Fbabylog-247568?logo=docker&logoColor=white" alt="GHCR" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/nt1r/babylog?color=4c8c7e" alt="License" /></a>
</p>

<p>
  <a href="#界面预览">界面预览</a> ·
  <a href="#核心亮点">核心亮点</a> ·
  <a href="#快速自部署">快速自部署</a> ·
  <a href="#进阶运维与反代配置">反代与备份</a> ·
  <a href="#本地开发与源码构建">本地开发</a> ·
  <a href="#功能规划">功能规划</a>
</p>

</div>

---

## 为什么做 BabyLog？

深夜两点，一只手抱着刚喝完奶的宝宝，另一只手想快速记下「配方奶 140 ml」——却被刺眼的白底弹窗、开屏广告和繁琐表单劝退；更不想把宝宝每天的吃喝拉撒、体温和生长数据交给来路不明的商业云端。

**BabyLog** 由此诞生：

- **只为自家服务**：无开放注册、无广告、无数据上报，单一零 CGO Go 二进制 + SQLite 轻量运行，家庭数据牢牢掌握在自己的 NAS 或小服务器上。
- **为真实带娃场景打磨**：鼠尾草绿与暖米白绘本调性，配合深夜护眼深色模式、PWA 桌面安装、智能默认值回填与移动端单手底部抽屉，真正做到掏出手机 3 秒记完。

---

## 界面预览

### 昼夜双色桌面看板

白天是克制温柔的**暖米白 + 鼠尾草绿**绘本画布，夜晚一键切入低眩光的**深森绿灰护眼主题**（支持跟随系统、首屏无闪烁）。顶部一键直记高频动作，下方聚合今日 KPI、近 7/14 日成长趋势曲线与全天照护节律。

<p align="center">
  <img src="./docs/assets/dashboard-light.png" alt="BabyLog 桌面端浅色看板" width="100%" />
  <br />
  <sub>☀️ <strong>浅色模式</strong> — 暖米白纸感画布与低饱和分类色（暖蜜黄喂养 / 柔薄荷睡眠 / 暖蜜桃健康 / 柔木棕护理）</sub>
</p>

<br />

<p align="center">
  <img src="./docs/assets/dashboard-dark.png" alt="BabyLog 桌面端深色护眼看板" width="100%" />
  <br />
  <sub>🌙 <strong>深色护眼模式</strong> — 为深夜起夜喂奶校准柔和对比度，暗光环境下同样清晰舒适</sub>
</p>

### 移动端 PWA 与单手快捷录入

支持添加到 iOS / Android 主屏幕作为 PWA 使用，完整适配安全区与底部 5 槽位单手导航。点击底部中央 `+` 唤起**底部滑出抽屉**，自动预填宝宝常用奶量、建议亲喂侧别与时间快捷偏移，列表页自动按本地自然日汇总小计。

<p align="center">
  <img src="./docs/assets/mobile-showcase.png" alt="BabyLog 移动端三连屏展示：移动看板、底部单手快捷录入抽屉与分类记录列表" width="100%" />
  <br />
  <sub>📱 <strong>移动端三连屏</strong> — 首页实时概览 · 底部单手 3 秒快录 · 分类筛选与按日汇总小计</sub>
</p>

---

## 核心亮点

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🍼 3 秒单手快录 & 智能回填</h3>
      <p>覆盖 <strong>喂养</strong>（亲喂/瓶喂母乳/配方奶/辅食）、<strong>睡眠</strong>（小睡/夜觉跨夜切分）、<strong>护理</strong>（尿布性状颜色/洗澡/自定义）与 <strong>健康生长</strong>（体温/用药/身高体重头围/出牙）。自动记住常用奶量、上次亲喂侧别与常用药品，配合「一键直记」与时间偏移按钮大幅减少输入。</p>
    </td>
    <td width="50%" valign="top">
      <h3>📈 趋势洞察与照护节律</h3>
      <p>首页看板实时计算宝宝月龄与天数、距上次喂养/换尿布时长与今日汇总；提供 7/14 日奶量、亲喂时长、睡眠时长趋势图以及清晨/上午/下午/傍晚/夜间 5 时段照护分布，一眼看清作息规律。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🔒 单家庭隐私与安全基线</h3>
      <p>无开放注册入口，管理员凭 CLI 从仓库外密码文件初始化；采用加盐 <code>scrypt</code> 派生与常量时间比较、<code>HttpOnly; SameSite=Strict</code> Cookie 会话与写接口 Same-Origin 校验，所有数据仅存于本地 SQLite。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🪶 零 CGO 单二进制 · 极简部署</h3>
      <p>后端使用 Go + 零 CGO SQLite（<code>modernc.org/sqlite</code>）并将前端静态资源通过 <code>embed.FS</code> 内嵌为单个可执行文件；同时提供多架构 GHCR Docker 镜像、一键安装/升级脚本与远程 SQLite 备份脚本。</p>
    </td>
  </tr>
</table>

---

## 快速自部署

### 一键安装 / 升级脚本（推荐）

要求服务器已安装 **Docker Engine** 与 **Docker Compose v2**。脚本会从 `main` 分支拉取官方 [compose.yaml](./compose.yaml) 与预构建多架构镜像（`linux/amd64`、`linux/arm64`），引导配置目录与端口，并安全交互式初始化管理员密码（不落盘宿主机明文密码文件）：

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

<details>
<summary><strong>方式二：手动 Docker Compose 部署</strong></summary>

<br />

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

</details>

<details>
<summary><strong>方式三：GitHub Release 单二进制运行（无 Docker）</strong></summary>

<br />

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

</details>

---

## 进阶运维与反代配置

默认配置仅监听 `127.0.0.1:21115`，公网访问建议通过宿主机反向代理启用 HTTPS，并定期备份本地 SQLite 数据。

<details>
<summary><strong>HTTPS 反向代理配置（Caddy / Nginx）</strong></summary>

<br />

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

</details>

<details>
<summary><strong>远程数据库一键备份（<code>scripts/backup.sh</code>）</strong></summary>

<br />

在本地克隆仓库后，在根目录创建被 `.gitignore` 忽略的 `.env.deploy`：

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

</details>

---

## 本地开发与源码构建

<details>
<summary><strong>查看技术栈、本地开发命令与源码构建 Docker 镜像说明</strong></summary>

<br />

### 技术栈

- **前端**：React 19、Vite 8、TypeScript 7、shadcn（`base-nova`）+ `@base-ui/react`、Tailwind CSS v4、TanStack Router / Query、Zustand、Recharts；Node 26.13.1 LTS（见 [.node-version](./.node-version)）与 pnpm 12.21.0。已安装 NVS 时，`nvs use` 会按 `.node-version` 切换版本。
- **后端**：Go（见 [backend/go.mod](./backend/go.mod)）、Gin、GORM + 零 CGO SQLite（`glebarez/sqlite` / `modernc.org/sqlite`）、`goose` 内嵌迁移、`cobra` CLI、`embed.FS` 单二进制打包。

### 开发命令

```bash
pnpm install
pnpm admin:init --password-file "$PASSWORD_FILE"
pnpm dev
```

`PASSWORD_FILE` 由操作者设置为仓库外已有的私有密码文件。密码长度须为 12–1024 字符，文件末尾仅一个 LF 或 CRLF 会被移除，其余空白原样保留。默认用户名为 `admin`，可用 `--username` 指定；重复执行初始化会拒绝覆盖已有管理员。

数据写入 `data/babylog.sqlite`（已被 `.gitignore` 忽略）；设置 `BABYLOG_DATA_DIR` 可改用其他目录，初始化与运行需使用同一取值。开发页面为 `http://127.0.0.1:11115`，Go 后端（经 `air` 热重载）默认监听 `21115`；可用 `PORT` 覆盖端口，Vite 代理同步使用该值。

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

</details>

---

## 功能规划

- [x] 单管理员安全认证与 Cookie 会话管理
- [x] 宝宝建档、核心日常记录（喂养 / 睡眠 / 排便 / 体温 / 生长发育）与智能默认值
- [x] 首页数据看板、近 7/14 日趋势图表与全天照护节律
- [x] PWA 支持、浅色/深色护眼主题与移动端单手录入适配
- [x] Docker Compose / GHCR 多架构镜像、跨平台单二进制发版与一键部署/备份脚本
- [ ] 提醒管理（疫苗接种、定时用药、健康检查与自定义待办）
- [ ] 多账号与多宝宝隔离管理

---

## 参与贡献与安全披露

- 贡献流程、分支规范与维护者发版指南请见 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [AGENTS.md](./AGENTS.md)。
- 视觉与组件规范请见 [docs/design-system.md](./docs/design-system.md)。
- 安全漏洞请勿在公开 Issue 披露，请按 [SECURITY.md](./SECURITY.md) 通过 GitHub Security Advisories 私下报告。
- 本项目基于 [Apache-2.0](./LICENSE) 协议开源。

<details>
<summary><strong>参考文档与致谢</strong></summary>

- Base UI：https://base-ui.com/react/overview/quick-start
- shadcn/ui：https://ui.shadcn.com/docs
- TanStack Router：https://tanstack.com/router/latest
- 设计参考项目：https://github.com/ppxb/continew-ui-next

</details>
