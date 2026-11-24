// Package auth 实现 BabyLog 的单管理员凭据管理、scrypt 密码校验与 SQLite 会话生命周期。
package auth

// AdminUser 表示对外返回的已认证管理员信息。
// 字段后的反引号 `json:"..."` 是 Go 结构体标签（struct tag），用于指定 JSON 序列化后的字段名。
type AdminUser struct {
	Username string `json:"username"`
	Role     string `json:"role"`
}

// Administrator 对应 SQLite 中的 administrator 单行管理员表。
// `gorm:"..."` 标签声明结构体字段与数据库列名、主键及非空约束的映射关系。
type Administrator struct {
	ID           int    `gorm:"column:id;primaryKey"`
	Username     string `gorm:"column:username;not null"`
	PasswordSalt string `gorm:"column:password_salt;not null"`
	PasswordHash string `gorm:"column:password_hash;not null"`
}

// TableName 实现 GORM 的 Tabler 接口，显式指定表名为单数 administrator（覆盖默认的复数推断）。
func (Administrator) TableName() string {
	return "administrator"
}

// Session 对应 SQLite 中的 sessions 会话表，ExpiresAt 以 UTC 毫秒时间戳存储。
type Session struct {
	Token           string `gorm:"column:token;primaryKey"`
	AdministratorID int    `gorm:"column:administrator_id;not null;default:1"`
	ExpiresAt       int64  `gorm:"column:expires_at;not null"`
}

// TableName 显式绑定 GORM 模型到 sessions 表。
func (Session) TableName() string {
	return "sessions"
}
