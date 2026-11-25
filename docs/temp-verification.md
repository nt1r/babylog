# 前端临时验证说明

根据 `AGENTS.md`，纳入 Git 的自动化测试仅限后端 Go 测试；前端纯逻辑（codec、视图模型、列表聚合等）通过系统临时目录（`$TMPDIR`）执行 `in-process` 断言验证，任务结束立即清理。编辑完前后端代码后建议先执行 `pnpm format`，再串联 `pnpm check && pnpm lint`，避免因格式差异触发额外重试。

## 在 `$TMPDIR` 下加载工作区 TS 模块（避免 `ERR_MODULE_NOT_FOUND`）

由于临时脚本位于 Git 工作区之外，Node ESM 无法直接按裸包名 `import 'vite'` 解析工作区 `node_modules`。通过 `pathToFileURL` 指向当前工作区的 Vite 入口并调用 `ssrLoadModule`，即可复用 `@/` 路径别名与 TypeScript 转译；脚本开头务必启用 `set -euo pipefail` 与 `trap`，防止前置步骤失败后残留临时文件或误入交互式 `node` REPL：

```bash
set -euo pipefail
[ -d node_modules ] || pnpm install --frozen-lockfile
TMP_TEST="${TMPDIR:-/tmp}/verify-frontend-$$.mjs"
trap 'rm -f "$TMP_TEST"' EXIT

cat <<'EOF' > "$TMP_TEST"
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { createServer } = await import(
  pathToFileURL(path.resolve(process.cwd(), 'node_modules/vite/dist/node/index.js')).href
);
const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const mod = await server.ssrLoadModule('/src/lib/dashboard.ts');
  // 在此编写 assert 断言
  assert.ok(mod);
} finally {
  await server.close();
}
EOF

node "$TMP_TEST"
```

## 免登录隔离 UI 组件视觉预览（按需用于新页面/大幅排版与配色调整）

仅在**新建完整页面**或**大幅调整布局、留白、字号与主题配色**时按需执行（日常文案修正或局部小改跳过即可）。无需启动 Go 后端或登录：在 `$TMPDIR` 中写入预览入口，并通过 Vite 虚拟模块将其锚定为 `/src/__temp_preview__.tsx`，即可复用工作区 `@/` 别名、Tailwind v4 与 `node_modules`（物理文件全程留在工作区之外）：

```bash
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/babylog-ui-preview.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

cat <<'EOF' > "$TMP_DIR/preview.tsx"
import '@fontsource-variable/geist';
import '@/styles/globals.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 替换为待核验的纯展示组件与 Mock 数据
import { Checkbox } from '@/components/ui/checkbox';

if (new URLSearchParams(window.location.search).get('theme') === 'dark') {
  document.documentElement.classList.add('dark');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="min-h-screen bg-background p-6 text-foreground">
      <Checkbox checked />
    </div>
  </StrictMode>,
);
EOF

cat <<'EOF' > "$TMP_DIR/serve.mjs"
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmpDir = process.env.TMP_DIR;
const virtualId = path.resolve(process.cwd(), 'src/__temp_preview__.tsx');
const { createServer } = await import(
  pathToFileURL(path.resolve(process.cwd(), 'node_modules/vite/dist/node/index.js')).href
);

const server = await createServer({
  root: process.cwd(),
  server: { host: '127.0.0.1', port: 0, strictPort: false },
  logLevel: 'error',
  plugins: [
    {
      name: 'babylog:temp-preview',
      enforce: 'pre',
      resolveId(id) {
        if (id === '/src/__temp_preview__.tsx' || id === virtualId) return virtualId;
      },
      async load(id) {
        if (id === virtualId) return readFile(path.join(tmpDir, 'preview.tsx'), 'utf8');
      },
      configureServer(srv) {
        srv.middlewares.use('/__preview', async (req, res) => {
          const rawHtml =
            '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/__temp_preview__.tsx"></script></body></html>';
          const html = await srv.transformIndexHtml(req.originalUrl || '/__preview', rawHtml);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(html);
        });
      },
    },
  ],
});

await server.listen();
const { port } = server.httpServer.address();
console.log(`PREVIEW_URL=http://127.0.0.1:${port}/__preview`);
process.on('SIGINT', () => void server.close().finally(() => process.exit(0)));
process.on('SIGTERM', () => void server.close().finally(() => process.exit(0)));
EOF

