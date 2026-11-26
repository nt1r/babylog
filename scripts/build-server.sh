#!/bin/sh
# BabyLog 后端单二进制打包脚本：校验前端 dist/ 产物并嵌入零 CGO 可执行文件，
# 退出时自动清理暂存静态文件并恢复 .gitkeep，确保编译产物不含 .gitkeep 且工作区零污染。

set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)

cd "$REPO_ROOT"

if [ ! -f dist/index.html ]; then
  echo "请先运行 pnpm build:web 构建前端产物" >&2
  exit 1
fi

EMBED_DIR="$REPO_ROOT/backend/internal/webui/dist"

cleanup() {
  rm -rf "$EMBED_DIR"
  mkdir -p "$EMBED_DIR"
  : > "$EMBED_DIR/.gitkeep"
}
trap cleanup EXIT

# 编译前清空含 .gitkeep 在内的整个目录，避免 `//go:embed all:dist` 将 .gitkeep 打包进发布二进制。
rm -rf "$EMBED_DIR"
mkdir -p "$EMBED_DIR" "$REPO_ROOT/bin"
cp -R dist/. "$EMBED_DIR/"

VER="${BABYLOG_VERSION:-dev}"
COMMIT="${BABYLOG_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}"
BUILD_DATE="${BABYLOG_BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

(
  cd "$REPO_ROOT/backend"
  CGO_ENABLED=0 go build \
    -tags embedwebui \
    -trimpath \
    -ldflags="-s -w -X main.version=${VER} -X main.commit=${COMMIT} -X main.buildDate=${BUILD_DATE}" \
    -o "$REPO_ROOT/bin/babylog" \
    ./cmd/babylog
)
