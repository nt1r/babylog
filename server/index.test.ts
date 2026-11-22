import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AuthStore, SESSION_COOKIE_NAME } from './auth.ts';

const serverEntry = fileURLToPath(new URL('./index.ts', import.meta.url));
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'babylog-integration-secret';

describe('HTTP auth server integration', () => {
  let dataDir = '';
  let baseUrl = '';
  let serverProcess: ReturnType<typeof spawn> | undefined;

  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'babylog-http-test-'));
    const previous = process.env.BABYLOG_DATA_DIR;
    process.env.BABYLOG_DATA_DIR = dataDir;
    const store = new AuthStore();
    try {
      await store.initializeAdministrator(ADMIN_USER, ADMIN_PASS);
    } finally {
      store.close();
      if (previous === undefined) {
        delete process.env.BABYLOG_DATA_DIR;
      } else {
        process.env.BABYLOG_DATA_DIR = previous;
      }
    }

    const child = spawn(process.execPath, [serverEntry], {
      env: { ...process.env, BABYLOG_DATA_DIR: dataDir, HOST: '127.0.0.1', PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProcess = child;

    baseUrl = await new Promise<string>((resolveUrl, rejectUrl) => {
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => rejectUrl(new Error(`Server startup timed out: ${stderr}`)), 5000);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) {
          clearTimeout(timer);
          resolveUrl(match[0]);
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        rejectUrl(new Error(`Server exited early (${code}): ${stderr}`));
      });
    });
  });

  after(async () => {
    if (serverProcess && serverProcess.exitCode === null) {
      await new Promise<void>((resolveExit) => {
        serverProcess?.once('exit', () => resolveExit());
        serverProcess?.kill('SIGTERM');
      });
    }
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it('supports login, session restoration, cookie clearing, and logout lifecycle', async () => {
    const initial = await fetch(`${baseUrl}/api/auth/session`);
    assert.equal(initial.status, 200);
    assert.deepEqual(await initial.json(), { user: null });

    const invalidLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ username: ADMIN_USER, password: 'wrong-password-12345' }),
    });
    assert.equal(invalidLogin.status, 401);
    assert.equal(invalidLogin.headers.get('set-cookie'), null);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    });
    assert.equal(login.status, 200);
    assert.deepEqual(await login.json(), { user: { username: ADMIN_USER, role: 'admin' } });
    const setCookie = login.headers.get('set-cookie') ?? '';
    assert.match(setCookie, new RegExp(`^${SESSION_COOKIE_NAME}=[A-Za-z0-9_-]{43};`));
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookieHeader = setCookie.split(';', 1)[0];

    const restored = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookieHeader },
    });
    assert.equal(restored.status, 200);
    assert.deepEqual(await restored.json(), { user: { username: ADMIN_USER, role: 'admin' } });

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Origin: baseUrl, Cookie: cookieHeader },
    });
    assert.equal(logout.status, 200);
    assert.deepEqual(await logout.json(), { user: null });
    assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/);

    const afterLogout = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookieHeader },
    });
    assert.equal(afterLogout.status, 200);
    assert.deepEqual(await afterLogout.json(), { user: null });
    assert.match(afterLogout.headers.get('set-cookie') ?? '', /Max-Age=0/);
  });

  it('enforces same-origin, content-type, and body size limits', async () => {
    const crossOrigin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    });
    assert.equal(crossOrigin.status, 403);

    const wrongContentType = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: baseUrl },
      body: 'username=admin',
    });
    assert.equal(wrongContentType.status, 415);

    const oversized = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ username: ADMIN_USER, password: 'x'.repeat(20 * 1024) }),
    });
    assert.equal(oversized.status, 413);
  });
});
