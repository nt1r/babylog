#!/bin/sh
# BabyLog 服务器端一键安装与升级脚本（POSIX sh）：
# 从 GitHub 拉取官方 compose.yaml，拉取预构建多架构 Docker 镜像，
# 交互式安全初始化管理员密码并启动服务；支持 --upgrade 原地平滑升级。
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/nt1r/babylog/main/scripts/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/nt1r/babylog/main/scripts/install.sh | sh -s -- --upgrade

set -eu
umask 077

DEFAULT_IMAGE="ghcr.io/nt1r/babylog"
DEFAULT_VERSION="latest"
DEFAULT_BIND="127.0.0.1"
DEFAULT_PORT="21115"
RAW_BASE_URL="${BABYLOG_RAW_BASE_URL:-https://raw.githubusercontent.com/nt1r/babylog}"

INSTALL_DIR=""
CLI_IMAGE=""
CLI_VERSION=""
CLI_BIND=""
CLI_PORT=""
UPGRADE_MODE=0
ASSUME_YES=0

usage() {
  cat <<'EOF'
用法: install.sh [选项]

选项:
  --dir <目录>        安装目录（默认 /opt/babylog，无写权限时回退到 $HOME/babylog）
  --version <版本>    镜像与 compose 模板版本，例如 v0.1.0 或 latest（默认 latest）
  --image <镜像名>    覆盖镜像地址（不含标签，默认 ghcr.io/nt1r/babylog）
  --bind <地址>       宿主机监听地址（默认 127.0.0.1，局域网直连可用 0.0.0.0）
  --port <端口>       宿主机监听端口（默认 21115）
  --upgrade           原地拉取新镜像并平滑重启（保留现有数据与配置）
  -y, --yes           跳过确认直接沿用默认值（首次安装仍需输入管理员密码）
  -h, --help          显示此帮助信息

环境变量:
  BABYLOG_RAW_BASE_URL  可选，覆盖 GitHub Raw 下载基址（例如自定义加速镜像）
EOF
}

die() {
  printf '错误: %s\n' "$1" >&2
  exit 1
}

require_arg_value() {
  if [ "$#" -lt 2 ] || [ -z "$2" ]; then
    printf '错误: 参数 %s 需要提供取值\n\n' "$1" >&2
    usage >&2
    exit 1
  fi
}

expand_tilde() {
  case "$1" in
    \~)
      printf '%s' "$HOME"
      ;;
    \~/*)
      printf '%s/%s' "$HOME" "${1#~/}"
      ;;
    *)
      printf '%s' "$1"
      ;;
  esac
}

validate_install_dir() {
  case "$1" in
    /*/*)
      ;;
    *)
      die "安装目录必须为至少两级的绝对路径（例如 /opt/babylog 或 \$HOME/babylog），当前值: $1"
      ;;
  esac
  case "$1" in
    */|*/..|*/../*|*[[:space:]\'\"\`\$\;\|\&\<\>\(\)]*)
      die "安装目录包含非法字符或相对路径段: $1"
      ;;
  esac
}

validate_version() {
  case "$1" in
    latest)
      return 0
      ;;
    v[0-9]*.[0-9]*.[0-9]*)
      case "$1" in
        *..*|*[!A-Za-z0-9._-]*)
          die "版本号格式不合法（请使用 latest 或带 v 前缀的语义化版本，例如 v0.1.0）: $1"
          ;;
      esac
      ;;
    *)
      die "版本号格式不合法（请使用 latest 或带 v 前缀的语义化版本，例如 v0.1.0）: $1"
      ;;
  esac
}

validate_image() {
  case "$1" in
    ''|-*|.*|/*|*/|*..*|*[[:upper:]]*|*[!a-z0-9._/-]*)
      die "镜像地址格式不合法（须为小写镜像名且不含标签冒号，示例: ghcr.io/nt1r/babylog）: $1"
      ;;
  esac
}

