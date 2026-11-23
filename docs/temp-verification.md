# 前端临时验证说明

根据 `AGENTS.md`，纳入 Git 的自动化测试仅限后端 Go 测试；前端纯逻辑（codec、视图模型、列表聚合等）通过系统临时目录（`$TMPDIR`）执行 `in-process` 断言验证，任务结束立即清理。

## 在 `$TMPDIR` 下加载工作区 TS 模块（避免 `ERR_MODULE_NOT_FOUND`）

由于临时脚本位于 Git 工作区之外，Node ESM 无法直接按裸包名 `import 'vite'` 解析工作区 `node_modules`。通过 `pathToFileURL` 指向当前工作区的 Vite 入口并调用 `ssrLoadModule`，即可复用 `@/` 路径别名与 TypeScript 转译：

```bash
TMP_TEST="${TMPDIR:-/tmp}/verify-frontend-$$.mjs"
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
node "$TMP_TEST"; STATUS=$?; rm -f "$TMP_TEST"; exit $STATUS
```

## 约束提醒

- 始终在 `finally` 中关闭 Vite server，并在退出前 `rm -f "$TMP_TEST"` 清理临时脚本。
- 不将临时验证脚本写入仓库、`.gitignore` 目录、常驻 `package.json` 脚本或 CI。