TMP_DIR="$TMP_DIR" node "$TMP_DIR/serve.mjs"
```

核验要点（截图同样存放在 `$TMP_DIR`，检查完毕随 `trap` 或 `rm -rf` 一并清理）：
- 无需额外安装 Playwright：若本机已有 Chrome/Chromium，可直接用无头模式批量截图到 `$TMP_DIR` 并通过读图工具审视亮/暗双色与移动/桌面视口：

```bash
CHROME=$(command -v google-chrome || command -v chromium || echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
if [ -x "$CHROME" ]; then
  "$CHROME" --headless=new --disable-gpu --virtual-time-budget=2000 --window-size=390,844 --screenshot="$TMP_DIR/mobile-light.png" "${PREVIEW_URL}"
  "$CHROME" --headless=new --disable-gpu --virtual-time-budget=2000 --window-size=390,844 --screenshot="$TMP_DIR/mobile-dark.png" "${PREVIEW_URL}?theme=dark"
  "$CHROME" --headless=new --disable-gpu --virtual-time-budget=2000 --window-size=1280,900 --screenshot="$TMP_DIR/desktop-light.png" "${PREVIEW_URL}"
  "$CHROME" --headless=new --disable-gpu --virtual-time-budget=2000 --window-size=1280,900 --screenshot="$TMP_DIR/desktop-dark.png" "${PREVIEW_URL}?theme=dark"
fi
```

- 重点核对：390px 窄屏是否出现关键提醒截断或磁贴数值异常折行、卡片/区块留白是否过大、同层级字号是否统一、相邻语义色（如成功/信息/提醒）区分度、暗色可读性，以及涉及侧边栏改动时的**桌面折叠态（图标态）与展开态**视觉。
- **无头截屏常见陷阱（避免误判为功能缺陷）**：
  1. **macOS 最小窗口宽度**：无头 Chrome 在 macOS 下存在约 500px 最小窗口宽度限制；复现 390px 窄屏时，在预览页外层包一层 `w-[390px]` 容器并配合 `--window-size=500,960` 截屏。
  2. **Base UI 进场过渡帧（`data-starting-style`）**：用 JS 自动点击打开 `Popover` / `Dialog` 后立即截屏时，`--virtual-time-budget` 可能停留在 `data-starting-style`（`opacity: 0`）的首帧导致浮层看似空白。将触发延迟设小（如 `10ms`）并将 `--virtual-time-budget` 提高至 `3500–4000` 即可截到完全显现的浮层。
  3. **Recharts 默认入场动画**：`<Line>` / `<Area>` 开启默认入场动画时，无头截屏可能只绘出散点而未完成折线描边；业务曲线或预览核验时显式设置 `isAnimationActive={false}`，既避免切换 Tab 闪烁也确保截屏稳定。
  4. **单次脚本批量出图**：将亮/暗色与桌面/移动端多个视口放进同一份 Node 脚本循环调用 Chrome 后在 `finally` 统一关闭 Vite server，避免反复启动服务和重复生成样板脚本。
  5. **侧边栏折叠态存储键**：本仓桌面侧边栏展开状态持久化在 `localStorage` 的 `babylog_sidebar_open`（非 shadcn 默认 Cookie）；核验折叠态（图标态）须在渲染前显式写入 `localStorage.setItem('babylog_sidebar_open', 'false')`。
- **整页路由 + Mock `fetch` 预览最小骨架**（需要审视含 `AppShell` 与真实路由页的布局时，替换 `preview.tsx` 挂载段即可）：

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { queryClient } from '@/lib/query-client';
import { routeTree } from '@/routeTree.gen';
import { useAuthStore } from '@/stores/auth';

window.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input.toString();
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('/api/auth/session')) return json({ user: mockUser });
  if (url === '/api/babies') return json({ babies: mockBabies });
  return json({});
};
useAuthStore.setState({ user: mockUser, initialized: true, restoring: false, restoreFailed: false, restoreError: '' });
const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [routePath] }) });
// 挂载：<QueryClientProvider client={queryClient}><TooltipProvider><RouterProvider router={router} /></TooltipProvider></QueryClientProvider>
```

## 约束提醒

- 始终在 `finally` 或信号处理中关闭 Vite server，并在退出前清理系统临时目录中的所有脚本与截图。
- 不将临时验证脚本、截图或 Mock 预览入口写入仓库、`.gitignore` 目录、常驻 `package.json` 脚本或 CI。