validate_bind() {
  ADDR="$1"
  case "$ADDR" in
    *[!0-9.]*|.*|*.|*..*)
      die "监听地址格式不合法（请使用 IPv4 地址，示例: 127.0.0.1 或 0.0.0.0）: $ADDR"
      ;;
    *.*.*.*)
      ;;
    *)
      die "监听地址格式不合法（请使用 IPv4 地址，示例: 127.0.0.1 或 0.0.0.0）: $ADDR"
      ;;
  esac
  OLD_IFS="$IFS"
  IFS='.'
  # shellcheck disable=SC2086
  set -- $ADDR
  IFS="$OLD_IFS"
  if [ "$#" -ne 4 ]; then
    die "监听地址格式不合法（请使用 IPv4 地址，示例: 127.0.0.1 或 0.0.0.0）: $ADDR"
  fi
  for OCTET in "$@"; do
    if [ -z "$OCTET" ] || [ "$OCTET" -gt 255 ]; then
      die "监听地址段超出范围（0–255）: $ADDR"
    fi
  done
}

validate_port() {
  case "$1" in
    ''|*[!0-9]*)
      die "端口号必须为 1–65535 的整数: $1"
      ;;
  esac
  if [ "$1" -lt 1 ] || [ "$1" -gt 65535 ]; then
    die "端口号超出范围（1–65535）: $1"
  fi
}

default_install_dir() {
  if [ -d /opt/babylog ] && [ -w /opt/babylog ]; then
    printf '/opt/babylog'
  elif [ -d /opt ] && [ -w /opt ]; then
    printf '/opt/babylog'
  else
    printf '%s/babylog' "$HOME"
  fi
}

check_dependencies() {
  if ! command -v docker >/dev/null 2>&1; then
    die "未检测到 docker，请先安装 Docker Engine（https://docs.docker.com/engine/install/）"
  fi
  if ! docker compose version >/dev/null 2>&1; then
    die "未检测到 docker compose 插件，请安装 Docker Compose v2"
  fi
  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    die "需要 curl 或 wget 以下载 compose.yaml"
  fi
}

download_file() {
  URL="$1"
  DEST="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$URL" -o "$DEST"
  else
    wget -qO "$DEST" "$URL"
  fi
}

# curl | sh 管道执行时 stdin 被脚本流占用，交互读写必须显式走 /dev/tty，
# 且提示语定向到 >/dev/tty 以避免污染命令替换 $(...) 捕获的返回值。
has_tty() {
  [ -r /dev/tty ] && [ -w /dev/tty ]
}

prompt_line() {
  PROMPT_TEXT="$1"
  DEFAULT_VAL="$2"
  if ! has_tty; then
    printf '%s' "$DEFAULT_VAL"
    return 0
  fi
  printf '%s [%s]: ' "$PROMPT_TEXT" "$DEFAULT_VAL" >/dev/tty
  IFS= read -r INPUT_VAL </dev/tty || INPUT_VAL=""
  if [ -z "$INPUT_VAL" ]; then
    printf '%s' "$DEFAULT_VAL"
  else
    printf '%s' "$INPUT_VAL"
  fi
}

# 读取无回显密码并确保中断时恢复终端回显
prompt_secret() {
  PROMPT_TEXT="$1"
  if ! has_tty; then
    die "当前非交互终端，无法输入管理员密码。请直接在终端运行脚本，或参考 README 手动执行 admin init。"
  fi
  OLD_STTY=$(stty -g </dev/tty)
  trap 'stty "$OLD_STTY" </dev/tty 2>/dev/null || true; exit 130' INT
  trap 'stty "$OLD_STTY" </dev/tty 2>/dev/null || true; exit 143' TERM
  printf '%s: ' "$PROMPT_TEXT" >/dev/tty
  stty -echo </dev/tty
  IFS= read -r SECRET_VAL </dev/tty || SECRET_VAL=""
  stty "$OLD_STTY" </dev/tty
  trap - INT TERM
  printf '\n' >/dev/tty
  printf '%s' "$SECRET_VAL"
}

# 读取已存在的 .env（仅提取受支持的 4 个变量，避免执行任意内容）
load_existing_env() {
  ENV_FILE="$1"
  [ -f "$ENV_FILE" ] || return 0
  while IFS='=' read -r KEY VAL || [ -n "${KEY:-}" ]; do
    # 兼容 CRLF 与手写引号
    VAL=$(printf '%s' "${VAL:-}" | tr -d '\r')
    case "$VAL" in
      \"*\")
        VAL="${VAL#\"}"
        VAL="${VAL%\"}"
        ;;
      \'*\')
        VAL="${VAL#\'}"
        VAL="${VAL%\'}"
        ;;
    esac
    case "$KEY" in
      ''|\#*)
        continue
        ;;
      BABYLOG_IMAGE)
        SAVED_IMAGE="$VAL"
        ;;
      BABYLOG_VERSION)
        SAVED_VERSION="$VAL"
        ;;
      BABYLOG_BIND)
        SAVED_BIND="$VAL"
        ;;
      BABYLOG_PORT)
        SAVED_PORT="$VAL"
        ;;
    esac
  done < "$ENV_FILE"
}

