#!/bin/sh
# BabyLog Go 后端静态检查脚本：执行格式、go vet、staticcheck 与孤立导出符号检查。
# 优先复用 PATH 中版本精确匹配的 staticcheck 二进制（供 CI 缓存或本地预装提速），
# 未命中时自动回退到 `go run ...@version`，确保零额外安装门槛且不污染 backend/go.mod。

set -eu

# 单一事实来源：CI Composite Action 通过 `--print-staticcheck-version` 读取此版本，避免双处漂移。
STATICCHECK_VERSION="v0.8.2"
EMBED_WEBUI_PKGS="./internal/webui ./internal/httpapi ./cmd/babylog"

if [ "${1:-}" = "--print-staticcheck-version" ]; then
  printf '%s\n' "$STATICCHECK_VERSION"
  exit 0
fi

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)

cd "$REPO_ROOT/backend"

unformatted=$(gofmt -l .)
if [ -n "$unformatted" ]; then
  printf 'Unformatted Go files:\n%s\n' "$unformatted" >&2
  exit 1
fi

# 防呆校验：确保 embedwebui 条件编译仅存在于 internal/webui，防止未来扩展时收窄列表漏检。
extra_embed_tags=$(find . -type f -name '*.go' ! -path './internal/webui/*' -exec grep -lE '^//go:build.*embedwebui' {} + || true)
if [ -n "$extra_embed_tags" ]; then
  printf 'Unexpected embedwebui build tag outside internal/webui (update EMBED_WEBUI_PKGS in scripts/lint-go.sh):\n%s\n' "$extra_embed_tags" >&2
  exit 1
fi

CGO_ENABLED=0 go vet ./...
# embedwebui 构建标签仅切换 internal/webui 实现，收窄检查范围至受影响包链路以避免重复全仓分析。
# shellcheck disable=SC2086
CGO_ENABLED=0 go vet -tags embedwebui $EMBED_WEBUI_PKGS

staticcheck_bin=""
if command -v staticcheck >/dev/null 2>&1; then
  candidate=$(command -v staticcheck)
  if go version -m "$candidate" 2>/dev/null | awk -F '\t' -v ver="$STATICCHECK_VERSION" '$2 == "mod" && $3 == "honnef.co/go/tools" && $4 == ver { found = 1 } END { exit !found }'; then
    staticcheck_bin="$candidate"
  fi
fi

if [ "${BABYLOG_REQUIRE_CACHED_STATICCHECK:-}" = "true" ] && [ -z "$staticcheck_bin" ]; then
  printf 'Expected staticcheck %s in PATH (BABYLOG_REQUIRE_CACHED_STATICCHECK=true), but no matching binary was found\n' "$STATICCHECK_VERSION" >&2
  exit 1
fi

run_staticcheck() {
  if [ -n "$staticcheck_bin" ]; then
    CGO_ENABLED=0 "$staticcheck_bin" "$@"
  else
    CGO_ENABLED=0 go run "honnef.co/go/tools/cmd/staticcheck@${STATICCHECK_VERSION}" "$@"
  fi
}

run_staticcheck -tests=true ./...
# shellcheck disable=SC2086
run_staticcheck -tags embedwebui -tests=true $EMBED_WEBUI_PKGS

CGO_ENABLED=0 go run "$REPO_ROOT/scripts/check-go-dead-exports.go" --self-test
CGO_ENABLED=0 go run "$REPO_ROOT/scripts/check-go-dead-exports.go" .
