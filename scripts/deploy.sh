#!/bin/sh
# BabyLog 一键部署脚本（POSIX sh）：
# 将本地代码同步到远程服务器并执行 Docker Compose 重建与健康检查。
#
# 用法：
#   ./scripts/deploy.sh [--skip-checks] [--no-cache]
#
# 配置方式（命令行环境变量优先，其次读取仓库根目录被 git 忽略的 .env.deploy）：
#   DEPLOY_HOST=debian@your-server-ip
#   DEPLOY_DIR=/opt/babylog
#   DEPLOY_DOMAIN=baby.example.com   # 可选，配置后会校验 HTTPS 返回 200

set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)

# 保存显式传入的环境变量，避免被 .env.deploy 覆盖
CLI_DEPLOY_HOST="${DEPLOY_HOST:-}"
CLI_DEPLOY_DIR="${DEPLOY_DIR:-}"
CLI_DEPLOY_DOMAIN="${DEPLOY_DOMAIN:-}"

if [ -f "$REPO_ROOT/.env.deploy" ]; then
  # shellcheck source=/dev/null
  . "$REPO_ROOT/.env.deploy"
fi

[ -n "$CLI_DEPLOY_HOST" ] && DEPLOY_HOST="$CLI_DEPLOY_HOST"
[ -n "$CLI_DEPLOY_DIR" ] && DEPLOY_DIR="$CLI_DEPLOY_DIR"
[ -n "$CLI_DEPLOY_DOMAIN" ] && DEPLOY_DOMAIN="$CLI_DEPLOY_DOMAIN"

DEPLOY_DIR="${DEPLOY_DIR:-/opt/babylog}"
DEPLOY_DOMAIN="${DEPLOY_DOMAIN:-}"

SKIP_CHECKS=0
NO_CACHE=0

usage() {
  cat <<'EOF'
用法: ./scripts/deploy.sh [选项]

选项:
  --skip-checks   跳过本地 pnpm lint 与 pnpm check 检查
  --no-cache      构建 Docker 镜像时禁用缓存
  -h, --help      显示此帮助信息

环境变量（也可写入仓库根目录的 .env.deploy，已被 .gitignore 忽略）:
  DEPLOY_HOST     必填，SSH 目标，例如 debian@1.2.3.4
  DEPLOY_DIR      可选，远程部署目录（须为至少两级绝对路径），默认 /opt/babylog
  DEPLOY_DOMAIN   可选，线上域名，用于部署后校验 HTTPS 返回 200 与 sw.js 版本
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-checks)
      SKIP_CHECKS=1
      ;;
    --no-cache)
      NO_CACHE=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf '未知参数: %s\n\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if [ -z "${DEPLOY_HOST:-}" ]; then
  printf '错误: 未设置 DEPLOY_HOST（可通过环境变量或在 .env.deploy 中配置）\n' >&2
  exit 1
fi

