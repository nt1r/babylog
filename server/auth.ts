import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_COOKIE_NAME = 'babylog_session';
export const MAX_PASSWORD_LENGTH = 1024;

export type AdminUser = { username: string; role: 'admin' };

export class AdministratorError extends Error {}

type AdministratorRow = {
  username: string;
  password_salt: string;
  password_hash: string;
};

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  scrypt(password, salt, 64, (error, key) => {
    if (error) reject(error);
    else resolve(key);
  });
  return promise;
}

export function validateUsername(username: string): void {
  if (username.length === 0 || username.length > 128 || username.trim() !== username) {
    throw new AdministratorError('管理员用户名须为 1 至 128 个字符，且首尾不能有空白');
  }
}

export function validatePassword(password: string): void {
  if (password.length < 12 || password.length > MAX_PASSWORD_LENGTH) {
    throw new AdministratorError('管理员密码长度须为 12 至 1024 个字符');
  }
}

export function isSessionToken(token: string | undefined): token is string {
  return token !== undefined && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export class AuthStore {
  #database: DatabaseSync;

  constructor() {
    const directory = process.env.BABYLOG_DATA_DIR
      ? resolve(process.env.BABYLOG_DATA_DIR)
      : fileURLToPath(new URL('../data/', import.meta.url));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const databasePath = resolve(directory, 'babylog.sqlite');
    const descriptor = openSync(databasePath, 'a', 0o600);
    closeSync(descriptor);
    chmodSync(databasePath, 0o600);
    this.#database = new DatabaseSync(databasePath);
    try {
      this.#database.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS administrator (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          username TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          password_hash TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          administrator_id INTEGER NOT NULL DEFAULT 1
            REFERENCES administrator(id) ON DELETE CASCADE CHECK (administrator_id = 1),
          expires_at INTEGER NOT NULL
        );
      `);
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  async initializeAdministrator(username: string, password: string): Promise<void> {
    validateUsername(username);
    validatePassword(password);
    if (this.#database.prepare('SELECT id FROM administrator WHERE id = 1').get()) {
      throw new AdministratorError('管理员已存在，不能覆盖');
    }
    const salt = randomBytes(32);
    const hash = await derivePassword(password, salt);
    const result = this.#database
      .prepare(`
      INSERT OR IGNORE INTO administrator (id, username, password_salt, password_hash)
      VALUES (1, ?, ?, ?)
    `)
      .run(username, salt.toString('base64'), hash.toString('base64'));
    if (result.changes === 0) throw new AdministratorError('管理员已存在，不能覆盖');
  }

  async authenticate(username: string, password: string): Promise<AdminUser | null> {
    const administrator = this.#database
      .prepare(`
      SELECT username, password_salt, password_hash FROM administrator WHERE id = 1
    `)
      .get() as AdministratorRow | undefined;
    // Keep password derivation independent of the supplied username.
    const salt = administrator ? Buffer.from(administrator.password_salt, 'base64') : Buffer.alloc(32);
    const actual = await derivePassword(password, salt);
    const expected = administrator ? Buffer.from(administrator.password_hash, 'base64') : Buffer.alloc(64);
    const matches = actual.length === expected.length && timingSafeEqual(actual, expected);
    if (!administrator || !matches || username !== administrator.username) return null;
    return { username: administrator.username, role: 'admin' };
  }

  getSession(token: string | undefined): AdminUser | null {
    if (!isSessionToken(token)) return null;
    const now = Date.now();
    const user = this.#database
      .prepare(`
      SELECT administrator.username FROM sessions
      JOIN administrator ON administrator.id = sessions.administrator_id
      WHERE sessions.token = ? AND sessions.expires_at > ?
    `)
      .get(token, now) as { username: string } | undefined;
    if (!user) {
      this.revokeSession(token);
      return null;
    }
    return { username: user.username, role: 'admin' };
  }

  createSession(previousToken: string | undefined): string {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      this.revokeSession(previousToken);
      this.#database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
      this.#database
        .prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)')
        .run(token, now + SESSION_MAX_AGE_SECONDS * 1000);
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
    return token;
  }

  revokeSession(token: string | undefined): void {
    if (isSessionToken(token)) {
      this.#database.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
  }

  close(): void {
    this.#database.close();
  }
}
