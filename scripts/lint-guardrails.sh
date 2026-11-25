#!/bin/sh
# BabyLog 静态工程门禁：校验脚本语法与可执行权限、前端设计系统约束及 OpenSpec 规格。

set -eu

# 1. Shell 脚本与 Git Hooks 语法、可执行权限及 ShellCheck 静态检查
for f in scripts/*.sh .githooks/*; do
  [ -f "$f" ] || continue
  sh -n "$f"
  if [ ! -x "$f" ]; then
    printf 'Script is not executable (run chmod +x %s): %s\n' "$f" "$f" >&2
    exit 1
  fi
done

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck scripts/*.sh .githooks/*
fi

# 2. 全站最小字号不低于 12px
if grep -rnE 'text-\[([0-9]|1[01])px\]' src/; then
  echo 'Found font size below 12px in src/' >&2
  exit 1
fi

# 3. 业务代码统一使用封装的表单原语（禁止裸 checkbox / date / time）
if grep -rnE --exclude-dir=ui "type=['\"]checkbox['\"]" src/; then
  echo 'Use Checkbox from @/components/ui/checkbox instead of raw input[type=checkbox]' >&2
  exit 1
fi

if grep -rnE --exclude-dir=ui "type=['\"]date['\"]" src/; then
  echo 'Use DatePicker from @/components/ui/date-picker instead of raw input[type=date]' >&2
  exit 1
fi

if grep -rnE --exclude-dir=ui "type=['\"]time['\"]" src/; then
  echo 'Use TimePicker from @/components/ui/time-picker instead of raw input[type=time]' >&2
  exit 1
fi

# 4. 禁止硬编码 Tailwind 原始色阶，强制使用语义主题 Token
if grep -rnE '\b(bg|text|border)-(red|blue|green|yellow|amber|orange|purple|pink|gray|slate|zinc|neutral|stone|emerald|teal|cyan|sky|indigo|violet|rose|lime)-[0-9]' src/; then
  echo 'Use semantic theme tokens instead of raw Tailwind palette colors' >&2
  exit 1
fi

# 5. 移动端视口统一使用 svh / dvh，避免 100vh / h-screen 被浏览器地址栏遮挡
if grep -rnE '\b(min-h-screen|h-screen|100vh)\b' src/; then
  echo 'Use svh/dvh viewport units instead of h-screen/100vh for mobile compatibility' >&2
  exit 1
fi

# 6. 折叠区统一使用 Base UI Collapsible（避免 Safari 原生 <details> 双箭头）
if grep -rnE '<details\b' src/; then
  echo 'Use Collapsible from @/components/ui/collapsible instead of raw <details>' >&2
  exit 1
fi

# 7. 前端业务模块未使用导出（死导出）检查
node scripts/check-unused-exports.mjs

# 8. OpenSpec 主规格与活动变更严格校验 + 集成测试 Spec 引用与场景注释模板校验（含解析器自检）
if command -v openspec >/dev/null 2>&1; then
  openspec validate --all --strict
elif [ "${CI:-}" = "true" ]; then
  echo 'openspec CLI is required in CI to validate OpenSpec specs' >&2
  exit 1
fi
node scripts/check-spec-refs.mjs --self-test
node scripts/check-spec-refs.mjs

# 9. 中文注释轻量格式门禁（Go 生产代码包/导出 Go Doc、禁英文分隔栏与纯英文注释、TS 导出禁误用 // 替代 JSDoc，含解析器自检）
node scripts/check-comments.mjs --self-test
node scripts/check-comments.mjs

# 10. Go 后端跨表直接访问门禁（使用 .Table("...") 须同行标注 `// cross-table:` 说明事务意图，防止静默越界或重复查库）
if grep -rnE --include='*.go' --exclude='*_test.go' '\.Table\("' backend/internal/ | grep -v '// cross-table:'; then
  echo 'Cross-table GORM .Table("...") access requires an inline // cross-table: justification comment' >&2
  exit 1
fi

# 10.1 集成测试禁止硬编码会话 Cookie 名称，须统一复用 auth.SessionCookieName 常量
if grep -rn '"babylog_session"' backend/internal/integration/ backend/cmd/babylog/; then
  echo 'Use auth.SessionCookieName instead of hardcoded "babylog_session" in integration/CLI tests' >&2
  exit 1
fi

# 11. 测试与临时验证产物防误提交门禁（前端不保留常驻自动化测试，临时预览与 SQLite 文件严禁入仓）
bad_frontend_tests=$(find src -type f \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' -o -name '*.test.js' -o -name '*.spec.js' -o -name '*__temp_preview__*' \) -o -type d -name '__tests__')
if [ -n "$bad_frontend_tests" ]; then
  printf 'Disallowed frontend test or temporary preview artifacts found under src/ (use system temp dir per docs/temp-verification.md):\n%s\n' "$bad_frontend_tests" >&2
  exit 1
fi

bad_src_sqlite=$(find src backend scripts -type f \( -name '*.sqlite' -o -name '*.sqlite-wal' -o -name '*.sqlite-shm' \))
if [ -n "$bad_src_sqlite" ]; then
  printf 'SQLite database files must not reside under src/, backend/, or scripts/:\n%s\n' "$bad_src_sqlite" >&2
  exit 1
fi

if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  tracked_disallowed=$(git ls-files -- '*.sqlite' '*.sqlite-wal' '*.sqlite-shm' '*__temp_preview__*' '*.test.ts' '*.test.tsx' '*.spec.ts' '*.spec.tsx' '*.test.js' '*.spec.js')
  if [ -n "$tracked_disallowed" ]; then
    printf 'Disallowed SQLite, frontend test, or temporary preview files must not be tracked by Git:\n%s\n' "$tracked_disallowed" >&2
    exit 1
  fi
fi