# 通过同目录临时文件 + 600 权限 + mv 原子替换 .env，避免中断留下半截配置或权限过宽。
write_env_file() {
  ENV_FILE="$1"
  TMP_ENV="${ENV_FILE}.tmp.$$"
  cat > "$TMP_ENV" <<EOF
BABYLOG_IMAGE=${BABYLOG_IMAGE}
BABYLOG_VERSION=${BABYLOG_VERSION}
BABYLOG_BIND=${BABYLOG_BIND}
BABYLOG_PORT=${BABYLOG_PORT}
EOF
  chmod 600 "$TMP_ENV"
  mv "$TMP_ENV" "$ENV_FILE"
}

# 校验下载内容后再写入；升级场景先保留 .bak 备份，供后续拉取镜像失败时自动回滚。
fetch_compose_yaml() {
  TARGET_DIR="$1"
  VERSION_TAG="$2"
  IS_UPGRADE="$3"

  if [ "$VERSION_TAG" = "latest" ]; then
    GIT_REF="main"
  else
    GIT_REF="$VERSION_TAG"
  fi

  COMPOSE_URL="${RAW_BASE_URL%/}/${GIT_REF}/compose.yaml"
  TMP_COMPOSE="${TARGET_DIR}/compose.yaml.tmp.$$"

  printf '==> 下载官方 compose.yaml（来源: %s）...\n' "$COMPOSE_URL"
  if ! download_file "$COMPOSE_URL" "$TMP_COMPOSE"; then
    rm -f "$TMP_COMPOSE"
    die "无法下载 ${COMPOSE_URL}。若指定了版本号，请确认该版本 Tag 已发布，或检查网络连接。"
  fi

  if ! grep -q '^services:' "$TMP_COMPOSE" || ! grep -q 'babylog:' "$TMP_COMPOSE"; then
    rm -f "$TMP_COMPOSE"
    die "下载到的 compose.yaml 内容异常，已中止操作"
  fi

  if [ "$IS_UPGRADE" -eq 1 ] && [ -f "${TARGET_DIR}/compose.yaml" ]; then
    cp "${TARGET_DIR}/compose.yaml" "${TARGET_DIR}/compose.yaml.bak"
  fi

  chmod 644 "$TMP_COMPOSE"
  mv "$TMP_COMPOSE" "${TARGET_DIR}/compose.yaml"
}

# 探测数据卷内是否已有 SQLite 数据库，仅首次全新部署时交互创建管理员，避免升级覆盖既有账号。
init_admin_if_needed() {
  if docker compose run --rm -T --no-deps --entrypoint sh babylog -c 'test -f /data/babylog.sqlite' >/dev/null 2>&1; then
    printf '==> 检测到数据卷中已有数据库，跳过管理员初始化\n'
    return 0
  fi

  printf '==> 初始化管理员账号（仅首次部署需要）\n'
  ADMIN_USER=$(prompt_line "管理员用户名" "admin")
  case "$ADMIN_USER" in
    ''|-*|*[[:space:]]*)
      die "管理员用户名不能为空、以 - 开头或包含空白字符"
      ;;
  esac

  while :; do
    ADMIN_PASS=$(prompt_secret "请输入管理员密码（12–1024 字符）")
    PASS_LEN=${#ADMIN_PASS}
    if [ "$PASS_LEN" -lt 12 ] || [ "$PASS_LEN" -gt 1024 ]; then
      printf '密码长度须为 12–1024 字符，请重新输入。\n' >/dev/tty
      continue
    fi
    ADMIN_PASS_CONFIRM=$(prompt_secret "请再次输入管理员密码确认")
    if [ "$ADMIN_PASS" != "$ADMIN_PASS_CONFIRM" ]; then
      printf '两次输入的密码不一致，请重新输入。\n' >/dev/tty
      continue
    fi
    break
  done

  # 通过标准输入把密码送入容器内只读根文件系统外的 tmpfs /tmp（仅内存、UID 1000 私有），
  # 避免宿主机落盘明文密码文件及 root/非 1000 UID 宿主机挂载权限冲突。
  printf '%s\n' "$ADMIN_PASS" | docker compose run --rm -T --no-deps --entrypoint sh babylog -c '
    set -eu
    umask 077
    PASS_FILE=/tmp/babylog-init.pass
    trap "rm -f /tmp/babylog-init.pass" EXIT
    cat > "$PASS_FILE"
    /usr/local/bin/babylog admin init --password-file "$PASS_FILE" --username="$1"
  ' sh "$ADMIN_USER"
  unset ADMIN_PASS ADMIN_PASS_CONFIRM
}

