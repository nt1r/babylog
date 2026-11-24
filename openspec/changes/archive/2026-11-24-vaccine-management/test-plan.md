# Test Plan

## Unit Tests

| Requirement / Scenario | Verification | Expected Result |
| --- | --- | --- |
| `vaccine-management` / `Idempotent NIP schedule initialization and overview retrieval` / `Compute effective due dates with month-end clamping` | 在 `backend/internal/vaccines/schedule_test.go` 测试自然月日期推算辅助函数：覆盖 `2026-01-31 + 1 月`、`2024-01-31 + 1 月`（闰年）、`2026-08-31 + 6 月`、`0 月龄` 及手动 `planned_date` 覆盖 | 返回 `2026-02-28`、`2024-02-29`、`2027-02-28`、`birth_date` 及显式 `planned_date`，无跨月溢出 |
| `vaccine-management` / `Derived reminder states and birth vaccine quick-confirm eligibility` / `Derive due_soon and overdue states for pending doses` | 使用固定时钟测试 `deriveAlertState` 覆盖 `pending`（`+15天`/`+14天`/`0天`/`-14天`/`-15天`）、`scheduled`（`+8天`/`+7天`/`0天`/`-1天`）与 `completed` 边界 | 分别准确返回 `upcoming`、`due_soon`、`due_soon`、`due_soon`、`overdue`、`scheduled`、`scheduled_soon`、`scheduled_soon`、`scheduled_overdue`、`completed` |
| `vaccine-management` / `Idempotent NIP schedule initialization and overview retrieval` / `Auto-seed NIP baseline on first retrieval` | 在 `backend/internal/vaccines/schedule_test.go` 校验内置目录完整性（8 类 NIP 共 22 剂，百白破为 2/4/6/18/72 月龄；5 类自费模板均有非空风险提示）并在 `backend/internal/vaccines/store_test.go` 测试重复调用 `GetOverview` 的幂等性 | 首次自动写入 22 剂 NIP 记录且全部为 `pending`；二次调用数据库中仍为 22 行，无重复记录 |
| `vaccine-management` / `Dose status transitions and record updates` / `Revert a dose back to pending` | 在 `backend/internal/vaccines/store_test.go` 依次将同一剂次从 `pending` -> `scheduled` -> `completed` -> `pending`，每次更新后从 SQLite 回读整行 | 状态流转成功后，从数据库回读确认废弃可空列已落库为 `NULL`、字符串扩展列已清空 |
| `vaccine-management` / `Batch appointment booking and historical completion` / `Roll back batch update when any dose ID is invalid` | 在 `backend/internal/vaccines/store_test.go` 构造包含一个有效 ID 和一个不存在 ID 的批量操作请求，回读有效 ID 记录 | 返回 `ErrNotFound`，事务完整回滚，有效 ID 记录仍保持原状 |
| `vaccine-management` / `Optional vaccine catalog and custom vaccine dose creation` / `Reject invalid custom vaccine payload` | 测试 `validateCreateInput` 与 `validateUpdateInput` 的非法输入（空名称、空或超限 `doses` 列表、非法分类、越界月龄、非法日期格式、未来接种日期、超长备注） | 全部返回 `*ValidationError` 且携带明确中文错误提示 |

## Integration Tests

| Requirement / Scenario | Verification | Expected Result |
| --- | --- | --- |
| `vaccine-management` / `Authenticated access to vaccine endpoints` / `Reject unauthenticated vaccine request` | 在 `backend/internal/httpapi/vaccines_test.go` 未登录直接请求 `GET /api/vaccines`、`POST /api/vaccines` | HTTP 401，返回结构化中文错误 JSON |
| `vaccine-management` / `Authenticated access to vaccine endpoints` / `Reject vaccine request before baby onboarding` | 已登录但未建档时请求 `GET /api/vaccines` | HTTP 409，返回中文提示要求先完成宝宝建档 |
| `vaccine-management` / `Idempotent NIP schedule initialization and overview retrieval` / `Auto-seed NIP baseline on first retrieval` & `Reject invalid IANA timezone parameter` | 建档后调用 `GET /api/vaccines?tz=Asia/Shanghai` 两次，并请求 `GET /api/vaccines?tz=Invalid/Zone` | 有效请求返回 HTTP 200（22 剂 NIP、`birth_confirm_pending: true`、完整进度统计）；非法时区返回 HTTP 400 |
| `vaccine-management` / `Optional vaccine catalog and custom vaccine dose creation` / `Add an optional vaccine template once with default or customized doses` & `Create a custom vaccine series` | 调用 `GET /api/vaccines/catalog`（核验返回默认剂次明细）、`POST /api/vaccines/from-template`（含自定义剂次与重复添加）、`POST /api/vaccines`（多剂自定义） | 首次添加模板返回 HTTP 201 且再次查询目录 `added: true`；重复添加返回 HTTP 409；多剂自定义返回 HTTP 201 且序号连续 `1..N` |
| `vaccine-management` / `Dose status transitions and record updates` / `Book an appointment for a pending dose`, `Record a completed vaccination`, `Reject completion with out-of-bounds vaccination date` | 经 HTTP `PUT /api/vaccines/:id` 预约、标记接种、传早于出生日期或晚于今天的接种日期，并再次 `GET /api/vaccines` 校验落库结果与 `recent_clinics` 智能回填 | 合法预约/接种均返回 HTTP 200 且持久化终态与 `recent_clinics` 正确；越界接种日期返回 HTTP 400 |
| `vaccine-management` / `Batch appointment booking and historical completion` / `Batch-confirm birth hospital vaccines` | 调用 `POST /api/vaccines/batch` 一键确认乙肝第 1 剂与卡介苗已接种，随后 `GET /api/vaccines` | HTTP 200，两剂均为 `completed`，`birth_confirm_pending` 变为 `false`，NIP 完成数更新为 2 |
| `vaccine-management` / `Controlled deletion, automatic renumbering, and template removal` / `Delete a middle dose and renumber subsequent siblings`, `Remove an entire optional template series`, `Reject deletion of built-in NIP dose` | 调用 `DELETE /api/vaccines/:id` 删除 4 剂模板中的第 2 剂并回读剩余剂次；调用 `DELETE /api/vaccines/template/pcv13` 整套移出；尝试删除 NIP 剂次或 NIP 模板 | 删除第 2 剂后剩余 3 剂落库序号自动重排为 `1/3`、`2/3`、`3/3`；整套移出返回 HTTP 200 且目录恢复 `added: false`；NIP 删除返回 HTTP 400 且数据未被删除 |
