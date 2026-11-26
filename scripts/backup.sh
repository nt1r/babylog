#!/bin/sh
# BabyLog 一键数据库备份脚本（POSIX sh）：
# 从远程运行中的 Docker 容器拉取 SQLite 数据库（含 WAL 日志），
# 在本地合并为单个干净的 .sqlite 文件并校验完整性，保存到桌面备份目录。
#
# 用法：
#   ./scripts/backup.sh [-o <本地备份目录>]
#
# 配置方式（命令行环境变量优先，其次读取仓库根目录被 git 忽略的 .env.deploy）：
#   DEPLOY_HOST=debian@your-server-ip
#   BACKUP_DIR=$HOME/Desktop/babylog-backups   # 可选，本地保存目录
#   BACKUP_CONTAINER=babylog                   # 可选，远程容器名称，默认 babylog

set -eu
# 收紧默认权限为 0700/0600，确保临时副本与最终备份仅当前用户可读写
umask 077

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)

# 保存显式传入的环境变量，避免被 .env.deploy 覆盖
CLI_DEPLOY_HOST="${DEPLOY_HOST:-}"
CLI_BACKUP_DIR="${BACKUP_DIR:-}"
CLI_BACKUP_CONTAINER="${BACKUP_CONTAINER:-}"

if [ -f "$REPO_ROOT/.env.deploy" ]; then
  # shellcheck source=/dev/null
  . "$REPO_ROOT/.env.deploy"
fi

[ -n "$CLI_DEPLOY_HOST" ] && DEPLOY_HOST="$CLI_DEPLOY_HOST"
[ -n "$CLI_BACKUP_DIR" ] && BACKUP_DIR="$CLI_BACKUP_DIR"
[ -n "$CLI_BACKUP_CONTAINER" ] && BACKUP_CONTAINER="$CLI_BACKUP_CONTAINER"

BACKUP_DIR="${BACKUP_DIR:-$HOME/Desktop/babylog-backups}"
BACKUP_CONTAINER="${BACKUP_CONTAINER:-babylog}"

usage() {
  cat <<'EOF'
用法: ./scripts/backup.sh [选项]

选项:
  -o, --output-dir <目录>   指定本地备份目录（默认 $HOME/Desktop/babylog-backups）
  -h, --help                显示此帮助信息

环境变量（也可写入仓库根目录的 .env.deploy，已被 .gitignore 忽略）:
  DEPLOY_HOST               必填，SSH 目标，例如 debian@1.2.3.4
  BACKUP_DIR                可选，本地备份目录，默认 $HOME/Desktop/babylog-backups
  BACKUP_CONTAINER          可选，远程容器名称，默认 babylog
EOF
}

format_file_size() {
  wc -c < "$1" | awk '{
    if ($1 >= 1048576) {
      printf "%.1f MB", $1 / 1048576
    } else if ($1 >= 1024) {
      printf "%.1f KB", $1 / 1024
    } else {
      printf "%d B", $1
    }
  }'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|--output-dir)
      if [ "$#" -lt 2 ] || [ -z "$2" ]; then
        printf '错误: %s 需要指定目录路径\n\n' "$1" >&2
        usage >&2
        exit 1
      fi
      BACKUP_DIR="$2"
      shift
      ;;
    --output-dir=*)
      BACKUP_DIR="${1#--output-dir=}"
      if [ -z "$BACKUP_DIR" ]; then
        printf '错误: --output-dir 需要指定目录路径\n\n' >&2
        usage >&2
        exit 1
      fi
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

