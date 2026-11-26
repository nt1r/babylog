#!/bin/sh
# BabyLog 一键发版脚本（POSIX sh）：
# 在当前仓库/worktree 目录直接运行：复用 scripts/lib/release-meta.mjs 校验语义化版本号与 CHANGELOG.md，
# 基于 origin/dev 创建临时分支完成版本准备 PR（合入 dev）、Release PR（dev -> main）、
# 等待 CI 绿灯、推送 vX.Y.Z 标签并跟踪 GitHub Actions release.yml 自动发版。
#
# 用法：
#   ./scripts/release.sh <版本号> [选项]
#   pnpm release 0.1.0 --dry-run
#   pnpm release 0.1.0

set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)
META_HELPER="$SCRIPT_DIR/lib/release-meta.mjs"

RAW_VERSION=""
DRY_RUN=0
ASSUME_YES=0
WATCH_RELEASE=1

ORIG_REF=""
ORIG_IS_BRANCH=0
SWITCHED_TO_PREP=0
CREATED_LOCAL_BRANCH=""
DEV_PKG_FILE=""
DEV_CHANGELOG_FILE=""
MAIN_PKG_FILE=""
MAIN_CHANGELOG_FILE=""
NOTES_FILE=""

usage() {
  cat <<'EOF'
用法: ./scripts/release.sh <版本号> [选项]

参数:
  <版本号>         目标语义化版本，支持 0.1.0 / v0.1.0 / 0.1.0-rc.1（不能重复已有标签）

选项:
  --dry-run        仅执行校验并预览变更与发版计划，不创建分支、PR、合并或推送标签
  -y, --yes        跳过交互确认直接执行
  --no-watch       推送标签后立即退出，不等待 GitHub Actions release.yml 执行完成
  -h, --help       显示此帮助信息

示例:
  ./scripts/release.sh 0.1.0 --dry-run
  ./scripts/release.sh v0.1.0
  pnpm release 0.2.0-rc.1 -y
EOF
}

die() {
  printf '错误: %s\n' "$1" >&2
  exit 1
}

restore_original_branch() {
  if [ "$SWITCHED_TO_PREP" -eq 1 ]; then
    # 切换至准备分支前已确认工作区干净，此处回滚脚本自身产生的未提交改动以安全切回原分支
    git -C "$REPO_ROOT" reset --hard -q HEAD >/dev/null 2>&1 || true
    if [ -n "$ORIG_REF" ]; then
      git -C "$REPO_ROOT" checkout -q "$ORIG_REF" >/dev/null 2>&1 || true
    fi
    SWITCHED_TO_PREP=0
  fi
  if [ -n "$CREATED_LOCAL_BRANCH" ]; then
    git -C "$REPO_ROOT" branch -D "$CREATED_LOCAL_BRANCH" >/dev/null 2>&1 || true
    CREATED_LOCAL_BRANCH=""
  fi
}

cleanup() {
  restore_original_branch
  rm -f "${DEV_PKG_FILE:-}" "${DEV_CHANGELOG_FILE:-}" "${MAIN_PKG_FILE:-}" "${MAIN_CHANGELOG_FILE:-}" "${NOTES_FILE:-}"
}

trap cleanup EXIT INT TERM

confirm_continue() {
  if [ "$ASSUME_YES" -eq 1 ]; then
    return 0
  fi
  if [ -r /dev/tty ] && [ -w /dev/tty ]; then
    printf '\n确认执行上述发版流程？[y/N]: ' >/dev/tty
    IFS= read -r ANSWER </dev/tty || ANSWER=""
  elif [ -t 0 ]; then
    printf '\n确认执行上述发版流程？[y/N]: '
    IFS= read -r ANSWER || ANSWER=""
  else
    die "当前非交互终端，请传入 -y / --yes 确认执行，或使用 --dry-run 预览"
  fi
  case "$ANSWER" in
    y|Y|yes|YES)
      return 0
      ;;
    *)
      printf '已取消发版。\n'
      exit 0
      ;;
  esac
}

