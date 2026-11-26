# Test Plan

## Unit Tests

None — 本次后端仅在 `dashboard.Service.GetTrends` 中复用已有的 `records.AccumulateFeedingSummary` 与 `timeutil` 工具函数聚合亲喂时长与次数，不引入新的纯计算模块；聚合逻辑与 HTTP 响应契约通过集成测试覆盖真实数据库查询与时区边界。

## Integration Tests

| Requirement / Scenario | Verification | Expected Result |
| --- | --- | --- |
| `dashboard-insights` / `Seven-day feeding, sleep, and care rhythm trends` / `Return contiguous 7-day trend series with zero-filled empty days` | 复用并扩展 `TestDashboardTimezoneSummaryAndCrossMidnightTrends`，校验空日记录的 `feeding_ml`、`direct_breast_min`、`direct_breast_count`、`sleep_hours` | HTTP 200，返回连续 7 天数据，空日上述 4 个字段均为 `0` |
| `dashboard-insights` / `Seven-day feeding, sleep, and care rhythm trends` / `Aggregate daily direct breastfeeding minutes and counts in local timezone` | 在 `TestDashboardTimezoneSummaryAndCrossMidnightTrends` 中写入跨 UTC 零点的亲喂记录（如 `2026-11-22T16:40:00Z` 即上海时间 `2026-11-23 00:40`）与常规时段亲喂记录，请求 `GET /api/dashboard/trends?days=7&tz=Asia/Shanghai` | HTTP 200，对应本地自然日 `2026-11-23` 的 `direct_breast_min` 为当日亲喂分钟之和、`direct_breast_count` 为亲喂次数，且 `feeding_ml` 不受亲喂影响 |
| `dashboard-insights` / `Seven-day feeding, sleep, and care rhythm trends` / `Split cross-midnight sleep accurately across consecutive trend days` | 复用既有 `TestDashboardTimezoneSummaryAndCrossMidnightTrends` 中的跨夜睡眠断言 | HTTP 200，前一日与当日分别计入准确切分后的小时数 |