print_proxy_hints() {
  PROXY_HOST="$BABYLOG_BIND"
  if [ "$PROXY_HOST" = "0.0.0.0" ]; then
    PROXY_HOST="127.0.0.1"
  fi
  cat <<EOF

==> 部署完成！
    安装目录: ${INSTALL_DIR}
    运行版本: ${RUNNING_VERSION}
    监听地址: http://${BABYLOG_BIND}:${BABYLOG_PORT}

后续升级可执行:
    curl -fsSL ${RAW_BASE_URL%/}/main/scripts/install.sh | sh -s -- --upgrade --dir "${INSTALL_DIR}"

公网访问建议通过反向代理启用 HTTPS（以 Caddy 为例）:
    baby.example.com {
        encode zstd gzip
        header {
            Strict-Transport-Security "max-age=31536000; includeSubDomains"
            X-Content-Type-Options "nosniff"
            Referrer-Policy "strict-origin-when-cross-origin"
        }
        reverse_proxy ${PROXY_HOST}:${BABYLOG_PORT} {
            header_down Set-Cookie "(?i)(^babylog_session=.*)" "\$1; Secure"
        }
    }

如使用 Nginx，请务必保留原始 Host 头并补齐 Secure Cookie:
    proxy_set_header Host \$http_host;
    proxy_cookie_flags babylog_session secure;
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir)
      require_arg_value "$@"
      INSTALL_DIR="$2"
      shift
      ;;
    --dir=*)
      INSTALL_DIR="${1#--dir=}"
      [ -n "$INSTALL_DIR" ] || die "--dir 需要提供目录路径"
      ;;
    --version)
      require_arg_value "$@"
      CLI_VERSION="$2"
      shift
      ;;
    --version=*)
      CLI_VERSION="${1#--version=}"
      [ -n "$CLI_VERSION" ] || die "--version 需要提供版本号"
      ;;
    --image)
      require_arg_value "$@"
      CLI_IMAGE="$2"
      shift
      ;;
    --image=*)
      CLI_IMAGE="${1#--image=}"
      [ -n "$CLI_IMAGE" ] || die "--image 需要提供镜像地址"
      ;;
    --bind)
      require_arg_value "$@"
      CLI_BIND="$2"
      shift
      ;;
    --bind=*)
      CLI_BIND="${1#--bind=}"
      [ -n "$CLI_BIND" ] || die "--bind 需要提供监听地址"
      ;;
    --port)
      require_arg_value "$@"
      CLI_PORT="$2"
      shift
      ;;
    --port=*)
      CLI_PORT="${1#--port=}"
      [ -n "$CLI_PORT" ] || die "--port 需要提供端口号"
      ;;
    --upgrade)
      UPGRADE_MODE=1
      ;;
    -y|--yes)
      ASSUME_YES=1
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

check_dependencies

if [ -z "$INSTALL_DIR" ]; then
  DEFAULT_DIR=$(default_install_dir)
  if [ "$ASSUME_YES" -eq 0 ] && has_tty; then
    if [ "$UPGRADE_MODE" -eq 0 ] || [ ! -f "${DEFAULT_DIR}/compose.yaml" ]; then
      INSTALL_DIR=$(prompt_line "安装目录" "$DEFAULT_DIR")
    else
      INSTALL_DIR="$DEFAULT_DIR"
    fi
  else
    INSTALL_DIR="$DEFAULT_DIR"
  fi