# 等待刚创建或刚推送的 PR 注册 CI Check Runs，再阻塞跟踪至全部通过（超时则中止，不绕过 CI 合并）。
wait_for_pr_checks() {
  PR_NUM="$1"
  printf '==> 等待 PR #%s 注册并完成 CI 检查...\n' "$PR_NUM"
  ATTEMPT=0
  CHECKS_FOUND=0
  while [ "$ATTEMPT" -lt 20 ]; do
    CHECK_COUNT=$(gh pr view "$PR_NUM" --json statusCheckRollup --jq '.statusCheckRollup | length' 2>/dev/null || printf '0')
    if [ "${CHECK_COUNT:-0}" -gt 0 ]; then
      CHECKS_FOUND=1
      break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    sleep 3
  done

  if [ "$CHECKS_FOUND" -eq 0 ]; then
    die "60 秒内未检测到 PR #${PR_NUM} 的 CI Check Runs，已中止合并；待 CI 启动后可重跑脚本自动续接"
  fi

  gh pr checks "$PR_NUM" --watch --interval 10
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    -y|--yes)
      ASSUME_YES=1
      ;;
    --no-watch)
      WATCH_RELEASE=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      ;;
    -*)
      printf '未知参数: %s\n\n' "$1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [ -n "$RAW_VERSION" ]; then
        printf '错误: 仅接受一个版本号参数，收到多余参数: %s\n\n' "$1" >&2
        usage >&2
        exit 1
      fi
      RAW_VERSION="$1"
      ;;
  esac
  shift
done

if [ -z "$RAW_VERSION" ]; then
  printf '错误: 请提供目标版本号（例如 0.1.0 或 v0.1.0）\n\n' >&2
  usage >&2
  exit 1
fi

cd "$REPO_ROOT"

# 1. 校验本机依赖与 GitHub CLI 认证状态
for CMD in git node pnpm gh; do
  command -v "$CMD" >/dev/null 2>&1 || die "未检测到必需工具: ${CMD}"
done
if ! gh auth status >/dev/null 2>&1; then
  die "GitHub CLI (gh) 尚未登录，请先执行 gh auth login"
fi

# 记录当前所在分支/提交，便于切换临时准备分支后自动还原
if ORIG_BRANCH=$(git symbolic-ref --quiet --short HEAD 2>/dev/null); then
  ORIG_REF="$ORIG_BRANCH"
  ORIG_IS_BRANCH=1
else
  ORIG_REF=$(git rev-parse HEAD)
  ORIG_IS_BRANCH=0
fi

# 2. 严格校验 SemVer 2.0.0 版本号
PARSED_META=$(node "$META_HELPER" parse-version "$RAW_VERSION")

OLD_IFS="$IFS"
IFS='|'
# shellcheck disable=SC2086
set -- $PARSED_META
IFS="$OLD_IFS"
VERSION="$1"
TAG="$2"
MAJOR_MINOR="$3"
IS_PRERELEASE="$4"

