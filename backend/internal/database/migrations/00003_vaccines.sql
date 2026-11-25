-- +goose Up
-- 单宝宝疫苗接种计划表：planned_date / scheduled_date / vaccinated_at 存本地自然日 YYYY-MM-DD，
-- scheduled_time 存本地时刻 HH:MM，created_at / updated_at 存 UTC RFC3339。
CREATE TABLE IF NOT EXISTS vaccine_doses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL REFERENCES baby_profiles(id) ON DELETE CASCADE,
    template_code TEXT,
    dose_number INTEGER NOT NULL CHECK (dose_number > 0),
    total_doses INTEGER NOT NULL CHECK (total_doses >= dose_number),
    vaccine_name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('nip', 'optional')),
    age_months INTEGER NOT NULL CHECK (age_months >= 0),
    age_label TEXT NOT NULL,
    planned_date TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'scheduled', 'completed')),
    scheduled_date TEXT,
    scheduled_time TEXT,
    clinic_name TEXT NOT NULL DEFAULT '',
    vaccinated_at TEXT,
    site TEXT NOT NULL DEFAULT '',
    manufacturer TEXT NOT NULL DEFAULT '',
    batch_no TEXT NOT NULL DEFAULT '',
    reaction TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 部分唯一索引：仅对内置/模板疫苗（template_code IS NOT NULL）约束 (baby_id, template_code, dose_number) 唯一，
-- 既保证 NIP 懒初始化幂等与自费模板防重导入，又放行家长自由创建多条自定义疫苗（template_code IS NULL）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_vaccine_doses_baby_template_dose
    ON vaccine_doses(baby_id, template_code, dose_number)
    WHERE template_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vaccine_doses_baby_age
    ON vaccine_doses(baby_id, age_months, dose_number, id);

CREATE INDEX IF NOT EXISTS idx_vaccine_doses_baby_status
    ON vaccine_doses(baby_id, status);

-- +goose Down
DROP INDEX IF EXISTS idx_vaccine_doses_baby_status;
DROP INDEX IF EXISTS idx_vaccine_doses_baby_age;
DROP INDEX IF EXISTS idx_vaccine_doses_baby_template_dose;
DROP TABLE IF EXISTS vaccine_doses;
