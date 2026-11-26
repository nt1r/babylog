-- +goose Up
-- 单家庭管理员与会话表：数据库层通过 CHECK (id = 1) / CHECK (administrator_id = 1) 强制单管理员模型。
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
    -- 过期时刻以 UTC 毫秒时间戳（非 Unix 秒）存储，兼容原 Node.js Date.now() 格式。
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- +goose Down
DROP INDEX IF EXISTS idx_sessions_expires_at;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS administrator;
