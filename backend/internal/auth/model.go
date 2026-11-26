// Package auth 实现 BabyLog 的多用户凭据管理、单管理员约束、scrypt 密码校验、登录限流与 SQLite 会话生命周期。
package auth

const (
	// RoleAdmin 为唯一系统管理员角色，负责其他用户的账号生命周期管理。
	RoleAdmin = "admin"
	// RoleUser 为普通家庭用户角色，仅可管理自身归属的宝宝档案与育儿数据。
	RoleUser = "user"
)

// AuthUser 表示对外返回的已认证用户会话投影，不含密码盐、哈希等敏感字段。
type AuthUser struct {
	ID                 int64  `json:"id"`
	Username           string `json:"username"`
	Role               string `json:"role"`
	MustChangePassword bool   `json:"must_change_password"`
}

// UserSummary 表示管理员用户管理列表与操作接口返回的账号元数据（刻意不含宝宝数或记录数，恪守隐私隔离）。
type UserSummary struct {
	ID                 int64  `json:"id"`
	Username           string `json:"username"`
	Role               string `json:"role"`
	Disabled           bool   `json:"disabled"`
	MustChangePassword bool   `json:"must_change_password"`
	CreatedAt          string `json:"created_at"`
}

// User 对应 SQLite 中的 users 用户表。
type User struct {
	ID                 int64  `gorm:"column:id;primaryKey;autoIncrement"`
	Username           string `gorm:"column:username;not null"`
	UsernameNormalized string `gorm:"column:username_normalized;not null;uniqueIndex"`
	PasswordSalt       string `gorm:"column:password_salt;not null"`
	PasswordHash       string `gorm:"column:password_hash;not null"`
	Role               string `gorm:"column:role;not null;default:'user'"`
	Disabled           bool   `gorm:"column:disabled;not null;default:false"`
	MustChangePassword bool   `gorm:"column:must_change_password;not null;default:false"`
	CreatedAt          string `gorm:"column:created_at;not null"`
	UpdatedAt          string `gorm:"column:updated_at;not null"`
}

// TableName 显式绑定 GORM 模型到 users 表。
func (User) TableName() string {
	return "users"
}

func (u User) toAuthUser() *AuthUser {
	return &AuthUser{
		ID:                 u.ID,
		Username:           u.Username,
		Role:               u.Role,
		MustChangePassword: u.MustChangePassword,
	}
}

func (u User) toSummary() UserSummary {
	return UserSummary{
		ID:                 u.ID,
		Username:           u.Username,
		Role:               u.Role,
		Disabled:           u.Disabled,
		MustChangePassword: u.MustChangePassword,
		CreatedAt:          u.CreatedAt,
	}
}

// Session 对应 SQLite 中的 sessions 会话表，ExpiresAt 以 UTC 毫秒时间戳存储。
type Session struct {
	Token     string `gorm:"column:token;primaryKey"`
	UserID    int64  `gorm:"column:user_id;not null"`
	ExpiresAt int64  `gorm:"column:expires_at;not null"`
}

// TableName 显式绑定 GORM 模型到 sessions 表。
func (Session) TableName() string {
	return "sessions"
}
