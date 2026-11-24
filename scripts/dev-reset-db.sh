#!/bin/sh
# BabyLog 本地开发数据库清空与重新初始化脚本（严禁在生产环境运行）。
#
# 用途：
#   快速清空本地开发 SQLite 数据库（data/babylog.sqlite* 与历史 backend/data/babylog.sqlite*），
#   并可选重新初始化管理员账号，便于反复测试首次建档（Onboarding）与新宝宝初始疫苗引导。
#
# 用法：
#   pnpm dev:reset-db                                   # 交互式确认清空并输入开发管理员密码重新初始化
#   pnpm dev:reset-db -- --yes --clean-only             # 仅清空开发库，不初始化管理员
#   pnpm dev:reset-db -- --yes --username admin --password-file /path/outside/repo.pass
#   BABYLOG_DEV_PASSWORD='your-12+-char-password' pnpm dev:reset-db -- --yes
#
# 生产环境防护：
#   1. 检测到 Docker 容器 (/.dockerenv)、GIN_MODE=release、NODE_ENV=production、BABYLOG_ENV=production 或 CI=true 时立即拒绝执行；
#   2. 仅允许在包含 .git、package.json 与 backend/go.mod 的本地开发源码仓库中运行；
#   3. 仅允许操作仓库内的 ./data 或 ./backend/data 目录，指向仓库外部的 BABYLOG_DATA_DIR 一律拒绝。

set -eu
umask 077

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd -P)

USERNAME="admin"
PASSWORD_FILE=""
CLEAN_ONLY=0
ASSUME_YES=0

usage() {
  cat <<'EOF'
用法：./scripts/dev-reset-db.sh [选项]

选项：
  -u, --username <name>       管理员用户名（默认：admin）
  -p, --password-file <path>  读取仓库外已有密码文件用于 admin init
      --clean-only            仅清空本地开发数据库，不重新初始化管理员
  -y, --yes                   跳过清空前的交互确认提示
  -h, --help                  显示此帮助信息

环境变量：
  BABYLOG_DEV_PASSWORD        非交互传入开发管理员密码（长度 12-1024 字符，通过临时文件传递后即删）
  BABYLOG_DATA_DIR            可选，但必须位于当前开发仓库内（默认 ./data）
EOF
}

fail() {
  printf '错误：%s\n' "$1" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    -u|--username)
      [ $# -ge 2 ] || fail "$1 需要指定用户名"
      USERNAME="$2"
      shift 2
      ;;
    -p|--password-file)
      [ $# -ge 2 ] || fail "$1 需要指定密码文件路径"
      PASSWORD_FILE="$2"
      shift 2
      ;;
    --clean-only)
      CLEAN_ONLY=1
      shift
      ;;
    -y|--yes)
      ASSUME_YES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "未知参数：$1（使用 --help 查看用法）"
      ;;
  esac
done

# ==================== 1. 严格生产环境安全拦截 ====================

if [ -f "/.dockerenv" ]; then
  fail "检测到 Docker 容器环境，禁止运行开发数据库重置脚本。"
fi

case "${GIN_MODE:-}" in
  release|RELEASE)
    fail "检测到 GIN_MODE=release，禁止在生产模式下运行开发数据库重置脚本。"
    ;;
esac

case "${NODE_ENV:-}" in
  production|PRODUCTION)
    fail "检测到 NODE_ENV=production，禁止在生产环境下运行开发数据库重置脚本。"
    ;;
esac

case "${BABYLOG_ENV:-}" in
  prod|PROD|production|PRODUCTION)
    fail "检测到 BABYLOG_ENV=${BABYLOG_ENV}，禁止在生产环境下运行开发数据库重置脚本。"
    ;;
esac

if [ "${CI:-}" = "true" ] || [ "${CI:-}" = "1" ]; then
  fail "检测到 CI 环境，禁止运行本地开发数据库重置脚本。"
fi

if [ ! -e "$REPO_ROOT/.git" ] || [ ! -f "$REPO_ROOT/package.json" ] || [ ! -f "$REPO_ROOT/backend/go.mod" ]; then
  fail "当前目录不是完整的本地开发源码仓库，已中止执行以防误删生产数据。"
fi

