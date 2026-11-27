<div align="center">

<img src="./docs/assets/hero-banner.png" alt="BabyLog 温暖绘本风插画横幅" width="100%" />

<br />

<h1>
  <img src="./public/favicon.svg" alt="BabyLog 摇摇小木马 Logo" width="34" height="34" align="absmiddle" />
  &nbsp;BabyLog
</h1>

<p><strong>奶爸视角的开源自托管宝宝日常记录应用</strong></p>
<p>把喂养、睡眠、护理、健康、疫苗与生长曲线留在自己家里——单手 3 秒快录，支持多维统计与 Excel 导出，昼夜护眼不刺眼，零云端依赖。</p>

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

- **只为自家服务**：无开放注册、无广告、无数据上报，轻量部署在自己的 NAS 或小服务器上，家庭数据全部保存在本地，随时可导出 Excel 带走。
- **为真实带娃场景打磨**：鼠尾草绿与暖米白绘本调性，配合深夜护眼深色模式、手机桌面 PWA 安装、智能默认值回填、批量补录与移动端单手底部抽屉，掏出手机 3 秒记完。

---

## 界面预览

### 昼夜双色桌面看板

白天是克制温柔的**暖米白 + 鼠尾草绿**绘本画布，夜晚一键切入低眩光的**深森绿灰护眼主题**（支持跟随系统）。左侧支持多宝宝切换与分类导航，顶部提供 `⌘K` 快捷命令面板与一键记一笔；首页聚合今日喂养/睡眠/护理/健康观察概览、疫苗预约与接种后 48 小时体温观察提醒、一键直记与批量补录入口、近 7/30 日趋势曲线（直达多维统计分析）与全天照护节律。

<p align="center">
  <img src="./docs/assets/dashboard-light.png" alt="BabyLog 桌面端浅色看板" width="100%" />
  <br />
  <sub>☀️ <strong>浅色模式</strong> — 暖米白纸感画布、多宝宝切换、疫苗到期提醒、一键直记与低饱和分类色</sub>
</p>

<br />

<p align="center">
  <img src="./docs/assets/dashboard-dark.png" alt="BabyLog 桌面端深色护眼看板" width="100%" />
  <br />
  <sub>🌙 <strong>深色护眼模式</strong> — 为深夜起夜喂奶校准柔和对比度，暗光环境下同样清晰舒适</sub>
</p>

### 多维统计分析与多表 Excel 导出

独立的「统计分析」页支持按 **近 7 / 14 / 30 / 90 天** 切换查看宝宝的日均指标与长期趋势，完整拆分奶量结构（配方奶 / 瓶喂母乳）、亲喂时长与左右侧均衡度、白天小睡与夜间睡眠连续性、排尿排便频次及体温用药波动；每张图表均支持**一键保存高清 PNG 图片**，右上角可随时打开导出抽屉，按预设或自定义日期（最长 366 天）与所选分类生成带「按日汇总」及各分类明细的**多工作表 Excel（`.xlsx`）**。

<p align="center">
  <img src="./docs/assets/insights-light.png" alt="BabyLog 多维统计分析页面：周期日均摘要、每日奶量结构、睡眠昼夜结构与排尿排便趋势" width="100%" />
  <br />
  <sub>📊 <strong>多维统计分析</strong> — 7/14/30/90 天周期切换、奶量结构/睡眠昼夜/排泄多维趋势与图表一键保存高清图片</sub>
</p>

<br />

<p align="center">
  <img src="./docs/assets/export-excel-light.png" alt="BabyLog 多工作表 Excel 数据导出抽屉" width="100%" />
  <br />
  <sub>📤 <strong>多表 Excel 导出</strong> — 自由选择预设或自定义日期范围与照护分类，自动附带「按日汇总」与各分类明细工作表</sub>
</p>

### 喂养与护理批量补录

带娃忙起来顾不上实时记录、或需要对照纸质本集中补录时，可一键打开「批量补录」抽屉：在同一个时间点同时填完亲喂、瓶喂母乳、配方奶与嘘嘘/便便（同次嘘嘘+便便自动合并，未发生项留空跳过）；点击「保存并继续」自动保留日期并提供 `-3h / -2h / +2h / +3h` 快捷时间推算，顶部实时记录本次已补录批次并支持一键撤销。

