-- +goose NO TRANSACTION
-- +goose Up
-- 多用户与单用户多宝宝迁移（v4 → v5）：
-- SQLite 不支持 ALTER TABLE DROP CONSTRAINT，且 PRAGMA foreign_keys = OFF 须在事务外生效，
-- 因此通过 NO TRANSACTION + 显式 IMMEDIATE 事务完成表重建：
-- 1. administrator → users，并通过部分唯一索引 idx_users_single_admin 硬约束全局至多 1 名 admin；
-- 2. sessions.administrator_id → sessions.user_id，保留存量未过期会话并新增 user_id 索引支持按用户批量踢出；
-- 3. baby_profiles 新增 user_id 外键并回填存量档案至唯一管理员，保留全部 5 张子表外键完好。
PRAGMA foreign_keys = OFF;

BEGIN IMMEDIATE;

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    username_normalized TEXT NOT NULL UNIQUE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
    must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 部分唯一索引：在数据库层强制全库仅允许存在一名管理员（role = 'admin'）。
CREATE UNIQUE INDEX idx_users_single_admin ON users(role) WHERE role = 'admin';

INSERT INTO users (
    id, username, username_normalized, password_salt, password_hash,
    role, disabled, must_change_password, created_at, updated_at
)
SELECT
    id,
    username,
    lower(username),
    password_salt,
    password_hash,
    'admin',
    0,
    0,
    strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM administrator;

CREATE TABLE sessions_new (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 过期时刻沿用 UTC 毫秒时间戳存储。
    expires_at INTEGER NOT NULL
);

INSERT INTO sessions_new (token, user_id, expires_at)
SELECT token, administrator_id, expires_at
FROM sessions
WHERE administrator_id IN (SELECT id FROM users);

DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);

DROP TABLE administrator;

CREATE TABLE baby_profiles_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL,
    birth_date TEXT NOT NULL,
    gender TEXT NOT NULL CHECK (gender IN ('male', 'female', 'unknown')),
    birth_weight_kg REAL,
    birth_height_cm REAL,
    default_clinic_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT INTO baby_profiles_new (
    id, user_id, nickname, birth_date, gender,
    birth_weight_kg, birth_height_cm, default_clinic_name, created_at, updated_at
)
SELECT
    id,
    COALESCE((SELECT id FROM users WHERE role = 'admin' LIMIT 1), 1),
    nickname,
    birth_date,
    gender,
    birth_weight_kg,
    birth_height_cm,
    default_clinic_name,
    created_at,
    updated_at
FROM baby_profiles;

DROP TABLE baby_profiles;
ALTER TABLE baby_profiles_new RENAME TO baby_profiles;
-- 非唯一复合索引：支持单用户管理多个宝宝并按创建顺序稳定返回。
CREATE INDEX idx_baby_profiles_user_id ON baby_profiles(user_id, id);

COMMIT;

PRAGMA foreign_keys = ON;

-- +goose Down
-- 回滚至单管理员模型：仅保留唯一 admin 与其关联的会话及宝宝档案。
PRAGMA foreign_keys = OFF;

BEGIN IMMEDIATE;

CREATE TABLE administrator (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL
);

INSERT INTO administrator (id, username, password_salt, password_hash)
SELECT 1, username, password_salt, password_hash
FROM users
WHERE role = 'admin'
LIMIT 1;

CREATE TABLE sessions_old (
    token TEXT PRIMARY KEY,
    administrator_id INTEGER NOT NULL DEFAULT 1
        REFERENCES administrator(id) ON DELETE CASCADE CHECK (administrator_id = 1),
    expires_at INTEGER NOT NULL
);

INSERT INTO sessions_old (token, administrator_id, expires_at)
SELECT s.token, 1, s.expires_at
FROM sessions s
JOIN users u ON u.id = s.user_id
WHERE u.role = 'admin';

DROP TABLE sessions;
ALTER TABLE sessions_old RENAME TO sessions;
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE baby_profiles_old (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT NOT NULL,
    birth_date TEXT NOT NULL,
    gender TEXT NOT NULL CHECK (gender IN ('male', 'female', 'unknown')),
    birth_weight_kg REAL,
    birth_height_cm REAL,
    default_clinic_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT INTO baby_profiles_old (
    id, nickname, birth_date, gender,
    birth_weight_kg, birth_height_cm, default_clinic_name, created_at, updated_at
)
SELECT
    b.id, b.nickname, b.birth_date, b.gender,
    b.birth_weight_kg, b.birth_height_cm, b.default_clinic_name, b.created_at, b.updated_at
FROM baby_profiles b
JOIN users u ON u.id = b.user_id
WHERE u.role = 'admin';

DROP TABLE baby_profiles;
ALTER TABLE baby_profiles_old RENAME TO baby_profiles;

DROP INDEX IF EXISTS idx_users_single_admin;
DROP TABLE users;

COMMIT;

PRAGMA foreign_keys = ON;
