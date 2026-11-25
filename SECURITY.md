# 安全政策

BabyLog 用于记录家庭与宝宝的日常健康数据，非常重视认证、会话及本地数据的安全性。

## 支持的版本

| 版本 | 支持安全更新 |
| --- | --- |
| `main` / 最新版本 | 是 |

## 漏洞披露方式

如果你发现任何安全漏洞（包括但不限于认证绕过、会话泄露、CSRF、路径穿越、敏感信息暴露），**请勿在公开 Issue 中披露**。

请通过 GitHub Security Advisories 私下报告：

- https://github.com/nt1r/babylog/security/advisories/new

报告中请尽量包含：
1. 漏洞影响的模块、版本或提交哈希；
2. 最小复现步骤或概念验证；
3. 可能的影响范围与修复建议（如有）。

维护者会尽快确认评估并在修复发布后协调公开说明。

## 自托管安全建议

- 管理员与 CLI 用户管理（`babylog admin init`、`babylog user create` / `reset-password`）所使用的密码文件应存放在仓库之外，并限制文件权限（如 `0600`），操作完成后可按需妥善保管或移除；
- 为新家庭成员创建或重置临时密码时建议启用强制首次改密（Web 端默认开启，CLI 可传 `--force-change`），并通过安全渠道一次性传递临时密码；
- 唯一 `admin` 账号无法通过 Web 端停用或重置密码，如遗忘管理员密码请在宿主机执行 `babylog user reset-password --username <admin> --password-file <path>` 恢复；
- `BABYLOG_DATA_DIR`（默认 `data/`）包含 SQLite 数据库，请做好备份并避免纳入版本控制；
- 若通过公网访问，请在反向代理层启用 HTTPS（TLS）、配置合理的访问控制，并设置环境变量 `BABYLOG_COOKIE_SECURE=true` 确保会话 Cookie 始终携带 `Secure` 标记。
