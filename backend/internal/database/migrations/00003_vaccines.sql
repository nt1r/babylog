-- +goose Up
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