<p align="center">
  <img src="./docs/assets/batch-backfill-light.png" alt="BabyLog 喂养与护理批量补录抽屉" width="100%" />
  <br />
  <sub>📋 <strong>喂养与护理批量补录</strong> — 同一时间点一次记齐多项照护、智能推算下一时间点、实时条数预览与会话内一键撤销</sub>
</p>

### 疫苗接种计划与 WHO 生长曲线

按宝宝出生日期自动生成国家免费疫苗接种计划，内置常见自费疫苗模板与自定义计划，提供接种日历、月龄时间线、常去门诊自动记住、一键批量标记已接种及 `.ics` 系统日历导出；独立的「生长发育」页支持身高、体重、头围与出牙记录，自动计算阶段增长变化、叠加 **WHO 儿童生长百分位参考区间（P3–P97 与 P50 中位线）**，并支持一键保存高清曲线图。

<p align="center">
  <img src="./docs/assets/vaccines-light.png" alt="BabyLog 疫苗接种日历与月龄接种计划" width="100%" />
  <br />
  <sub>💉 <strong>疫苗接种管理</strong> — 接种日历、下次接种倒计时与一键已接种、免费/自费进度统计及 <code>.ics</code> 日历导出</sub>
</p>

<br />

<p align="center">
  <img src="./docs/assets/growth-who-light.png" alt="BabyLog 生长发育概览与 WHO 百分位曲线" width="100%" />
  <br />
  <sub>📏 <strong>WHO 生长发育曲线</strong> — 支持体重、身高、头围切换、阶段增长对比、WHO 百分位对照与高清存图</sub>
</p>

### 多家庭独立账号与多宝宝管理

面向家庭自托管设计，无开放注册入口。管理员可在 Web 端「用户管理」为亲友家庭创建、停用或重置独立账号；每个账号可管理最多 **10 个宝宝档案**并随时在顶部/侧栏切换，各家庭数据完全隔离，管理员也无法查看其他账号的宝宝档案与记录。

<p align="center">
  <img src="./docs/assets/admin-users-light.png" alt="BabyLog 管理员用户管理与多账号隔离界面" width="100%" />
  <br />
  <sub>👨‍👩‍👧‍👦 <strong>多户多娃隔离管理</strong> — 独立家庭账号管理（正常 / 待改密 / 已停用）与跨家庭隐私严格隔离</sub>
</p>

### 移动端 PWA · 日常快录与生长免疫双三连屏

支持添加到 iOS / Android 主屏幕作为应用使用（详细步骤见 [手机桌面安装教程](./docs/mobile-install-guide.md)），完整适配安全区与底部单手导航。顶部随时切换宝宝，点击底部中央 `+` 唤起**底部滑出抽屉**，自动预填宝宝常用奶量、建议亲喂侧别与时间快捷偏移；同时在手机端完整覆盖多维统计分析、WHO 生长曲线、疫苗日历提醒与深色护眼下的多宝宝设置。

<p align="center">
  <img src="./docs/assets/mobile-showcase.png" alt="BabyLog 移动端三连屏展示：移动看板、底部单手快捷录入抽屉与分类记录列表" width="100%" />
  <br />
  <sub>📱 <strong>移动端三连屏 · 日常 3 秒快录</strong> — 多娃切换与实时看板 · 底部单手智能回填抽屉 · 分类列表按日自动汇总小计</sub>
</p>

<br />

<p align="center">
  <img src="./docs/assets/mobile-showcase-more.png" alt="BabyLog 移动端三连屏展示：WHO 生长曲线、疫苗日历与深色护眼多宝宝设置" width="100%" />
  <br />
  <sub>📱 <strong>移动端三连屏 · 生长免疫与夜间护眼</strong> — WHO 百分位生长曲线 · 疫苗接种日历与提醒 · 深色护眼多宝宝档案设置</sub>
</p>

---

