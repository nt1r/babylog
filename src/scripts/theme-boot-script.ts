/**
 * 在构建或开发注入 index.html 的同步启动脚本，
 * 负责在首屏绘制前根据本地偏好或系统设置应用浅色/深色主题与状态栏颜色，避免刷新闪烁。
 */
export const THEME_STORAGE_KEY = 'babylog_theme_mode';

// 以下两个十六进制值仅用于浏览器 <meta name="theme-color">（不支持 CSS 变量），
// 需与 src/styles/tokens.css 中浅色/深色 --background 保持同步。
export const LIGHT_THEME_COLOR = '#f8f8f2';
export const DARK_THEME_COLOR = '#181e1c';

export function buildThemeBootScript(): string {
  return `(function(){try{var root=document.documentElement;var raw=window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var mode=raw==="light"||raw==="dark"||raw==="system"?raw:"system";var prefersDark=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;var resolved=mode==="system"?(prefersDark?"dark":"light"):mode;root.classList.toggle("dark",resolved==="dark");root.classList.toggle("light",resolved==="light");root.setAttribute("data-theme",resolved);root.setAttribute("data-theme-mode",mode);var meta=document.querySelector('meta[name="theme-color"]');if(meta){meta.setAttribute("content",resolved==="dark"?${JSON.stringify(DARK_THEME_COLOR)}:${JSON.stringify(LIGHT_THEME_COLOR)});}}catch(_){}})();`;
}
