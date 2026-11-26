#!/bin/sh
# BabyLog 发版预检与元数据提取脚本（POSIX sh）：
# 作为本地发版自检（pnpm release:check）与 GitHub Actions release.yml 的单一事实来源，
# 统一校验语义化 Tag 格式、main 分支祖先关系、package.json 版本号与 CHANGELOG.md 对应章节。
#
# 用法：
#   ./scripts/release-check.sh [选项]
#   pnpm release:check [--tag v0.1.0 --require-main --require-clean --with-tests]

set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)
META_HELPER="$SCRIPT_DIR/lib/release-meta.mjs"

TAG=""
REQUIRE_MAIN=0
FETCH_MAIN=0
REQUIRE_CLEAN=0
WITH_TESTS=0
WRITE_NOTES=""
GITHUB_OUTPUT_FILE=""

usage() {
  cat <<'EOF'
用法: ./scripts/release-check.sh [选项]

选项:
  --tag <vX.Y.Z>          指定目标发布标签（默认读取 package.json version 并加 v 前缀）
  --require-main          校验当前 HEAD 位于 main 分支历史内
  --fetch-main            校验前先从 origin 拉取最新 main 分支引用（配合 --require-main 使用）
  --require-clean         校验 Git 工作区干净无未提交变更
  --write-notes <文件>    将提取到的 CHANGELOG.md 版本章节正文写入指定文件
  --github-output <文件>  将版本元数据以 KEY=VALUE 形式追加写入 GitHub Actions 输出文件
  --with-tests            校验元信息后继续执行 pnpm lint / check / test / test:race
  -h, --help              显示此帮助信息
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

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tag)
      require_arg_value "$@"
      TAG="$2"
      shift
      ;;
    --tag=*)
      TAG="${1#--tag=}"
      [ -n "$TAG" ] || die "--tag 需要提供版本号"
      ;;
    --require-main)
      REQUIRE_MAIN=1
      ;;
    --fetch-main)
      FETCH_MAIN=1
      ;;
    --require-clean)
      REQUIRE_CLEAN=1
      ;;
    --write-notes)
      require_arg_value "$@"
      WRITE_NOTES="$2"
      shift
      ;;
    --write-notes=*)
      WRITE_NOTES="${1#--write-notes=}"
      [ -n "$WRITE_NOTES" ] || die "--write-notes 需要提供文件路径"
      ;;
    --github-output)
      require_arg_value "$@"
      GITHUB_OUTPUT_FILE="$2"
      shift
      ;;
    --github-output=*)
      GITHUB_OUTPUT_FILE="${1#--github-output=}"
      [ -n "$GITHUB_OUTPUT_FILE" ] || die "--github-output 需要提供文件路径"
      ;;
    --with-tests)
      WITH_TESTS=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      ;;
    *)
      printf '未知参数: %s\n\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

cd "$REPO_ROOT"

command -v node >/dev/null 2>&1 || die "未检测到 node，请先切换至 .node-version 对应版本"
command -v git >/dev/null 2>&1 || die "未检测到 git"

if [ -z "$TAG" ]; then
  PKG_VER=$(node -p "require('./package.json').version")
  TAG="v${PKG_VER}"
fi

if [ "$REQUIRE_CLEAN" -eq 1 ]; then
  if [ -n "$(git status --porcelain)" ]; then
    die "当前 Git 工作区存在未提交变更，请先提交或清理后再发版"
  fi
fi

if [ "$REQUIRE_MAIN" -eq 1 ]; then
  TARGET_REF=""
  if [ "$FETCH_MAIN" -eq 1 ]; then
    git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
    TARGET_REF="refs/remotes/origin/main"
  elif git show-ref --verify --quiet refs/remotes/origin/main; then
    TARGET_REF="refs/remotes/origin/main"
  elif git show-ref --verify --quiet refs/heads/main; then
    TARGET_REF="refs/heads/main"
  else
    die "未找到 main 分支引用，请先同步远端 main 或传入 --fetch-main"
  fi

  HEAD_SHA=$(git rev-parse HEAD)
  if ! git merge-base --is-ancestor "$HEAD_SHA" "$TARGET_REF"; then
    die "当前提交 (${HEAD_SHA}) 不在 ${TARGET_REF} 历史内，请先通过 PR 将 dev 合入 main 再打标签"
  fi
fi

COMMIT=$(git rev-parse --short HEAD)
BUILD_DATE=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# 通过共享元数据模块严格校验 SemVer 2.0.0、package.json 版本号一致性与 CHANGELOG.md 正文
META_LINES=$(
  node "$META_HELPER" verify \
    --tag="$TAG" \
    --commit="$COMMIT" \
    --build-date="$BUILD_DATE" \
    --write-notes="$WRITE_NOTES" \
    --github-output="$GITHUB_OUTPUT_FILE"
)

printf '==> 发版元信息校验通过\n%s\n' "$META_LINES"

if [ "$WITH_TESTS" -eq 1 ]; then
  printf '==> 执行全套发版前测试门禁 (lint / check / test / test:race)...\n'
  pnpm lint
  pnpm check
  pnpm test
  pnpm test:race
fi

if [ -z "$GITHUB_OUTPUT_FILE" ]; then
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || printf 'unknown')
  printf '\n当前分支: %s\n' "$CURRENT_BRANCH"
  if [ "$CURRENT_BRANCH" != "main" ]; then
    printf '提示: 正式发版前请先将变更经 PR 合入 main 分支，再在 main 上执行：\n'
    printf '  git checkout main && git pull origin main\n'
    printf '  pnpm release:check --tag %s --require-main --require-clean\n' "$TAG"
  fi
  printf '打标签并触发自动发布命令：\n'
  printf '  git tag -a %s -m "Release %s"\n' "$TAG" "$TAG"
  printf '  git push origin %s\n' "$TAG"
fi
