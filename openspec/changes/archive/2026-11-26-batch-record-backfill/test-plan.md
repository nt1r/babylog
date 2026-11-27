# Test Plan

遵循 [AGENTS.md](../../../AGENTS.md) 与 [docs/testing-guide.md](../../../docs/testing-guide.md)：常驻自动化测试仅限后端 Go 测试（纯单元校验 + 黑盒 HTTP API 全链路集成测试），零第三方测试依赖；前端纯 TS 编解码逻辑（`batch-codec.ts`）与 UI 视觉交互采用仓库外临时目录验证并在结束时清理。

## Unit Tests

| Requirement / Scenario | Verification | Expected Result |
| --- | --- | --- |
| `daily-records` / `Atomic batch creation of feeding and care records` / `Create feeding and care records atomically in a single batch`, `Reject empty or oversized batch record payload`, `Roll back entire batch when any item fails validation` | 在 `backend/internal/records/validate_test.go` 新增表驱动单测 `TestValidateBatchCreate`，注入固定时钟覆盖：（1）混合亲喂、瓶喂母乳、配方奶与合并 `both` 尿布（含备注裁剪）；（2）空数组与全 `nil` 载荷；（3）超上限 21 条载荷；（4）含非法奶量/非法尿布类型/超前 5 分钟未来时间戳的单条异常项 | 合法混合批量返回完整归一化切片且数量准确；0 条返回 `*ValidationError`（「请至少填写一项记录」）；21 条返回 `*ValidationError`（「单次最多批量提交 20 条记录」）；任一异常项返回带序号中文提示的 `*ValidationError` |

## Integration Tests

| Requirement / Scenario | Verification | Expected Result |
| --- | --- | --- |
| `daily-records` / `Atomic batch creation of feeding and care records` / `Create feeding and care records atomically in a single batch` | 在 `backend/internal/integration/daily_records_test.go` 新增 `TestRecordsBatchCreateAtomicityAndSummaryIntegration`：经真实 HTTP `POST /api/babies/:babyId/records/batch` 在同一时间戳与公共备注下提交 3 条喂养（亲喂左 15 分、瓶喂母乳 40 ml、配方奶 60 ml）+ 1 条合并 `diaper_kind: "both"`（软便/黄色）护理记录；随后通过 `GET /records/feeding`、`GET /records/care`、`GET /records/defaults`、`GET /dashboard/summary` 及只读 SQLite 回读核验 | 返回 HTTP 201 且响应含 3 条 `feedings`（带真实自增 `id`）与 1 条 `cares`；列表查询、喂养每日小计（`total_ml: 100`, `direct_breast_count: 1`, `direct_breast_min: 15`, `total_count: 3`）、护理每日小计（`pee_count: 1`, `poop_count: 1`, `total_count: 1`）、看板今日 KPI 及智能默认值全部准确反映且公共备注落库一致 |
| `daily-records` / `Atomic batch creation of feeding and care records` / `Reject empty or oversized batch record payload`, `Roll back entire batch when any item fails validation`, `Reject batch record write for unauthenticated or foreign baby scope` | 在 `backend/internal/integration/daily_records_test.go` 新增 `TestRecordsBatchCreateValidationRollbackAndAuthGuards`：覆盖未认证（401）、待强制改密普通用户（403）、他人宝宝 `:babyId` 与不存在 `:babyId`（404）、空批次（0 条，400）、超限批次（21 条，400）、合法喂养混入非法护理项（400）、合法护理混入未来超前 >5 分钟喂养项（400）以及未知 JSON 字段（400），并在每个拒绝步骤后只读查询 SQLite `feeding_records` 与 `care_records` 行数 | 各鉴权/隔离/校验边界均返回准确 HTTP 状态码与中文错误 JSON；特别是混合合法与非法项时整事务完整回滚，SQLite 两张目标表均保持 0 脏写 |

> 说明：`dashboard-insights` 下 `Batch backfill drawer for feeding and care records` 属于纯前端 Web 交互规格（`The web application SHALL`），按项目测试边界不纳入常驻前端自动化测试，实施阶段通过系统临时目录的纯 TS 逻辑断言脚本与免登录亮/暗双态（390px 移动 + 桌面）截屏审图完成验证。
