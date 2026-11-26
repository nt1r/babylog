#!/bin/sh
# BabyLog 本地开发数据库清空与重新初始化脚本（严禁在生产环境运行）。
#
# 用途：
#   快速清空本地开发 SQLite 数据库（babylog.sqlite*），
#   并可选重新初始化管理员账号，便于反复测试首次建档（Onboarding）与新宝宝初始疫苗引导。
#
# 用法：
#   pnpm dev:reset-db                                   # 交互式确认清空并输入开发管理员密码重新初始化
#   pnpm dev:reset-db -- --yes --clean-only             # 仅清空开发库，不初始化管理员
#   pnpm dev:reset-db -- --yes --username admin --password-file /path/outside/repo.pass
#   BABYLOG_DATA_DIR=~/.local/share/babylog-dev pnpm dev:reset-db
#   BABYLOG_DEV_PASSWORD='your-12+-char-password' pnpm dev:reset-db -- --yes
#
# 生产环境防护：
#   1. 检测到 Docker 容器 (/.dockerenv)、GIN_MODE=release、NODE_ENV=production、BABYLOG_ENV=production 或 CI=true 时立即拒绝执行；
#   2. 仅允许在包含 .git、package.json 与 backend/go.mod 的本地开发源码仓库中运行；
#   3. 始终禁止操作 /data、/var/lib/*、/srv/*、/opt/*、/etc/* 等系统与生产路径；
#   4. 默认放行仓库内 ./data、XDG 数据目录（~/.local/share）下含 dev/tmp/test 标识的目录及系统临时目录；
#      其他自定义仓库外路径须显式传入 --allow-external-dir。

set -eu
umask 077

CALLER_PWD=$(pwd -P)
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd -P)

USERNAME="admin"
PASSWORD_FILE=""
CLEAN_ONLY=0
ASSUME_YES=0
ALLOW_EXTERNAL_DIR=0

