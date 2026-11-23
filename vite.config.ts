import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { buildThemeBootScript } from './src/scripts/theme-boot-script.ts';

/** 在开发和构建阶段将防闪烁主题启动脚本内联注入 index.html */
function themeBootPlugin(): Plugin {
  return {
    name: 'babylog:theme-boot',
    transformIndexHtml(html) {
      return html.replace('<!--theme-boot-->', () => `<script>${buildThemeBootScript()}</script>`);
    },
  };
}

/** 构建产物输出后基于 dist/index.html 哈希为 dist/sw.js 注入确定性版本戳，避免相同代码重复触发清缓存 */
function swVersionPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'babylog:sw-version',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async closeBundle() {
      const indexHtml = await readFile(resolve(outDir, 'index.html'), 'utf8');
      const swPath = resolve(outDir, 'sw.js');
      const content = await readFile(swPath, 'utf8');
      if (!content.includes('__BABYLOG_SW_VERSION__')) {
        throw new Error('dist/sw.js 缺少 __BABYLOG_SW_VERSION__ 版本占位符');
      }
      const versionHash = createHash('sha256').update(indexHtml).digest('hex').slice(0, 12);
      const stamped = content.replaceAll('__BABYLOG_SW_VERSION__', versionHash);
      await writeFile(swPath, stamped, 'utf8');
    },
  };
}

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    themeBootPlugin(),
    swVersionPlugin(),
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  server: {
    host: '127.0.0.1',
    port: 11115,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.PORT ?? '21115'}`,
        changeOrigin: false,
      },
    },
  },
});
