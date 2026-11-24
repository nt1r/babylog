-- +goose Up
ALTER TABLE baby_profiles ADD COLUMN default_clinic_name TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE baby_profiles DROP COLUMN default_clinic_name;
