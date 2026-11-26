import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<() => void>();
let installListenerInitialized = false;

function notifyInstallListeners() {
  for (const listener of installListeners) {
    listener();
  }
}

/** 在应用启动时尽早监听浏览器安装提示事件（Chrome / Edge / Android），避免错过触发时机。 */
export function initPwaInstallListener() {
  if (typeof window === 'undefined' || installListenerInitialized) return;
  installListenerInitialized = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    notifyInstallListeners();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    notifyInstallListeners();
  });
}

/** 判断当前是否正以独立 PWA 模式（主屏幕全屏）运行。 */
function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

/** 判断当前是否为 iOS / iPadOS 设备（用于展示 Safari「添加到主屏幕」引导）。 */
function isIOSDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ Safari 默认上报 MacIntel 桌面 UA，需结合触控点数识别 iPad。
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/** 触发支持 beforeinstallprompt 浏览器的原生安装弹窗。 */
export async function triggerPwaInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredInstallPrompt) return 'unavailable';
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  notifyInstallListeners();

  await promptEvent.prompt();
  const choice = await promptEvent.userChoice;
  return choice.outcome;
}

/** 订阅 PWA 安装可用态与独立主屏幕运行态，供设置页与安装引导卡片复用。 */
export function usePwaInstallState() {
  const [standalone, setStandalone] = useState(() => isStandaloneMode());
  const [canPromptInstall, setCanPromptInstall] = useState(() => deferredInstallPrompt !== null);

  useEffect(() => {
    initPwaInstallListener();
    const sync = () => {
      setStandalone(isStandaloneMode());
      setCanPromptInstall(deferredInstallPrompt !== null);
    };
    installListeners.add(sync);

    const mql = window.matchMedia('(display-mode: standalone)');
    mql.addEventListener('change', sync);
    return () => {
      installListeners.delete(sync);
      mql.removeEventListener('change', sync);
    };
  }, []);

  return {
    standalone,
    canPromptInstall,
    isIOS: isIOSDevice(),
  };
}

let swRegistered = false;

/**
 * 在生产环境注册轻量 Service Worker（/sw.js），仅缓存静态资源并提供离线提示页；
 * 检测到新版本就绪时通知调用方提示用户刷新，避免后台强刷打断正在填写的表单。
 */
export function registerServiceWorker(onUpdateReady?: (applyUpdate: () => void) => void) {
  if (!import.meta.env.PROD || typeof window === 'undefined' || !('serviceWorker' in navigator) || swRegistered) {
    return;
  }
  swRegistered = true;

  // 防止新 SW 接管期间重复触发 controllerchange 造成多次刷新。
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });

  const notifyWaiting = (worker: ServiceWorker) => {
    onUpdateReady?.(() => {
      worker.postMessage({ type: 'SKIP_WAITING' });
    });
  };

  const doRegister = () => {
    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        if (registration.waiting) {
          notifyWaiting(registration.waiting);
        }
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              notifyWaiting(installing);
            }
          });
        });
      })
      .catch(() => {
        // 本地非 HTTPS 局域网环境可能禁用 Service Worker，静默降级不影响正常使用。
      });
  };

  // React 挂载执行 useEffect 时 window.load 可能早已触发，需按 readyState 分流避免漏注册。
  if (document.readyState === 'complete') {
    doRegister();
  } else {
    window.addEventListener('load', doRegister, { once: true });
  }
}
