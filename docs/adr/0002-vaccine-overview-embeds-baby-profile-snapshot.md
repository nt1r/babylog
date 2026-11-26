---
status: accepted
---

# 疫苗总览响应内联宝宝档案快照，且常去门诊写路径归属 `baby` 模块

`GET /api/vaccines` 响应刻意回传 `Baby Profile` 的 `birth_date` 与 `default_clinic_name`（与 `GET /api/baby` 双出），确保疫苗页与日历导出在单次响应内获得一致的 `birth_date` / `today` / 默认门诊快照，避免家长修改出生日期后两路请求竞态。同时，行内快捷接口 `PUT /api/vaccines/default-clinic` 保留在疫苗路由前缀下，但持久化与校验唯一归属 `internal/baby`（由 `router.go` 直接交 `babyHandler` 承接，并由 `vaccines.Store` 在写入事务内调用 `baby.SyncDefaultClinicTx`），防止跨表原生 SQL 与长度规则漂移。
