-- +goose Up
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

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- +goose Down
DROP INDEX IF EXISTS idx_sessions_expires_at;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS administrator;
