#!/bin/sh
# BabyLog Go 后端测试统一入口，供 package.json、CI 与 Release 共同调用，避免命令参数在多处漂移。

set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)

cd "$REPO_ROOT/backend"

mode="${1:-all}"
case "$mode" in
  all)
    exec env CGO_ENABLED=0 go test ./...
    ;;
  --verbose)
    exec env CGO_ENABLED=0 go test -v ./...
    ;;
  --integration)
    exec env CGO_ENABLED=0 go test ./internal/integration/...
    ;;
  --race)
    exec env CGO_ENABLED=1 go test -race -count=1 ./internal/integration/... ./cmd/babylog/...
    ;;
  *)
    printf 'Usage: %s [all|--verbose|--integration|--race]\n' "$0" >&2
    exit 1
    ;;
esac