# 规范化目标数据目录路径，并确保严格落在仓库内部（禁止指向 /data、/var/lib/babylog 等外部路径）。
RAW_DATA_DIR="${BABYLOG_DATA_DIR:-data}"
case "$RAW_DATA_DIR" in
  /*)
    CANDIDATE_DIR="$RAW_DATA_DIR"
    ;;
  *)
    CANDIDATE_DIR="$REPO_ROOT/$RAW_DATA_DIR"
    ;;
esac

# 解析真实路径（目录尚未创建时校验父目录真实路径 + 末段名称）。
if [ -d "$CANDIDATE_DIR" ]; then
  TARGET_DATA_DIR=$(CDPATH='' cd -- "$CANDIDATE_DIR" && pwd -P)
else
  PARENT_DIR=$(dirname -- "$CANDIDATE_DIR")
  BASE_NAME=$(basename -- "$CANDIDATE_DIR")
  [ -d "$PARENT_DIR" ] || fail "数据目录父路径不存在：$PARENT_DIR"
  RESOLVED_PARENT=$(CDPATH='' cd -- "$PARENT_DIR" && pwd -P)
  TARGET_DATA_DIR="$RESOLVED_PARENT/$BASE_NAME"
fi

case "$TARGET_DATA_DIR" in
  "$REPO_ROOT/data"|"$REPO_ROOT/backend/data")
    ;;
  *)
    fail "安全限制：仅允许重置仓库内的 $REPO_ROOT/data 或 $REPO_ROOT/backend/data，拒绝操作：$TARGET_DATA_DIR"
    ;;
esac

# ==================== 2. 二次确认与安全清理 ====================

printf '即将清空本地开发数据库：\n'
printf '  - %s/babylog.sqlite*\n' "$TARGET_DATA_DIR"
if [ "$TARGET_DATA_DIR" = "$REPO_ROOT/data" ] && [ -e "$REPO_ROOT/backend/data/babylog.sqlite" ]; then
  printf '  - %s/backend/data/babylog.sqlite*（历史遗留）\n' "$REPO_ROOT"
fi
if [ "$CLEAN_ONLY" -eq 0 ]; then
  printf '随后将以用户名 "%s" 重新初始化本地开发管理员账号。\n' "$USERNAME"
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  if [ ! -t 0 ]; then
    fail "非交互终端请显式传入 --yes 确认重置本地开发数据库。"
  fi
  printf '确认继续？[y/N] '
  IFS= read -r ANSWER
  case "$ANSWER" in
    y|Y|yes|YES)
      ;;
    *)
      printf '已取消操作。\n'
      exit 0
      ;;
  esac
fi

clean_sqlite_dir() {
  dir="$1"
  rm -f "$dir/babylog.sqlite" "$dir/babylog.sqlite-wal" "$dir/babylog.sqlite-shm"
}

clean_sqlite_dir "$TARGET_DATA_DIR"
if [ "$TARGET_DATA_DIR" = "$REPO_ROOT/data" ]; then
  clean_sqlite_dir "$REPO_ROOT/backend/data"
fi
printf '已清空本地开发 SQLite 数据库文件。\n'

if [ "$CLEAN_ONLY" -eq 1 ]; then
  printf '提示：使用 pnpm admin:init --password-file <仓库外密码文件> 可重新初始化管理员。\n'
  exit 0
fi

# ==================== 3. 重新初始化开发管理员（绝不落盘密码到仓库内） ====================

TMP_PASS_FILE=""
TTY_ECHO_OFF=0
cleanup() {
  if [ "$TTY_ECHO_OFF" -eq 1 ]; then
    stty echo 2>/dev/null || true
    TTY_ECHO_OFF=0
  fi
  if [ -n "$TMP_PASS_FILE" ] && [ -f "$TMP_PASS_FILE" ]; then
    rm -f "$TMP_PASS_FILE"
  fi
}
trap cleanup EXIT INT TERM

INIT_PASS_FILE=""
if [ -n "$PASSWORD_FILE" ]; then
  [ -f "$PASSWORD_FILE" ] || fail "指定的密码文件不存在：$PASSWORD_FILE"
  # 先按调用方当前工作目录解析为绝对路径，避免后续切到 backend/ 目录后相对路径失效。
  PASS_DIR=$(cd "$(dirname "$PASSWORD_FILE")" && pwd)
  INIT_PASS_FILE="$PASS_DIR/$(basename "$PASSWORD_FILE")"
else
  PASS_VALUE="${BABYLOG_DEV_PASSWORD:-}"
  if [ -z "$PASS_VALUE" ]; then
    if [ ! -t 0 ]; then
      fail "未提供密码：请使用 --password-file、环境变量 BABYLOG_DEV_PASSWORD 或交互终端输入。"
    fi
    printf '请输入新的本地开发管理员密码（12-1024 位，输入不回显）：'
    stty -echo
    TTY_ECHO_OFF=1
    IFS= read -r PASS_VALUE || { stty echo; TTY_ECHO_OFF=0; printf '\n'; fail "读取密码失败"; }
    stty echo
    TTY_ECHO_OFF=0
    printf '\n'
  fi
  [ "${#PASS_VALUE}" -ge 12 ] || fail "管理员密码长度至少需要 12 个字符。"

  TMP_PASS_FILE=$(mktemp "${TMPDIR:-/tmp}/babylog-dev-init.XXXXXX")
  chmod 600 "$TMP_PASS_FILE"
  printf '%s\n' "$PASS_VALUE" > "$TMP_PASS_FILE"
  unset PASS_VALUE
  INIT_PASS_FILE="$TMP_PASS_FILE"
fi

printf '正在初始化开发数据库与管理员账号 "%s"...\n' "$USERNAME"
(
  cd "$REPO_ROOT/backend"
  CGO_ENABLED=0 BABYLOG_WORK_DIR="$REPO_ROOT" BABYLOG_DATA_DIR="$TARGET_DATA_DIR" \
    go run ./cmd/babylog admin init --username "$USERNAME" --password-file "$INIT_PASS_FILE"
)

printf '\n本地开发数据库重置完成！\n'
printf '若 pnpm dev 正在运行，请重启后端（或重新运行 pnpm dev）并刷新浏览器重新登录，即可从首次宝宝建档开始体验。\n'
