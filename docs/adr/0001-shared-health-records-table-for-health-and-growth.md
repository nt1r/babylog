---
status: accepted
---

# Health 与 Growth 复用同一张 `health_records` 表与记录接口

`Health`（体温、用药）与 `Growth`（体重/身高/头围、出牙）在前端呈现为两个独立工作区（`/health` 与 `/growth`），但在后端刻意共享 `health_records` 表与 `/api/records/health` 读写接口，通过逗号分隔的 `subtype` 筛选（`temperature,medicine` vs `growth,teeth`）隔离视图与 `daily_summaries`。单宝宝家庭场景下共用存储避免了数据库迁移拆表与重复 CRUD/校验/分页骨架，代价是 `HealthRecord` 包含按子类型互斥的可空列（依赖 `Select` 显式列清单与集成测试守护跨子类型清零），后续审查无需将其视为需拆表的表结构缺陷。
