/** 本地持久化主题偏好的 localStorage 键名，同步用于首屏启动脚本与 Zustand 偏好 Store。 */
export const THEME_STORAGE_KEY = 'babylog_theme_mode';

/** 浅色主题浏览器状态栏颜色（<meta name="theme-color"> 不支持 CSS 变量，须与 tokens.css 浅色 --background 同步）。 */
export const LIGHT_THEME_COLOR = '#f8f8f2';

/** 深色主题浏览器状态栏颜色（须与 tokens.css 深色 --background 同步）。 */
export const DARK_THEME_COLOR = '#181e1c';

/**
 * 生成在构建或开发阶段内联注入 index.html 的同步启动脚本，
 * 在首屏绘制前根据本地偏好或系统设置应用浅色/深色主题与状态栏颜色，避免刷新闪烁。
 */
export function buildThemeBootScript(): string {
  return `(function(){try{var root=document.documentElement;var raw=window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var mode=raw==="light"||raw==="dark"||raw==="system"?raw:"system";var prefersDark=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;var resolved=mode==="system"?(prefersDark?"dark":"light"):mode;root.classList.toggle("dark",resolved==="dark");root.classList.toggle("light",resolved==="light");root.setAttribute("data-theme",resolved);root.setAttribute("data-theme-mode",mode);var meta=document.querySelector('meta[name="theme-color"]');if(meta){meta.setAttribute("content",resolved==="dark"?${JSON.stringify(DARK_THEME_COLOR)}:${JSON.stringify(LIGHT_THEME_COLOR)});}}catch(_){}})();`;
}