# 展开字面量 ~ 前缀，避免带引号的 ~/... 在当前工作目录误建 ./~/
case "$BACKUP_DIR" in
  \~)
    BACKUP_DIR="$HOME"
    ;;
  \~/*)
    BACKUP_DIR="$HOME/${BACKUP_DIR#~/}"
    ;;
esac

if [ -z "${DEPLOY_HOST:-}" ]; then
  printf '错误: 未设置 DEPLOY_HOST（可通过环境变量或在 .env.deploy 中配置）\n' >&2
  exit 1
fi

case "$DEPLOY_HOST" in
  *[[:space:]]*)
    printf '错误: DEPLOY_HOST 不能包含空白字符: %s\n' "$DEPLOY_HOST" >&2
    exit 1
    ;;
esac

# 按 Docker 容器名规范校验，禁止前导 - 或非法字符，避免参数注入
case "$BACKUP_CONTAINER" in
  ''|[!A-Za-z0-9]*|*[!A-Za-z0-9._-]*)
    printf '错误: BACKUP_CONTAINER 不是合法的容器名称: %s\n' "$BACKUP_CONTAINER" >&2
    exit 1
    ;;
esac

STAGE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/babylog-backup.XXXXXX")
cleanup() {
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

printf '==> [1/3] 正在从 %s（容器 %s）拉取数据库...\n' "$DEPLOY_HOST" "$BACKUP_CONTAINER"
# 先落盘到 0700 临时文件再解包，避免 POSIX sh 缺少 pipefail 导致忽略 ssh 退出码
ssh -o BatchMode=yes -- "$DEPLOY_HOST" "sh -s -- '$BACKUP_CONTAINER'" <<'REMOTE_EXPORT' > "$STAGE_DIR/backup.tar"
set -eu
CONTAINER="$1"
docker exec "$CONTAINER" sh -c '
  set -eu
  cd /data
  if [ ! -f babylog.sqlite ]; then
    printf "错误: 容器内未找到 /data/babylog.sqlite\n" >&2
    exit 1
  fi
  set -- babylog.sqlite
  [ -f babylog.sqlite-wal ] && set -- "$@" babylog.sqlite-wal
  [ -f babylog.sqlite-shm ] && set -- "$@" babylog.sqlite-shm
  tar -cf - "$@"
' </dev/null
REMOTE_EXPORT

tar -xf "$STAGE_DIR/backup.tar" -C "$STAGE_DIR"

if [ ! -f "$STAGE_DIR/babylog.sqlite" ]; then
  printf '错误: 拉取失败，未获得 babylog.sqlite\n' >&2
  exit 1
fi

printf '==> [2/3] 合并 WAL 日志并校验数据库完整性...\n'
# BabyLog 启用 SQLite WAL 模式：须先将 -wal 刷回主库并切回 DELETE 模式，
# 否则单文件备份脱离 -wal 后会丢失未刷盘的最新记录。
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$STAGE_DIR/babylog.sqlite" \
    "PRAGMA busy_timeout=5000; PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
  JOURNAL_MODE=$(sqlite3 "$STAGE_DIR/babylog.sqlite" "PRAGMA journal_mode=DELETE;")
  case "$JOURNAL_MODE" in
    delete|DELETE)
      ;;
    *)
      printf '错误: 未能将备份数据库切换为单文件模式（当前 journal_mode=%s）\n' "$JOURNAL_MODE" >&2
      exit 1
      ;;
  esac

  CHECK_RESULT=$(sqlite3 "$STAGE_DIR/babylog.sqlite" "PRAGMA integrity_check;")
  if [ "$CHECK_RESULT" != "ok" ]; then
    printf '错误: 数据库完整性校验失败: %s\n' "$CHECK_RESULT" >&2
    exit 1
  fi
  VERIFY_STATUS="已合并 WAL 并通过 integrity_check"
else
  if [ -s "$STAGE_DIR/babylog.sqlite-wal" ]; then
    printf '错误: 本地未找到 sqlite3，且存在未合并的 WAL 日志，无法安全生成单文件备份\n' >&2
    exit 1
  fi
  VERIFY_STATUS="本地未安装 sqlite3，已跳过 integrity_check（WAL 为空）"
fi

printf '==> [3/3] 保存备份到本地目录...\n'
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date '+%Y%m%d-%H%M%S')
TARGET_FILE="$BACKUP_DIR/babylog-$TIMESTAMP.sqlite"
if [ -e "$TARGET_FILE" ]; then
  TARGET_FILE="$BACKUP_DIR/babylog-$TIMESTAMP-$$.sqlite"
fi

chmod 600 "$STAGE_DIR/babylog.sqlite"
mv "$STAGE_DIR/babylog.sqlite" "$TARGET_FILE"

FILE_SIZE=$(format_file_size "$TARGET_FILE")
printf '==> 备份完成！\n'
printf '    文件: %s\n' "$TARGET_FILE"
printf '    大小: %s\n' "$FILE_SIZE"
printf '    校验: %s\n' "$VERIFY_STATUS"