# 限制 DEPLOY_DIR 为至少两级绝对路径且不含空白、.. 或 shell 元字符，避免误删系统目录
case "$DEPLOY_DIR" in
  /*/*)
    ;;
  *)
    printf '错误: DEPLOY_DIR 必须为至少两级的绝对路径（例如 /opt/babylog），当前值: %s\n' "$DEPLOY_DIR" >&2
    exit 1
    ;;
esac
case "$DEPLOY_DIR" in
  */|*/..|*/../*|*[[:space:]\'\"\`\$\;\|\&\<\>\(\)]*)
    printf '错误: DEPLOY_DIR 包含非法字符或相对路径段: %s\n' "$DEPLOY_DIR" >&2
    exit 1
    ;;
esac

# 校验可选域名格式，防止拼接到远程参数时发生注入
if [ -n "$DEPLOY_DOMAIN" ]; then
  case "$DEPLOY_DOMAIN" in
    -*|.*|*-|*.|*[!A-Za-z0-9.-]*)
      printf '错误: DEPLOY_DOMAIN 不是有效的域名: %s\n' "$DEPLOY_DOMAIN" >&2
      exit 1
      ;;
  esac
fi

cd "$REPO_ROOT"

if [ "$SKIP_CHECKS" -eq 0 ]; then
  printf '==> [1/4] 运行本地代码检查 (pnpm lint && pnpm check)...\n'
  pnpm lint
  pnpm check
else
  printf '==> [1/4] 已跳过本地代码检查\n'
fi

printf '==> [2/4] 同步代码至 %s:%s ...\n' "$DEPLOY_HOST" "$DEPLOY_DIR"
# 采用白名单打包构建与运行所需的源码文件，避免把 .env*、data/、.git/、本地临时文件同步到服务器，
# 同时避免 BSD tar 的 --exclude 模式误伤 src/scripts 等嵌套子目录；
# COPYFILE_DISABLE=1 防止 macOS 生成 ._* 扩展属性文件。
# 远端先解压至临时暂存目录（GNU tar 忽略 macOS PAX 扩展头告警），再清空旧代码（严格保留 data/ 与 .env）后覆盖。
COPYFILE_DISABLE=1 tar \
  --exclude='node_modules' \
  --exclude='.DS_Store' \
  --exclude='._*' \
  --exclude='backend/tmp' \
  --exclude='backend/internal/webui/dist/*' \
  --exclude='*.sqlite' \
  --exclude='*.sqlite-shm' \
  --exclude='*.sqlite-wal' \
  --exclude='*.tsbuildinfo' \
  -czf - \
  Dockerfile \
  .dockerignore \
  compose.yaml \
  compose.build.yaml \
  package.json \
  pnpm-lock.yaml \
  tsconfig.json \
  vite.config.ts \
  index.html \
  public \
  src \
  backend | ssh -o BatchMode=yes "$DEPLOY_HOST" "set -eu
STAGE_DIR=\"/tmp/babylog-stage-\$\$\"
trap 'rm -rf \"\$STAGE_DIR\"' EXIT
mkdir -p \"\$STAGE_DIR\" '$DEPLOY_DIR'
if tar --version 2>/dev/null | grep -qi gnu; then
  tar --warning=no-unknown-keyword -xzf - -C \"\$STAGE_DIR\"
else
  tar -xzf - -C \"\$STAGE_DIR\"
fi
find '$DEPLOY_DIR' -mindepth 1 -maxdepth 1 ! -name data ! -name .env -exec rm -rf {} +
cp -a \"\$STAGE_DIR\"/. '$DEPLOY_DIR'/"

printf '==> [3/4] 在服务器上重建并重启容器...\n'
BUILD_FLAG=""
if [ "$NO_CACHE" -eq 1 ]; then
  BUILD_FLAG="--no-cache"
fi
BUILD_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || printf 'unknown')
BUILD_DATE=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

ssh -o BatchMode=yes "$DEPLOY_HOST" "sh -s -- '$DEPLOY_DIR' '$BUILD_FLAG' '$BUILD_COMMIT' '$BUILD_DATE'" <<'REMOTE_DEPLOY'
set -eu
DEPLOY_DIR="$1"
BUILD_FLAG="$2"
export BABYLOG_COMMIT="$3"
export BABYLOG_BUILD_DATE="$4"
cd "$DEPLOY_DIR"

# 叠加 compose.build.yaml 在服务端源码构建本地镜像（覆盖默认拉取预构建镜像）。
if [ -n "$BUILD_FLAG" ]; then
  docker compose -f compose.yaml -f compose.build.yaml build "$BUILD_FLAG"
else
  docker compose -f compose.yaml -f compose.build.yaml build
fi

docker compose -f compose.yaml -f compose.build.yaml up -d --wait
docker compose -f compose.yaml -f compose.build.yaml ps
REMOTE_DEPLOY

printf '==> [4/4] 验证线上服务状态...\n'
ssh -o BatchMode=yes "$DEPLOY_HOST" "sh -s -- '$DEPLOY_DOMAIN'" <<'REMOTE_VERIFY'
set -eu
DEPLOY_DOMAIN="$1"

printf '本地容器健康检查: '
curl -fsS http://127.0.0.1:21115/api/auth/session
printf '\n'

SW_VER=$(curl -fsS http://127.0.0.1:21115/sw.js | grep -m1 'CACHE_NAME' || true)
[ -n "$SW_VER" ] && printf '当前前端 SW 版本: %s\n' "$SW_VER"

if [ -n "$DEPLOY_DOMAIN" ]; then
  HTTPS_CODE=$(curl -sS -o /dev/null -w '%{http_code}' "https://${DEPLOY_DOMAIN}/api/auth/session" || echo "000")
  printf 'HTTPS 验证 (https://%s): HTTP %s\n' "$DEPLOY_DOMAIN" "$HTTPS_CODE"
  if [ "$HTTPS_CODE" != "200" ]; then
    printf '错误: HTTPS 验证失败，预期 HTTP 200，实际 HTTP %s\n' "$HTTPS_CODE" >&2
    exit 1
  fi
fi
REMOTE_VERIFY

printf '==> 部署完成！\n'