# 3. 校验当前工作区状态、同步远端引用并校验 Tag 唯一性与版本号单调递增
if [ -n "$(git status --porcelain)" ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '提示: 当前工作区存在未提交改动；正式执行前须先提交或清理工作区。\n'
  else
    die "当前工作区存在未提交改动，请先提交、暂存或清理后再执行发版"
  fi
fi

printf '==> 同步远端分支与标签（origin）...\n'
git fetch origin --tags --prune

git show-ref --verify --quiet refs/remotes/origin/dev || die "远端缺少 origin/dev 分支"
git show-ref --verify --quiet refs/remotes/origin/main || die "远端缺少 origin/main 分支"

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null 2>&1; then
  die "本地已存在标签 ${TAG}，请更换更高版本号"
fi
if [ -n "$(git ls-remote --tags origin "refs/tags/${TAG}")" ]; then
  die "远端 origin 已存在标签 ${TAG}，请更换更高版本号"
fi

EXISTING_TAGS=$(git tag -l 'v*')
if [ -n "$EXISTING_TAGS" ]; then
  LATEST_CHECK=$(ALL_TAGS="$EXISTING_TAGS" node "$META_HELPER" check-monotonic "$VERSION")
else
  LATEST_CHECK=""
fi

# 4. 读取 origin/dev 上的 package.json 与 CHANGELOG.md，判断是复用现成章节还是自动切分 [Unreleased]
DEV_PKG_FILE=$(mktemp "${TMPDIR:-/tmp}/babylog-dev-pkg-XXXXXX.json")
DEV_CHANGELOG_FILE=$(mktemp "${TMPDIR:-/tmp}/babylog-dev-changelog-XXXXXX.md")
NOTES_FILE=$(mktemp "${TMPDIR:-/tmp}/babylog-release-notes-XXXXXX.md")

git show origin/dev:package.json > "$DEV_PKG_FILE"
git show origin/dev:CHANGELOG.md > "$DEV_CHANGELOG_FILE"

RELEASE_DATE=$(date '+%Y-%m-%d')

PLAN_INFO=$(
  node "$META_HELPER" plan \
    --version="$VERSION" \
    --pkg="$DEV_PKG_FILE" \
    --changelog="$DEV_CHANGELOG_FILE" \
    --write-notes="$NOTES_FILE"
)

OLD_IFS="$IFS"
IFS='|'
# shellcheck disable=SC2086
set -- $PLAN_INFO
IFS="$OLD_IFS"
DEV_PKG_VER="$1"
NEED_PREPARE_PR="$2"
NEED_PKG_BUMP="$3"
NEED_CHANGELOG_CUT="$4"
NOTE_LINES="$5"

DEV_SHA=$(git rev-parse --short origin/dev)
MAIN_SHA=$(git rev-parse --short origin/main)
PREP_BRANCH="release/${TAG}"
REPO_SLUG=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')

# 读取仓库允许的 PR 合并方式：准备 PR 优先 squash，dev -> main 优先 merge commit 以保持双分支祖先关系
MERGE_CAPS=$(gh api "repos/${REPO_SLUG}" --jq '[.allow_merge_commit, .allow_squash_merge, .allow_rebase_merge] | map(tostring) | join("|")')
OLD_IFS="$IFS"
IFS='|'
# shellcheck disable=SC2086
set -- $MERGE_CAPS
IFS="$OLD_IFS"
ALLOW_MERGE_COMMIT="$1"
ALLOW_SQUASH_MERGE="$2"
ALLOW_REBASE_MERGE="$3"

if [ "$ALLOW_SQUASH_MERGE" = "true" ]; then
  PREP_MERGE_FLAG="--squash"
elif [ "$ALLOW_MERGE_COMMIT" = "true" ]; then
  PREP_MERGE_FLAG="--merge"
elif [ "$ALLOW_REBASE_MERGE" = "true" ]; then
  PREP_MERGE_FLAG="--rebase"
else
  die "仓库 ${REPO_SLUG} 未开启任何可用的 PR 合并策略"
fi

if [ "$ALLOW_MERGE_COMMIT" = "true" ]; then
  MAIN_MERGE_FLAG="--merge"
elif [ "$ALLOW_REBASE_MERGE" = "true" ]; then
  MAIN_MERGE_FLAG="--rebase"
elif [ "$ALLOW_SQUASH_MERGE" = "true" ]; then
  MAIN_MERGE_FLAG="--squash"
else
  die "仓库 ${REPO_SLUG} 未开启任何可用的 PR 合并策略"
fi

printf '\n================ BabyLog 发版计划 ================\n'
printf '仓库:           %s\n' "$REPO_SLUG"
printf '运行目录:       %s（当前引用: %s）\n' "$REPO_ROOT" "$ORIG_REF"
printf '目标标签:       %s（版本号: %s，次版本标签: %s）\n' "$TAG" "$VERSION" "$MAJOR_MINOR"
if [ -n "$LATEST_CHECK" ]; then
  printf '上一个标签:     %s\n' "$LATEST_CHECK"
else
  printf '上一个标签:     无（首次正式发版）\n'
fi
if [ "$IS_PRERELEASE" = "true" ]; then
  printf '更新 :latest:   否（预发布版本仅推送 %s）\n' "$TAG"
else
  printf '更新 :latest:   是（推送 %s、%s 与 latest）\n' "$TAG" "$MAJOR_MINOR"
fi
printf 'origin/dev:     %s（package.json: %s）\n' "$DEV_SHA" "$DEV_PKG_VER"
printf 'origin/main:    %s\n' "$MAIN_SHA"
if [ "$NEED_PREPARE_PR" -eq 1 ]; then
  printf '阶段 1 (准备):  在当前目录切出 %s -> 提 PR 合入 dev（策略: %s）并切回 %s（' "$PREP_BRANCH" "$PREP_MERGE_FLAG" "$ORIG_REF"
  if [ "$NEED_PKG_BUMP" -eq 1 ] && [ "$NEED_CHANGELOG_CUT" -eq 1 ]; then
    printf '更新 package.json + 切分 CHANGELOG.md [%s] - %s' "$VERSION" "$RELEASE_DATE"
  elif [ "$NEED_PKG_BUMP" -eq 1 ]; then
    printf '更新 package.json 版本号为 %s' "$VERSION"
  else
    printf '切分 CHANGELOG.md [%s] - %s' "$VERSION" "$RELEASE_DATE"
  fi
  printf '）\n'
else
  printf '阶段 1 (准备):  跳过（origin/dev 已就绪目标版本与 CHANGELOG 章节）\n'
fi
printf '阶段 2 (合入):  创建/复用 dev -> main Release PR，等待 CI 通过后合并（策略: %s）\n' "$MAIN_MERGE_FLAG"
printf '阶段 3 (打标):  复核最新 origin/main 并推送附注标签 %s\n' "$TAG"
if [ "$WATCH_RELEASE" -eq 1 ]; then
  printf '阶段 4 (跟踪):  自动跟踪 release.yml 构建多架构 GHCR 镜像与 GitHub Release\n'
else
  printf '阶段 4 (跟踪):  跳过（--no-watch）\n'
fi
printf '\n--- 提取的发布说明预览（共 %s 行，展示前 20 行）---\n' "$NOTE_LINES"
head -n 20 "$NOTES_FILE"
if [ "$NOTE_LINES" -gt 20 ]; then
  printf '...（其余 %s 行已省略）\n' "$((NOTE_LINES - 20))"
fi
printf '==================================================\n'

if [ "$DRY_RUN" -eq 1 ]; then
  printf '\n[dry-run] 校验全部通过，未执行任何写操作。\n'
  exit 0
fi

confirm_continue

# 5. 阶段 1：如 origin/dev 尚未就绪目标版本与 CHANGELOG，则在当前目录基于 origin/dev 切出准备分支提 PR 合入 dev
if [ "$NEED_PREPARE_PR" -eq 1 ]; then
  EXISTING_PREP_PR=$(gh pr list --base dev --head "$PREP_BRANCH" --state open --json number --jq '.[0].number // empty')
  if [ -n "$EXISTING_PREP_PR" ]; then
    printf '==> 复用已存在的版本准备 PR #%s（%s -> dev）\n' "$EXISTING_PREP_PR" "$PREP_BRANCH"
    PREP_PR="$EXISTING_PREP_PR"
  else
    if git show-ref --verify --quiet "refs/heads/${PREP_BRANCH}" || [ -n "$(git ls-remote --heads origin "$PREP_BRANCH")" ]; then
      die "分支 ${PREP_BRANCH} 已存在但未关联打开的 PR，请先检查并清理旧分支后再试"
    fi

    printf '==> [1/4] 在当前目录切出准备分支 %s（基于 origin/dev）...\n' "$PREP_BRANCH"
    git checkout -q -b "$PREP_BRANCH" origin/dev
    SWITCHED_TO_PREP=1
    CREATED_LOCAL_BRANCH="$PREP_BRANCH"

    if [ "$NEED_PKG_BUMP" -eq 1 ] && [ "$NEED_CHANGELOG_CUT" -eq 1 ]; then
      node "$META_HELPER" prepare --version="$VERSION" --date="$RELEASE_DATE" --bump-pkg --cut-changelog
    elif [ "$NEED_PKG_BUMP" -eq 1 ]; then
      node "$META_HELPER" prepare --version="$VERSION" --date="$RELEASE_DATE" --bump-pkg
    elif [ "$NEED_CHANGELOG_CUT" -eq 1 ]; then
      node "$META_HELPER" prepare --version="$VERSION" --date="$RELEASE_DATE" --cut-changelog
    fi

    ./scripts/release-check.sh --tag "$TAG" --write-notes "$NOTES_FILE" >/dev/null
    git add package.json CHANGELOG.md
    git commit -m "chore(release): prepare ${TAG}"
    git push -u origin "$PREP_BRANCH"

    # 推送完成后立即切回原分支并清理本地临时分支，保持当前工作区还原
    restore_original_branch

    PREP_PR_URL=$(gh pr create \
      --base dev \
      --head "$PREP_BRANCH" \
      --title "chore(release): prepare ${TAG}" \
      --body "自动准备 ${TAG} 发版元数据（更新 \`package.json\` 版本号并整理 \`CHANGELOG.md\`）。")
    PREP_PR=$(gh pr view "$PREP_PR_URL" --json number --jq '.number')
    printf '==> 已创建版本准备 PR #%s: %s\n' "$PREP_PR" "$PREP_PR_URL"
  fi

  wait_for_pr_checks "$PREP_PR"
  printf '==> 合并版本准备 PR #%s 至 dev（策略: %s）...\n' "$PREP_PR" "$PREP_MERGE_FLAG"
  gh pr merge "$PREP_PR" "$PREP_MERGE_FLAG" --delete-branch
  git fetch origin dev
fi

# 6. 阶段 2：将 dev 通过 Release PR 合入 main（优先 merge commit 以保留双分支共同祖先，不删除 dev）
# 用文件树 diff 判断是否存在未发布变更，避免历史上曾用 squash 合并 main 时提交数误判为空 PR。
if ! git diff --quiet origin/main origin/dev; then
  AHEAD_COUNT=$(git rev-list --count origin/main..origin/dev)
  EXISTING_MAIN_PR=$(gh pr list --base main --head dev --state open --json number --jq '.[0].number // empty')
  if [ -n "$EXISTING_MAIN_PR" ]; then
    printf '==> [2/4] 复用已存在的 dev -> main Release PR #%s，并同步最新标题与发版说明\n' "$EXISTING_MAIN_PR"
    MAIN_PR="$EXISTING_MAIN_PR"
    gh pr edit "$MAIN_PR" --title "chore(release): release ${TAG}" --body-file "$NOTES_FILE" >/dev/null
  else
    printf '==> [2/4] 创建 dev -> main Release PR（包含 %s 个提交）...\n' "$AHEAD_COUNT"
    MAIN_PR_URL=$(gh pr create \
      --base main \
      --head dev \
      --title "chore(release): release ${TAG}" \
      --body-file "$NOTES_FILE")
    MAIN_PR=$(gh pr view "$MAIN_PR_URL" --json number --jq '.number')
    printf '==> 已创建 Release PR #%s: %s\n' "$MAIN_PR" "$MAIN_PR_URL"
  fi

  wait_for_pr_checks "$MAIN_PR"
  printf '==> 合并 Release PR #%s 至 main（策略: %s）...\n' "$MAIN_PR" "$MAIN_MERGE_FLAG"
  gh pr merge "$MAIN_PR" "$MAIN_MERGE_FLAG"
  git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
else
  printf '==> [2/4] origin/dev 与 origin/main 文件内容已一致，跳过合并 PR\n'
fi

# 7. 阶段 3：直接校验最新 origin/main 的 package.json 与 CHANGELOG.md，再打附注标签并推送
printf '==> [3/4] 复核 origin/main 并推送标签 %s...\n' "$TAG"
MAIN_PKG_FILE=$(mktemp "${TMPDIR:-/tmp}/babylog-main-pkg-XXXXXX.json")
MAIN_CHANGELOG_FILE=$(mktemp "${TMPDIR:-/tmp}/babylog-main-changelog-XXXXXX.md")
git show refs/remotes/origin/main:package.json > "$MAIN_PKG_FILE"
git show refs/remotes/origin/main:CHANGELOG.md > "$MAIN_CHANGELOG_FILE"

node "$META_HELPER" verify \
  --tag="$TAG" \
  --pkg="$MAIN_PKG_FILE" \
  --changelog="$MAIN_CHANGELOG_FILE" \
  --quiet

git tag -a "$TAG" refs/remotes/origin/main -m "Release ${TAG}"
git push origin "$TAG"
printf '==> 已推送标签 %s（指向 origin/main %s）\n' "$TAG" "$(git rev-parse --short refs/remotes/origin/main)"

# 若用户原本就在 dev 或 main 分支，顺带尝试快进同步本地分支指针
if [ "$ORIG_IS_BRANCH" -eq 1 ] && { [ "$ORIG_REF" = "dev" ] || [ "$ORIG_REF" = "main" ]; }; then
  git merge --ff-only -q "origin/${ORIG_REF}" >/dev/null 2>&1 || true
fi

# 8. 阶段 4：自动跟踪 GitHub Actions release.yml 发布流水线
if [ "$WATCH_RELEASE" -eq 1 ]; then
  printf '==> [4/4] 等待 GitHub Actions release.yml 启动...\n'
  RUN_ID=""
  ATTEMPT=0
  while [ "$ATTEMPT" -lt 20 ]; do
    RUN_ID=$(gh run list --workflow release.yml --branch "$TAG" --limit 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)
    if [ -n "$RUN_ID" ]; then
      break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    sleep 3
  done

  if [ -z "$RUN_ID" ]; then
    printf '提示: 60 秒内未查询到 release.yml 运行记录，请前往 GitHub Actions 查看：\n'
    printf '  https://github.com/%s/actions/workflows/release.yml\n' "$REPO_SLUG"
  else
    printf '==> 正在跟踪 release.yml 运行 #%s...\n' "$RUN_ID"
    gh run watch "$RUN_ID" --exit-status
  fi
fi

cat <<EOF

==> 发版流程完成（${TAG}）！
    GitHub Release: https://github.com/${REPO_SLUG}/releases/tag/${TAG}
    Actions 流水线: https://github.com/${REPO_SLUG}/actions/workflows/release.yml

若是首次推送 GHCR 镜像，请确认 Package 可见性已设为 Public:
    https://github.com/${REPO_SLUG}/pkgs/container/babylog

线上服务器更新命令（latest 部署）:
    docker compose up -d --force-recreate --wait
    docker compose logs --tail=20 babylog
EOF
