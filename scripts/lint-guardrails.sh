#!/bin/sh
# BabyLog 静态工程门禁：校验脚本语法与可执行权限、前端设计系统约束及 OpenSpec 规格。

set -eu

# 1. Shell 脚本语法、可执行权限与 ShellCheck 静态检查
for f in scripts/*.sh; do
  sh -n "$f"
  if [ ! -x "$f" ]; then
    printf 'Script is not executable (run chmod +x %s): %s\n' "$f" "$f" >&2
    exit 1
  fi
done

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck scripts/*.sh
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

# 7. OpenSpec 规格严格校验
if command -v openspec >/dev/null 2>&1; then
  openspec validate --specs --strict
fi
