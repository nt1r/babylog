import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { AuthStore } from '../server/auth.ts';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('./init-admin.ts', import.meta.url));

async function runCli(args: string[], dataDir: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...args], {
      env: { ...process.env, BABYLOG_DATA_DIR: dataDir },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

describe('init-admin CLI', () => {
  it('initializes admin stripping a single trailing CRLF and rejects duplicate runs', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'babylog-cli-test-'));
    const dataDir = join(workDir, 'data');
    const passwordFile = join(workDir, 'password.txt');
    writeFileSync(passwordFile, '  padded-secret-123  \r\n', 'utf8');

    const previous = process.env.BABYLOG_DATA_DIR;
    try {
      const first = await runCli(['--password-file', passwordFile, '--username', 'papa'], dataDir);
      assert.equal(first.code, 0);
      assert.match(first.stdout, /管理员初始化成功/);

      process.env.BABYLOG_DATA_DIR = dataDir;
      const store = new AuthStore();
      try {
        assert.deepEqual(await store.authenticate('papa', '  padded-secret-123  '), {
          username: 'papa',
          role: 'admin',
        });
      } finally {
        store.close();
      }

      const duplicate = await runCli(['--password-file', passwordFile], dataDir);
      assert.notEqual(duplicate.code, 0);
      assert.match(duplicate.stderr, /管理员已存在/);
    } finally {
      if (previous === undefined) {
        delete process.env.BABYLOG_DATA_DIR;
      } else {
        process.env.BABYLOG_DATA_DIR = previous;
      }
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('rejects short passwords and invalid CLI arguments', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'babylog-cli-invalid-'));
    const dataDir = join(workDir, 'data');
    const shortPasswordFile = join(workDir, 'short.txt');
    writeFileSync(shortPasswordFile, 'too-short\n', 'utf8');

    try {
      const shortResult = await runCli(['--password-file', shortPasswordFile], dataDir);
      assert.notEqual(shortResult.code, 0);
      assert.match(shortResult.stderr, /12 至 1024/);

      const missingArgs = await runCli([], dataDir);
      assert.notEqual(missingArgs.code, 0);
      assert.match(missingArgs.stderr, /用法/);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