## 核心亮点

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🍼 3 秒单手快录 & 批量补录</h3>
      <p>覆盖 <strong>喂养</strong>（亲喂/瓶喂母乳/配方奶/辅食）、<strong>睡眠</strong>（小睡/夜觉自动跨夜统计）、<strong>护理</strong>（尿布性状颜色/洗澡/自定义）与 <strong>健康</strong>（体温/用药）。自动记住常用奶量、亲喂侧别与常用药品；漏记时支持<strong>批量补录</strong>，同一时间点一次录完喂养与换尿布，还可连续补录与一键撤销。</p>
    </td>
    <td width="50%" valign="top">
      <h3>📊 多维统计分析 & 首页看板</h3>
      <p>首页看板实时展示宝宝月龄、距上次喂养/换尿布时长与今日汇总；独立的「统计分析」页支持 <strong>近 7 / 14 / 30 / 90 天</strong> 切换，呈现奶量结构、亲喂左右侧平衡、辅食接受度、白天小睡与夜间睡眠连续性、排便规律与体温用药趋势，直观读懂宝宝作息节律。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📏 生长发育 & WHO 生长曲线</h3>
      <p>独立的「生长发育」页支持记录身高、体重、头围与出牙里程碑，自动提示相较上次测量的增长变化与下一颗出牙参考，并叠加 <strong>WHO 儿童生长百分位参考区间（P3–P97 / P50）</strong>，清晰追踪宝宝成长轨迹。</p>
    </td>
    <td width="50%" valign="top">
      <h3>💉 疫苗接种计划 & 贴心提醒</h3>
      <p>按宝宝出生日期自动生成国家免费疫苗计划，内置常见自费疫苗模板与自定义计划；支持常去门诊自动记住、接种部位交替提示、日历与月龄时间线双视图、一键批量完成/预约、临期提醒、接种后 48 小时体温观察提示及 <code>.ics</code> 日历导出。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📤 高清存图 & 多表 Excel 导出</h3>
      <p>统计分析图表与 WHO 生长曲线均支持<strong>一键保存高清 PNG 图片</strong>（附带宝宝月龄与日期范围），方便分享给家人或儿保医生；支持按预设或自定义日期（最长 366 天）与所选分类导出<strong>多工作表 Excel（<code>.xlsx</code>）</strong>，含「按日汇总」与各分类明细，备份复盘无忧。</p>
    </td>
    <td width="50%" valign="top">
      <h3>👨‍👩‍👧‍👦 多家庭隔离 · 昼夜护眼自托管</h3>
      <p>无开放注册，支持为多个家庭创建独立账号且彼此数据完全隔离，每账号可管理最多 10 个宝宝档案；提供浅色绘本与深夜护眼深色双主题、手机桌面 PWA 安装与桌面 <code>⌘K</code> 快捷命令面板，所有数据仅存于自有设备，隐私完全自主掌控。</p>
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
# 运行在 HTTPS 反向代理之后时可设为 true，由应用直接下发 Secure 会话 Cookie
BABYLOG_COOKIE_SECURE=false
```

官方 [compose.yaml](./compose.yaml) 已配置 `pull_policy: always` 与 `stop_grace_period: 15s`。当部署 `latest`（默认）并需要更新到最新发布版本时，直接在部署目录执行单条命令即可拉取最新镜像、平滑重建容器并等待健康检查通过（数据卷内的 SQLite 数据库自动保留并按需完成迁移）：

```bash
docker compose up -d --force-recreate --wait

# 核对运行版本（启动日志与 CLI 均会输出版本号与提交哈希）
docker compose logs --tail=20 babylog
docker compose exec babylog babylog version

