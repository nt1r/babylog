-- +goose Up
-- 宝宝档案新增常去接种门诊名称（空串表示未设置）；回滚 DROP COLUMN 依赖 SQLite 3.35+。
ALTER TABLE baby_profiles ADD COLUMN default_clinic_name TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE baby_profiles DROP COLUMN default_clinic_name;
