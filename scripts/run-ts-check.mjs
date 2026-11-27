#!/usr/bin/env node
/**
 * 轻量临时 TypeScript 验证运行器（面向存放于 $TMPDIR 的一次性验证脚本）：
 * 通过虚拟模块将外部脚本锚定至工作区根目录，使脚本内可直接复用 Vite 转译与 @/ 路径别名，
 * 物理文件全程保留在 $TMPDIR，省去每次手写 createServer / ssrLoadModule 引导样板。
 * 用法：pnpm verify:ts "$TMP_TEST"（支持 .ts/.mts/.mjs；若导出 default 函数将自动传入 { load } 助手执行）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const scriptArg = process.argv[2];
if (!scriptArg) {
  console.error('用法: pnpm verify:ts <临时脚本路径>');
  process.exit(1);
}

const targetPath = path.resolve(scriptArg);
if (!fs.existsSync(targetPath)) {
  console.error(`找不到验证脚本: ${targetPath}`);
  process.exit(1);
}

const virtualUrl = '/src/__temp_ts_check__.mts';
const virtualId = path.resolve(process.cwd(), 'src/__temp_ts_check__.mts');

const { createServer } = await import(
  pathToFileURL(path.resolve(process.cwd(), 'node_modules/vite/dist/node/index.js')).href
);
const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  plugins: [
    {
      name: 'babylog:temp-ts-check',
      enforce: 'pre',
      resolveId(id) {
        if (id === virtualUrl || id === virtualId) return virtualId;
      },
      load(id) {
        if (id === virtualId) return fs.readFileSync(targetPath, 'utf8');
      },
    },
  ],
});

try {
  const mod = await server.ssrLoadModule(virtualUrl);
  if (typeof mod.default === 'function') {
    await mod.default({ load: (id) => server.ssrLoadModule(id) });
  }
} finally {
  await server.close();
}
