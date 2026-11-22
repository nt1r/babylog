// Package auth 实现 BabyLog 的单管理员凭据管理、scrypt 密码校验与 SQLite 会话生命周期。
package auth

// AdminUser 表示对外返回的已认证管理员信息。
type AdminUser struct {
	Username string `json:"username"`
	Role     string `json:"role"`
}

// Administrator 对应 SQLite 中的 administrator 单行管理员表。
type Administrator struct {
	ID           int    `gorm:"column:id;primaryKey"`
	Username     string `gorm:"column:username;not null"`
	PasswordSalt string `gorm:"column:password_salt;not null"`
	PasswordHash string `gorm:"column:password_hash;not null"`
}

func (Administrator) TableName() string {
	return "administrator"
}

// Session 对应 SQLite 中的 sessions 会话表。
type Session struct {
	Token           string `gorm:"column:token;primaryKey"`
	AdministratorID int    `gorm:"column:administrator_id;not null;default:1"`
	ExpiresAt       int64  `gorm:"column:expires_at;not null"`
}

func (Session) TableName() string {
	return "sessions"
}
