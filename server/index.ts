import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { TLSSocket } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { AuthStore, MAX_PASSWORD_LENGTH, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from './auth.ts';

const MAX_BODY_BYTES = 16 * 1024;
const distDirectory = process.env.BABYLOG_DIST_DIR
  ? resolve(process.env.BABYLOG_DIST_DIR)
  : fileURLToPath(new URL('../dist/', import.meta.url));
const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function readSessionCookie(request: IncomingMessage): string | undefined {
  for (const cookie of (request.headers.cookie ?? '').split(';')) {
    const separator = cookie.indexOf('=');
    if (separator !== -1 && cookie.slice(0, separator).trim() === SESSION_COOKIE_NAME) {
      return cookie.slice(separator + 1).trim();
    }
  }
  return undefined;
}

function setSessionCookie(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  maxAge = SESSION_MAX_AGE_SECONDS,
): void {
  const secure = request.socket instanceof TLSSocket && request.socket.encrypted;
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`,
  );
}

function enforceSameOrigin(request: IncomingMessage): void {
  const origin = request.headers.origin;
  if (origin === undefined) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, '不允许跨来源操作');
  }
  if (!originHost || originHost.toLowerCase() !== request.headers.host?.toLowerCase()) {
    throw new HttpError(403, '不允许跨来源操作');
  }
}

async function readLoginBody(request: IncomingMessage): Promise<{ username: string; password: string }> {
  if (request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    request.resume();
    throw new HttpError(415, '请使用 JSON 格式提交登录信息');
  }
  if (Number(request.headers['content-length']) > MAX_BODY_BYTES) {
    request.resume();
    throw new HttpError(413, '请求内容过大');
  }
  const { promise, resolve: resolveBody, reject } = Promise.withResolvers<Buffer>();
  const chunks: Buffer[] = [];
  let size = 0;
  let failed = false;
  request.on('data', (chunk: Buffer) => {
    if (failed) return;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      failed = true;
      chunks.length = 0;
      reject(new HttpError(413, '请求内容过大'));
      return;
    }
    chunks.push(chunk);
  });
  request.once('end', () => {
    if (!failed) resolveBody(Buffer.concat(chunks, size));
  });
  request.once('error', () => reject(new HttpError(400, '请求内容读取失败')));
  const body = await promise;
  let value: unknown;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, '登录信息不是有效的 JSON');
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('username' in value) ||
    typeof value.username !== 'string' ||
    !('password' in value) ||
    typeof value.password !== 'string' ||
    value.username.length > 128 ||
    value.password.length > MAX_PASSWORD_LENGTH
  ) {
    throw new HttpError(400, '请输入有效的用户名和密码');
  }
  return { username: value.username, password: value.password };
}

function isInside(directory: string, path: string): boolean {
  const remainder = relative(directory, path);
  return remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder);
}

async function sendDistFile(request: IncomingMessage, response: ServerResponse, relativePath: string): Promise<void> {
  const candidate = resolve(distDirectory, `.${relativePath}`);
  if (!isInside(distDirectory, candidate)) throw new HttpError(404, '文件不存在');
  const [root, file] = await Promise.all([realpath(distDirectory), realpath(candidate)]);
  if (!isInside(root, file)) throw new HttpError(404, '文件不存在');
  const information = await stat(file);
  if (!information.isFile()) throw new HttpError(404, '文件不存在');
  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': information.size,
  });
  if (request.method === 'HEAD') response.end();
  else await pipeline(createReadStream(file), response);
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR'),
  );
}

async function serveStatic(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new HttpError(405, '不支持此请求方法');
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, '请求路径无效');
  }
  if (decoded.includes('\0')) throw new HttpError(400, '请求路径无效');
  const targetPath = decoded === '/' ? '/index.html' : decoded;
  const candidate = resolve(distDirectory, `.${targetPath}`);
  if (!isInside(distDirectory, candidate)) throw new HttpError(404, '文件不存在');

  try {
    await sendDistFile(request, response, targetPath);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    // 无扩展名的前端路由回退到 index.html，缺失的静态资源仍返回 404
    const allowSpaFallback = extname(decoded) === '' && decoded !== '/';
    if (allowSpaFallback) {
      try {
        await sendDistFile(request, response, '/index.html');
        return;
      } catch (fallbackError) {
        if (!isNotFoundError(fallbackError)) throw fallbackError;
      }
    }
    throw new HttpError(
      404,
      pathname === '/' || allowSpaFallback
        ? '页面尚未构建，请先运行 pnpm build；开发时请访问 Vite 开发服务器'
        : '文件不存在',
    );
  }
}

async function handleRequest(store: AuthStore, request: IncomingMessage, response: ServerResponse): Promise<void> {
  let pathname: string;
  try {
    pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    throw new HttpError(400, '请求路径无效');
  }
  if (pathname.startsWith('/api/')) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET' && request.method !== 'HEAD') enforceSameOrigin(request);
    const token = readSessionCookie(request);
    if (pathname === '/api/auth/session') {
      if (request.method !== 'GET') throw new HttpError(405, '不支持此请求方法');
      const user = store.getSession(token);
      if (!user && token !== undefined) setSessionCookie(request, response, '', 0);
      sendJson(response, 200, { user });
      return;
    }
    if (pathname === '/api/auth/login') {
      if (request.method !== 'POST') throw new HttpError(405, '不支持此请求方法');
      const { username, password } = await readLoginBody(request);
      const user = await store.authenticate(username, password);
      if (!user) {
        sendJson(response, 401, { error: '账号或密码不正确' });
        return;
      }
      setSessionCookie(request, response, store.createSession(token));
      sendJson(response, 200, { user });
      return;
    }
    if (pathname === '/api/auth/logout') {
      if (request.method !== 'POST') throw new HttpError(405, '不支持此请求方法');
      store.revokeSession(token);
      setSessionCookie(request, response, '', 0);
      sendJson(response, 200, { user: null });
      return;
    }
    throw new HttpError(404, '接口不存在');
  }
  await serveStatic(request, response, pathname);
}

function startServer(): void {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? '21115');
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('PORT 必须为 0 至 65535 之间的整数');
    process.exitCode = 1;
    return;
  }
  let store: AuthStore;
  try {
    store = new AuthStore();
  } catch {
    console.error('无法打开数据库，请检查数据目录及权限');
    process.exitCode = 1;
    return;
  }
  const server = createServer((request, response) => {
    void handleRequest(store, request, response).catch((error: unknown) => {
      if (response.headersSent || response.destroyed) {
        response.destroy();
        return;
      }
      const status = error instanceof HttpError ? error.status : 500;
      sendJson(response, status, { error: error instanceof HttpError ? error.message : '服务器暂时无法处理请求' });
    });
  });
  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    server.close(() => store.close());
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.once('error', () => {
    console.error('服务启动失败，请检查监听地址和端口');
    process.exitCode = 1;
    if (!closing) {
      closing = true;
      store.close();
    }
  });
  server.listen(port, host, () => {
    const address = server.address();
    const listeningPort = address && typeof address === 'object' ? address.port : port;
    console.log(`BabyLog 服务已启动：http://${host.includes(':') ? `[${host}]` : host}:${listeningPort}`);
  });
}

startServer();