# 可选：清理升级后残留的旧悬空镜像
docker image prune -f
```

> 若本次更新同时涉及官方 `compose.yaml` 模板调整，建议改用上方的 `install.sh --upgrade` 一键同步模板并升级。

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

# 可选：通过 CLI 管理家庭账号（也可登录管理员后在 Web 端「用户管理」操作）
BABYLOG_DATA_DIR=/var/lib/babylog ./babylog user create --username alice --password-file /path/to/alice.pass --force-change
BABYLOG_DATA_DIR=/var/lib/babylog ./babylog user list
BABYLOG_DATA_DIR=/var/lib/babylog ./babylog user reset-password --username alice --password-file /path/to/new.pass --force-change
BABYLOG_DATA_DIR=/var/lib/babylog ./babylog user disable --username alice
BABYLOG_DATA_DIR=/var/lib/babylog ./babylog user enable --username alice

# 启动服务（默认监听 127.0.0.1:21115；HTTPS 反代部署可开启 BABYLOG_COOKIE_SECURE=true）
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

- **强制 `Secure` Cookie**：若 BabyLog 运行在 HTTPS 反向代理之后，可直接为后端设置环境变量 `BABYLOG_COOKIE_SECURE=true`（应用将直接下发带 `Secure` 标记的 `babylog_session` Cookie，不再依赖反代改写响应头），或在 Caddy/Nginx 中补齐 `Secure` 属性。
- **保留原始 `Host` 头**：所有写接口均启用 Same-Origin 校验，Caddy 默认透传 `Host`；若使用 Nginx，须显式设置 `proxy_set_header Host $http_host;`。
- **透传缓存头**：请勿在反代层覆盖后端返回的 `Cache-Control`（`/api/*` 为 `no-store`，`index.html`/`sw.js`/`manifest.webmanifest` 为 `no-cache`，`/assets/*` 为 `immutable`），以确保 iOS / Android PWA 正常更新。

</details>

<details>
<summary><strong>远程数据库一键备份（<code>scripts/backup.sh</code>）</strong></summary>

<br />

在本地克隆仓库后，在根目录创建被 `.gitignore` 忽略的 `.env.deploy`：

```sh
DEPLOY_HOST=user@your-server
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

数据写入 `data/babylog.sqlite`（已被 `.gitignore` 忽略）；设置 `BABYLOG_DATA_DIR` 可改用其他目录（例如多 worktree 共用 `~/.local/share/babylog-dev`），初始化与运行需使用同一取值。`pnpm dev` 会等待 Go 后端（经 `air` 热重载，默认 `21115` 端口）就绪后再拉起前端页面（`http://127.0.0.1:11115`）；可用 `PORT` 覆盖端口，Vite 代理同步使用该值。

- `pnpm dev:reset-db`：重置本地开发数据库并重新初始化管理员（默认放行 `./data`、`~/.local/share/*dev*` 与临时目录，拒绝在容器或生产环境执行）。
- `pnpm lint`：执行 Biome 检查、工程门禁与 `go vet`。
- `pnpm check`：执行 TypeScript 类型检查。
- `pnpm test`：执行 Go 后端单元与集成测试（`CGO_ENABLED=0`）。
- `pnpm build`：构建前端产物并内嵌打包为单二进制 `bin/babylog`。
- `pnpm start`：运行 `bin/babylog serve` 提供 UI 与 API（21115 端口）。

### 从源码构建 Docker 镜像

如需本地直接从源码构建镜像，可叠加 [compose.build.yaml](./compose.build.yaml)：

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

</details>

---

## 功能规划

- [x] 多家庭独立账号与多宝宝档案（无开放注册、各账号数据隔离、每账号最多 10 个宝宝）
- [x] 宝宝日常快录与批量补录（喂养 / 睡眠 / 护理 / 体温用药、智能默认值与连续补录）
- [x] 首页照护看板与多维统计分析（近 7 / 14 / 30 / 90 天多维趋势、全天照护节律与周期汇总）
- [x] 生长发育与出牙记录（身高 / 体重 / 头围、阶段增长对比与 WHO 百分位曲线）
- [x] 疫苗接种计划与提醒（国家免费疫苗、自费模板与自定义、日历/时间线、接种后 48h 体温观察与 `.ics` 导出）
- [x] 图表高清 PNG 存图与多工作表 Excel（`.xlsx`）按日汇总/明细导出
- [x] 手机桌面 PWA 安装、浅色/深色护眼主题与移动端单手录入适配
- [x] Docker 一键部署升级、单程序运行与本地数据备份脚本
- [ ] 更多提醒待办（定时用药、儿保体检与自定义待办）

---

## 参与贡献与安全披露

- 贡献流程、分支规范与维护者发版指南请见 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [AGENTS.md](./AGENTS.md)。
- 视觉与组件规范请见 [docs/design-system.md](./docs/design-system.md)。
- 安全漏洞请勿在公开 Issue 披露，请按 [SECURITY.md](./SECURITY.md) 通过 GitHub Security Advisories 私下报告。
- 本项目基于 [Apache-2.0](./LICENSE) 协议开源。

---

## 致谢与参考

感谢 [LINUX DO](https://linux.do) 社区温暖友善的开源氛围与真诚的技术分享，也感谢以下开源项目与设计参考给予本项目的启发：

- **LINUX DO 社区**：https://linux.do
- **Base UI**：https://base-ui.com/react/overview/quick-start
- **shadcn/ui**：https://ui.shadcn.com/docs
- **TanStack Router**：https://tanstack.com/router/latest
- **设计参考项目**：https://github.com/ppxb/continew-ui-next