fi
INSTALL_DIR=$(expand_tilde "$INSTALL_DIR")
validate_install_dir "$INSTALL_DIR"

SAVED_IMAGE=""
SAVED_VERSION=""
SAVED_BIND=""
SAVED_PORT=""
load_existing_env "${INSTALL_DIR}/.env"

BABYLOG_IMAGE="${CLI_IMAGE:-${SAVED_IMAGE:-$DEFAULT_IMAGE}}"
BABYLOG_VERSION="${CLI_VERSION:-${SAVED_VERSION:-$DEFAULT_VERSION}}"
BABYLOG_BIND="${CLI_BIND:-${SAVED_BIND:-$DEFAULT_BIND}}"
BABYLOG_PORT="${CLI_PORT:-${SAVED_PORT:-$DEFAULT_PORT}}"

if [ "$UPGRADE_MODE" -eq 0 ] && [ "$ASSUME_YES" -eq 0 ] && has_tty; then
  [ -z "$CLI_VERSION" ] && BABYLOG_VERSION=$(prompt_line "镜像版本（latest 或如 v0.1.0）" "$BABYLOG_VERSION")
  [ -z "$CLI_BIND" ] && BABYLOG_BIND=$(prompt_line "监听地址（反代推荐 127.0.0.1，局域网直连填 0.0.0.0）" "$BABYLOG_BIND")
  [ -z "$CLI_PORT" ] && BABYLOG_PORT=$(prompt_line "监听端口" "$BABYLOG_PORT")
fi

validate_image "$BABYLOG_IMAGE"
validate_version "$BABYLOG_VERSION"
validate_bind "$BABYLOG_BIND"
validate_port "$BABYLOG_PORT"

if [ "$UPGRADE_MODE" -eq 1 ]; then
  [ -f "${INSTALL_DIR}/compose.yaml" ] || die "未在 ${INSTALL_DIR} 找到 compose.yaml，请确认安装目录是否正确"
  printf '==> 准备升级 BabyLog（目录: %s，目标镜像: %s:%s）\n' "$INSTALL_DIR" "$BABYLOG_IMAGE" "$BABYLOG_VERSION"
  if [ -f "${INSTALL_DIR}/.env" ]; then
    cp "${INSTALL_DIR}/.env" "${INSTALL_DIR}/.env.bak"
  fi
else
  mkdir -p "$INSTALL_DIR"
  printf '==> 准备部署 BabyLog（目录: %s，镜像: %s:%s，监听: %s:%s）\n' \
    "$INSTALL_DIR" "$BABYLOG_IMAGE" "$BABYLOG_VERSION" "$BABYLOG_BIND" "$BABYLOG_PORT"
fi

fetch_compose_yaml "$INSTALL_DIR" "$BABYLOG_VERSION" "$UPGRADE_MODE"
write_env_file "${INSTALL_DIR}/.env"

cd "$INSTALL_DIR"

printf '==> 拉取容器镜像...\n'
if ! docker compose pull; then
  if [ "$UPGRADE_MODE" -eq 1 ]; then
    [ -f "${INSTALL_DIR}/compose.yaml.bak" ] && mv "${INSTALL_DIR}/compose.yaml.bak" "${INSTALL_DIR}/compose.yaml"
    [ -f "${INSTALL_DIR}/.env.bak" ] && mv "${INSTALL_DIR}/.env.bak" "${INSTALL_DIR}/.env"
    die "拉取镜像 ${BABYLOG_IMAGE}:${BABYLOG_VERSION} 失败，已自动恢复原 compose.yaml 与 .env"
  fi
  die "拉取镜像 ${BABYLOG_IMAGE}:${BABYLOG_VERSION} 失败，请检查版本号或网络连接"
fi

if [ "$UPGRADE_MODE" -eq 0 ]; then
  init_admin_if_needed
fi

printf '==> 启动服务并等待健康检查通过...\n'
docker compose up -d --wait

if [ "$UPGRADE_MODE" -eq 1 ]; then
  rm -f "${INSTALL_DIR}/compose.yaml.bak" "${INSTALL_DIR}/.env.bak"
fi

RUNNING_VERSION=$(docker compose exec -T babylog /usr/local/bin/babylog version 2>/dev/null || printf '%s' "$BABYLOG_VERSION")
print_proxy_hints
