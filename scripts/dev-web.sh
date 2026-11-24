#!/bin/sh
# 等待本地 Go 后端 HTTP 服务就绪后再启动 Vite 前端开发服务器，
# 避免 `pnpm dev` 并行启动时前端先就绪导致首次访问出现 `/api` 代理 ECONNREFUSED 报错。

set -eu

API_PORT="${PORT:-21115}"
API_URL="http://127.0.0.1:${API_PORT}/api/auth/session"
TIMEOUT_MS="${BABYLOG_DEV_WAIT_TIMEOUT_MS:-60000}"

printf '等待后端服务就绪（%s）...\n' "$API_URL"

# shellcheck disable=SC2016
node -e '
const url = process.argv[1];
const timeoutMs = Number(process.argv[2]) || 60000;
const deadline = Date.now() + timeoutMs;

async function waitReady() {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (res.status > 0) {
        process.exit(0);
      }
    } catch {
      // 后端尚未监听，短暂等待后重试
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.error(`等待后端就绪超时（${Math.round(timeoutMs / 1000)}s）：${url}`);
  process.exit(1);
}

waitReady();
' "$API_URL" "$TIMEOUT_MS"

exec pnpm dev:web
