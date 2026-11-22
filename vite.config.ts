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

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [themeBootPlugin(), tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
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
