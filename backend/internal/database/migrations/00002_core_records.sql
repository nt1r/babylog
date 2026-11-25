-- +goose Up
-- 宝宝档案与四大日常记录表：
-- 时间戳列（recorded_at / started_at / ended_at / created_at / updated_at）统一存储 UTC RFC3339 文本（字典序与时间先后等价），
-- birth_date 存储本地自然日 YYYY-MM-DD；四类记录采用单表多子类型（STI）+ 可空专属列设计。
CREATE TABLE IF NOT EXISTS baby_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT NOT NULL,
    birth_date TEXT NOT NULL,
    gender TEXT NOT NULL CHECK (gender IN ('male', 'female', 'unknown')),
    birth_weight_kg REAL,
    birth_height_cm REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feeding_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES baby_profiles(id) ON DELETE CASCADE,
    subtype TEXT NOT NULL CHECK (subtype IN ('breast', 'formula', 'solid')),
    feeding_mode TEXT CHECK (feeding_mode IS NULL OR feeding_mode IN ('direct', 'bottle')),
    breast_side TEXT CHECK (breast_side IS NULL OR breast_side IN ('left', 'right', 'both')),
    amount_ml INTEGER,
    duration_min INTEGER,
    solid_food TEXT,
    solid_amount TEXT,
    acceptance TEXT CHECK (acceptance IS NULL OR acceptance IN ('like', 'neutral', 'dislike')),
    recorded_at TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feeding_baby_recorded ON feeding_records(baby_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_feeding_baby_subtype_recorded ON feeding_records(baby_id, subtype, recorded_at DESC);

CREATE TABLE IF NOT EXISTS sleep_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES baby_profiles(id) ON DELETE CASCADE,
    subtype TEXT NOT NULL CHECK (subtype IN ('nap', 'night')),
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    duration_min INTEGER NOT NULL CHECK (duration_min > 0),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 双时间索引：started_at 支撑列表倒序分页，ended_at 支撑跨夜睡眠重叠窗口查询（ended_at > start AND started_at < end）。
CREATE INDEX IF NOT EXISTS idx_sleep_baby_started ON sleep_records(baby_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sleep_baby_ended ON sleep_records(baby_id, ended_at DESC);

CREATE TABLE IF NOT EXISTS care_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES baby_profiles(id) ON DELETE CASCADE,
    subtype TEXT NOT NULL CHECK (subtype IN ('diaper', 'bath', 'other')),
    diaper_kind TEXT CHECK (diaper_kind IS NULL OR diaper_kind IN ('pee', 'poop', 'both')),
    stool_consistency TEXT CHECK (stool_consistency IS NULL OR stool_consistency IN ('watery', 'soft', 'formed', 'hard')),
    stool_color TEXT CHECK (stool_color IS NULL OR stool_color IN ('yellow', 'green', 'brown', 'abnormal')),
    care_title TEXT,
    recorded_at TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_care_baby_recorded ON care_records(baby_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_care_baby_subtype_recorded ON care_records(baby_id, subtype, recorded_at DESC);

-- 同时承载健康观察（temperature / medicine，/health）与生长发育（growth / teeth，/growth）两个工作区数据。
CREATE TABLE IF NOT EXISTS health_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES baby_profiles(id) ON DELETE CASCADE,
    subtype TEXT NOT NULL CHECK (subtype IN ('temperature', 'medicine', 'growth', 'teeth')),
    temperature_c REAL,
    medicine_name TEXT,
    medicine_dosage TEXT,
    weight_kg REAL,
    height_cm REAL,
    head_cm REAL,
    tooth_note TEXT,
    recorded_at TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_health_baby_recorded ON health_records(baby_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_baby_subtype_recorded ON health_records(baby_id, subtype, recorded_at DESC);

-- +goose Down
DROP INDEX IF EXISTS idx_health_baby_subtype_recorded;
DROP INDEX IF EXISTS idx_health_baby_recorded;
DROP TABLE IF EXISTS health_records;

DROP INDEX IF EXISTS idx_care_baby_subtype_recorded;
DROP INDEX IF EXISTS idx_care_baby_recorded;
DROP TABLE IF EXISTS care_records;

DROP INDEX IF EXISTS idx_sleep_baby_ended;
DROP INDEX IF EXISTS idx_sleep_baby_started;
DROP TABLE IF EXISTS sleep_records;

DROP INDEX IF EXISTS idx_feeding_baby_subtype_recorded;
DROP INDEX IF EXISTS idx_feeding_baby_recorded;
DROP TABLE IF EXISTS feeding_records;

DROP TABLE IF EXISTS baby_profiles;
