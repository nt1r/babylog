import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import {
  AdministratorError,
  AuthStore,
  isSessionToken,
  MAX_PASSWORD_LENGTH,
  validatePassword,
  validateUsername,
} from './auth.ts';

async function withIsolatedStore(run: (store: AuthStore, dataDir: string) => Promise<void> | void): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'babylog-auth-test-'));
  const previous = process.env.BABYLOG_DATA_DIR;
  process.env.BABYLOG_DATA_DIR = dataDir;
  let store: AuthStore | undefined;
  try {
    store = new AuthStore();
    await run(store, dataDir);
  } finally {
    store?.close();
    if (previous === undefined) {
      delete process.env.BABYLOG_DATA_DIR;
    } else {
      process.env.BABYLOG_DATA_DIR = previous;
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
}

describe('auth validators', () => {
  it('validates usernames by length and surrounding whitespace', () => {
    assert.doesNotThrow(() => validateUsername('admin'));
    assert.doesNotThrow(() => validateUsername('a'.repeat(128)));
    assert.throws(() => validateUsername(''), AdministratorError);
    assert.throws(() => validateUsername(' admin'), AdministratorError);
    assert.throws(() => validateUsername('admin '), AdministratorError);
    assert.throws(() => validateUsername('a'.repeat(129)), AdministratorError);
  });

  it('validates passwords between 12 and 1024 characters', () => {
    assert.doesNotThrow(() => validatePassword('123456789012'));
    assert.doesNotThrow(() => validatePassword('p'.repeat(MAX_PASSWORD_LENGTH)));
    assert.throws(() => validatePassword('short-11-ch'), AdministratorError);
    assert.throws(() => validatePassword('p'.repeat(MAX_PASSWORD_LENGTH + 1)), AdministratorError);
  });

  it('recognizes 43-character base64url session tokens only', () => {
    assert.equal(isSessionToken('A'.repeat(43)), true);
    assert.equal(isSessionToken(`${'aZ09_-'.repeat(7)}x`), true);
    assert.equal(isSessionToken(undefined), false);
    assert.equal(isSessionToken('A'.repeat(42)), false);
    assert.equal(isSessionToken('A'.repeat(44)), false);
    assert.equal(isSessionToken(`${'A'.repeat(42)}+`), false);
  });
});

describe('AuthStore', { concurrency: false }, () => {
  it('initializes once, refuses overwrite, and authenticates credentials', async () => {
    await withIsolatedStore(async (store) => {
      const password = 'correct-horse-battery-staple';
      assert.equal(await store.authenticate('admin', password), null);

      await store.initializeAdministrator('admin', password);
      await assert.rejects(() => store.initializeAdministrator('other', 'another-valid-password'), AdministratorError);

      assert.deepEqual(await store.authenticate('admin', password), {
        username: 'admin',
        role: 'admin',
      });
      assert.equal(await store.authenticate('admin', 'wrong-password-12345'), null);
      assert.equal(await store.authenticate('other', password), null);
    });
  });

  it('creates, restores, rotates, expires, and revokes SQLite sessions', async () => {
    await withIsolatedStore(async (store, dataDir) => {
      await store.initializeAdministrator('dad', 'super-secret-password');

      const firstToken = store.createSession(undefined);
      assert.equal(isSessionToken(firstToken), true);
      assert.deepEqual(store.getSession(firstToken), { username: 'dad', role: 'admin' });

      // Creating a new session rotates out the previous token.
      const secondToken = store.createSession(firstToken);
      assert.notEqual(secondToken, firstToken);
      assert.equal(store.getSession(firstToken), null);
      assert.deepEqual(store.getSession(secondToken), { username: 'dad', role: 'admin' });

      // Expired sessions are rejected and deleted on lookup.
      const db = new DatabaseSync(join(dataDir, 'babylog.sqlite'));
      try {
        db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(Date.now() - 1000, secondToken);
      } finally {
        db.close();
      }
      assert.equal(store.getSession(secondToken), null);

      const thirdToken = store.createSession(undefined);
      store.revokeSession(thirdToken);
      assert.equal(store.getSession(thirdToken), null);
    });
  });
});