usage() {
  cat <<'EOF'
用法：./scripts/dev-reset-db.sh [选项]

选项：
  -u, --username <name>       管理员用户名（默认：admin）
  -p, --password-file <path>  读取仓库外已有密码文件用于 admin init
      --clean-only            仅清空本地开发数据库，不重新初始化管理员
      --allow-external-dir    显式允许重置默认白名单之外的本地仓库外目录（仍禁止系统/生产路径）
  -y, --yes                   跳过清空前的交互确认提示
  -h, --help                  显示此帮助信息

环境变量：
  BABYLOG_DEV_PASSWORD        非交互传入开发管理员密码（长度 12-1024 字符，通过临时文件传递后即删）
  BABYLOG_DATA_DIR            目标开发数据目录（默认 ./data；默认支持 ~/.local/share/*dev* 与临时目录）
EOF
}

fail() {
  printf '错误：%s\n' "$1" >&2
  exit 1
}

# 将可能尚未创建的路径规范化为真实绝对路径：向上回溯到首个存在的祖先目录解析符号链接，再拼接剩余末段。
resolve_target_path() {
  target="$1"
  suffix=""
  cur="$target"

  while [ ! -d "$cur" ]; do
    base=$(basename -- "$cur")
    parent=$(dirname -- "$cur")
    case "$base" in
      ''|'.'|'..')
        fail "数据目录路径包含非法段：$target"
        ;;
    esac
    if [ -z "$suffix" ]; then
      suffix="$base"
    else
      suffix="$base/$suffix"
    fi
    [ "$parent" != "$cur" ] || fail "无法解析数据目录路径：$target"
    cur="$parent"
  done

  resolved_base=$(CDPATH='' cd -- "$cur" && pwd -P)
  if [ -z "$suffix" ]; then
    printf '%s\n' "$resolved_base"
  elif [ "$resolved_base" = "/" ]; then
    printf '/%s\n' "$suffix"
  else
    printf '%s/%s\n' "$resolved_base" "$suffix"
  fi
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
    --allow-external-dir)
      ALLOW_EXTERNAL_DIR=1
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

# 规范化目标数据目录路径：未设置时默认仓库根目录 ./data，显式传入相对路径时基于调用方工作目录解析。
if [ -z "${BABYLOG_DATA_DIR:-}" ]; then
  CANDIDATE_DIR="$REPO_ROOT/data"
else
  RAW_DATA_DIR="$BABYLOG_DATA_DIR"
  # shellcheck disable=SC2088
  case "$RAW_DATA_DIR" in
    "~")
      [ -n "${HOME:-}" ] || fail "无法展开 ~：HOME 环境变量未设置。"
      CANDIDATE_DIR="$HOME"
      ;;
    "~/"*)
      [ -n "${HOME:-}" ] || fail "无法展开 ~：HOME 环境变量未设置。"
      CANDIDATE_DIR="$HOME/${RAW_DATA_DIR#"~/"}"
      ;;
    /*)
      CANDIDATE_DIR="$RAW_DATA_DIR"
      ;;
    *)
      CANDIDATE_DIR="$CALLER_PWD/$RAW_DATA_DIR"
      ;;
  esac
fi

TARGET_DATA_DIR=$(resolve_target_path "$CANDIDATE_DIR")

# 始终禁止系统级、生产常见路径以及仓库根/用户主目录本身（即使传入 --allow-external-dir 也不放行）。
case "$TARGET_DATA_DIR" in
  "/"|"/data"|"/data/"*|"/var/lib"|"/var/lib/"*|"/private/var/lib"|"/private/var/lib/"*|"/srv"|"/srv/"*|"/opt"|"/opt/"*|"/etc"|"/etc/"*|"/private/etc"|"/private/etc/"*|"/usr"|"/usr/"*|"/bin"|"/bin/"*|"/sbin"|"/sbin/"*|"/System"|"/System/"*|"/Library"|"/Library/"*|"$REPO_ROOT")
    fail "安全限制：禁止操作高风险系统或生产目录：$TARGET_DATA_DIR"
    ;;
esac

if [ -n "${HOME:-}" ]; then
  RESOLVED_HOME=$(resolve_target_path "$HOME")
  if [ "$TARGET_DATA_DIR" = "$RESOLVED_HOME" ]; then
    fail "安全限制：禁止直接将用户主目录作为数据目录：$TARGET_DATA_DIR"
  fi
fi

# 判断是否属于默认放行的本地开发目录：
#   1) 当前仓库的 $REPO_ROOT/data
#   2) 系统临时目录（$TMPDIR 或 /tmp）下的子目录
#   3) XDG 数据目录（$XDG_DATA_HOME 或 $HOME/.local/share）下名称含 dev/tmp/test 标识的子目录
is_default_dev_dir() {
  dir="$1"
  if [ "$dir" = "$REPO_ROOT/data" ]; then
    return 0
  fi

  for tmp_base in "${TMPDIR:-}" "/tmp"; do
    [ -n "$tmp_base" ] || continue
    resolved_tmp=$(resolve_target_path "$tmp_base")
    case "$dir" in
      "$resolved_tmp/"*)
        return 0
        ;;
    esac
  done

  base_lower=$(basename -- "$dir" | tr '[:upper:]' '[:lower:]')
  case "$base_lower" in
    *dev*|*tmp*|*test*)
      for xdg_base in "${XDG_DATA_HOME:-}" "${HOME:+$HOME/.local/share}"; do
        [ -n "$xdg_base" ] || continue
        resolved_xdg=$(resolve_target_path "$xdg_base")
        case "$dir" in
          "$resolved_xdg/"*)
            return 0
            ;;
        esac
      done
      ;;
  esac

  return 1
}

if ! is_default_dev_dir "$TARGET_DATA_DIR"; then
  if [ "$ALLOW_EXTERNAL_DIR" -ne 1 ]; then
    fail "安全限制：$TARGET_DATA_DIR 不在默认开发目录白名单内（$REPO_ROOT/data、~/.local/share/*dev* 或系统临时目录）。如确认是本地开发目录，请追加 --allow-external-dir。"
  fi
fi

# ==================== 2. 静态参数预检（在确认与删库前先拦截明显错误） ====================

INIT_PASS_FILE=""
if [ "$CLEAN_ONLY" -eq 0 ]; then
  [ "${#USERNAME}" -ge 1 ] && [ "${#USERNAME}" -le 128 ] || fail "管理员用户名长度必须在 1 至 128 个字符之间。"
  case "$USERNAME" in
    [[:space:]]*|*[[:space:]])
      fail "管理员用户名首尾不能包含空白字符。"
      ;;
  esac

  if [ -n "$PASSWORD_FILE" ]; then
    [ -f "$PASSWORD_FILE" ] || fail "指定的密码文件不存在：$PASSWORD_FILE"
    [ -r "$PASSWORD_FILE" ] || fail "指定的密码文件不可读：$PASSWORD_FILE"
    # 先按调用方当前工作目录解析为绝对路径，避免后续切到 backend/ 目录后相对路径失效。
    PASS_DIR=$(CDPATH='' cd -- "$(dirname -- "$PASSWORD_FILE")" && pwd -P)
    INIT_PASS_FILE="$PASS_DIR/$(basename -- "$PASSWORD_FILE")"
  elif [ -n "${BABYLOG_DEV_PASSWORD:-}" ]; then
    [ "${#BABYLOG_DEV_PASSWORD}" -ge 12 ] && [ "${#BABYLOG_DEV_PASSWORD}" -le 1024 ] ||
      fail "管理员密码长度必须在 12 至 1024 个字符之间。"
  elif [ ! -t 0 ]; then
    fail "未提供密码：请使用 --password-file、环境变量 BABYLOG_DEV_PASSWORD 或交互终端输入。"
  fi
fi

# ==================== 3. 二次确认（先展示目标目录确认，再读取交互密码） ====================

printf '即将清空本地开发数据库：\n'
printf '  - %s/babylog.sqlite*\n' "$TARGET_DATA_DIR"
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

# ==================== 4. 准备临时密码文件（仍在 rm -f 之前完成，输错或 Ctrl+C 不删旧库） ====================

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
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

if [ "$CLEAN_ONLY" -eq 0 ] && [ -z "$INIT_PASS_FILE" ]; then
  PASS_VALUE="${BABYLOG_DEV_PASSWORD:-}"
  if [ -z "$PASS_VALUE" ]; then
    printf '请输入新的本地开发管理员密码（12-1024 位，输入不回显）：'
    stty -echo
    TTY_ECHO_OFF=1
    IFS= read -r PASS_VALUE || { stty echo; TTY_ECHO_OFF=0; printf '\n'; fail "读取密码失败"; }
    stty echo
    TTY_ECHO_OFF=0
    printf '\n'
    [ "${#PASS_VALUE}" -ge 12 ] && [ "${#PASS_VALUE}" -le 1024 ] ||
      fail "管理员密码长度必须在 12 至 1024 个字符之间。"
  fi

  TMP_BASE="${TMPDIR:-/tmp}"
  TMP_BASE="${TMP_BASE%/}"
  TMP_PASS_FILE=$(mktemp "${TMP_BASE:-/tmp}/babylog-dev-init.XXXXXX")
  chmod 600 "$TMP_PASS_FILE"
  printf '%s\n' "$PASS_VALUE" > "$TMP_PASS_FILE"
  unset PASS_VALUE
  INIT_PASS_FILE="$TMP_PASS_FILE"
fi

# ==================== 5. 清理并重新初始化 ====================

if [ -d "$TARGET_DATA_DIR" ]; then
  rm -f "$TARGET_DATA_DIR/babylog.sqlite" "$TARGET_DATA_DIR/babylog.sqlite-wal" "$TARGET_DATA_DIR/babylog.sqlite-shm"
fi
printf '已清空本地开发 SQLite 数据库文件。\n'

if [ "$CLEAN_ONLY" -eq 1 ]; then
  printf '提示：使用 BABYLOG_DATA_DIR=%s pnpm admin:init -- --password-file <仓库外密码文件> 可重新初始化管理员。\n' "$TARGET_DATA_DIR"
  exit 0
fi

printf '正在初始化开发数据库与管理员账号 "%s"...\n' "$USERNAME"
(
  cd "$REPO_ROOT/backend"
  CGO_ENABLED=0 BABYLOG_WORK_DIR="$REPO_ROOT" BABYLOG_DATA_DIR="$TARGET_DATA_DIR" \
    go run ./cmd/babylog admin init --username "$USERNAME" --password-file "$INIT_PASS_FILE"
)

printf '\n本地开发数据库重置完成！\n'
printf '若 pnpm dev 正在运行，请重启后端（或重新运行 pnpm dev）并刷新浏览器重新登录，即可从首次宝宝建档开始体验。\n'
