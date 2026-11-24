package auth

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Store 基于 GORM + SQLite 管理单管理员凭据与会话生命周期。
// 内部持有可替换的时钟函数字段 now（默认指向 time.Now），便于测试注入固定时钟。
type Store struct {
	db  *gorm.DB
	now func() time.Time
}

// NewStore 创建认证存储实例。
func NewStore(db *gorm.DB) *Store {
	return &Store{
		db:  db,
		now: time.Now,
	}
}

// WithClock 替换内部时钟函数（用于确定性测试会话过期等时间行为），返回自身以支持链式调用。
func (s *Store) WithClock(fn func() time.Time) *Store {
	if fn != nil {
		s.now = fn
	}
	return s
}

// InitializeAdministrator 初始化唯一管理员（id = 1），若已存在则拒绝覆盖并返回 [*AdministratorError]。
func (s *Store) InitializeAdministrator(ctx context.Context, username, password string) error {
	if err := ValidateUsername(username); err != nil {
		return err
	}
	if err := ValidatePassword(password); err != nil {
		return err
	}

	// 1. 先检查是否已初始化，避免重复执行耗时的 scrypt 派生；s.db.WithContext(ctx) 会把请求取消信号透传给 SQLite。
	var count int64
	if err := s.db.WithContext(ctx).Model(&Administrator{}).Where("id = ?", 1).Count(&count).Error; err != nil {
		return fmt.Errorf("查询管理员状态失败: %w", err)
	}
	if count > 0 {
		return newAdministratorError("管理员已存在，不能覆盖")
	}

	// 2. 生成独立随机盐并派生密码哈希，落库仅保存 Base64 编码后的盐与哈希，不存明文密码。
	salt, err := generateRandomBytes(saltByteLen)
	if err != nil {
		return err
	}
	hash, err := derivePassword(password, salt)
	if err != nil {
		return fmt.Errorf("派生密码哈希失败: %w", err)
	}

	admin := Administrator{
		ID:           1,
		Username:     username,
		PasswordSalt: base64.StdEncoding.EncodeToString(salt),
		PasswordHash: base64.StdEncoding.EncodeToString(hash),
	}
	// 3. 借助主键 id=1 + ON CONFLICT DO NOTHING 防御并发初始化竞态：若冲突未插入则 RowsAffected 为 0。
	res := s.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&admin)
	if res.Error != nil {
		return fmt.Errorf("写入管理员记录失败: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return newAdministratorError("管理员已存在，不能覆盖")
	}
	return nil
}

// Authenticate 验证管理员用户名与密码；认证失败返回 (nil, nil)，仅底层故障时返回非 nil error。
// 无论管理员是否已初始化，都会执行一次完整的 scrypt 派生与常量时间比对，缓解响应耗时差异带来的时序侧信道。
func (s *Store) Authenticate(ctx context.Context, username, password string) (*AdminUser, error) {
	var admin Administrator
	err := s.db.WithContext(ctx).Where("id = ?", 1).Take(&admin).Error
	exists := true
	if errors.Is(err, gorm.ErrRecordNotFound) {
		exists = false
	} else if err != nil {
		return nil, fmt.Errorf("查询管理员记录失败: %w", err)
	}

	// 未初始化时使用全零占位盐与期望哈希，保证下方 scrypt 仍执行同等计算量。
	salt := make([]byte, saltByteLen)
	expected := make([]byte, scryptKeyLen)
	if exists {
		decodedSalt, decSaltErr := base64.StdEncoding.DecodeString(admin.PasswordSalt)
		if decSaltErr != nil {
			return nil, fmt.Errorf("解析管理员密码盐失败: %w", decSaltErr)
		}
		decodedHash, decHashErr := base64.StdEncoding.DecodeString(admin.PasswordHash)
		if decHashErr != nil {
			return nil, fmt.Errorf("解析管理员密码哈希失败: %w", decHashErr)
		}
		salt = decodedSalt
		expected = decodedHash
	}

	actual, err := derivePassword(password, salt)
	if err != nil {
		return nil, fmt.Errorf("校验密码派生失败: %w", err)
	}

	// 同时完成密码与用户名比对后再统一返回，不暴露具体是用户名还是密码错误。
	passwordMatches := constantTimeEqualBytes(actual, expected)
	usernameMatches := constantTimeEqualString(username, admin.Username)
	if !exists || !passwordMatches || !usernameMatches {
		return nil, nil
	}
	return &AdminUser{
		Username: admin.Username,
		Role:     "admin",
	}, nil
}

// GetSession 根据会话令牌恢复有效管理员身份；若令牌格式非法、已过期或不存在则返回 (nil, nil) 并尝试清理残留记录。
func (s *Store) GetSession(ctx context.Context, token string) (*AdminUser, error) {
	if !IsSessionToken(token) {
		return nil, nil
	}

	nowMs := s.now().UnixMilli()
	// 使用局部匿名结构体仅扫描 JOIN 查询所需的 username 列，避免定义多余的命名类型。
	var result struct {
		Username string `gorm:"column:username"`
	}
	err := s.db.WithContext(ctx).
		Table("sessions").
		Select("administrator.username AS username").
		Joins("JOIN administrator ON administrator.id = sessions.administrator_id").
		Where("sessions.token = ? AND sessions.expires_at > ?", token, nowMs).
		Take(&result).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// 令牌可能已过期，顺手按 token 惰性删除残留行；清理失败不影响本次返回未认证态。
		_ = s.RevokeSession(ctx, token)
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("查询会话失败: %w", err)
	}

	return &AdminUser{
		Username: result.Username,
		Role:     "admin",
	}, nil
}

// CreateSession 在单个事务内完成会话轮换（吊销旧令牌、清理全部已过期历史会话并写入新令牌），
// 防止会话固定攻击（Session Fixation）并控制 sessions 表体积。
func (s *Store) CreateSession(ctx context.Context, previousToken string) (string, error) {
	token, err := generateSessionToken()
	if err != nil {
		return "", err
	}

	nowMs := s.now().UnixMilli()
	expiresAt := nowMs + int64(SessionMaxAgeSeconds)*1000

	// GORM Transaction 闭包返回 nil 时自动提交，返回非 nil error 或 panic 时自动回滚。
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if IsSessionToken(previousToken) {
			if delErr := tx.Where("token = ?", previousToken).Delete(&Session{}).Error; delErr != nil {
				return delErr
			}
		}
		if cleanErr := tx.Where("expires_at <= ?", nowMs).Delete(&Session{}).Error; cleanErr != nil {
			return cleanErr
		}
		session := Session{
			Token:           token,
			AdministratorID: 1,
			ExpiresAt:       expiresAt,
		}
		return tx.Create(&session).Error
	})
	if err != nil {
		return "", fmt.Errorf("创建会话失败: %w", err)
	}
	return token, nil
}

// RevokeSession 吊销指定会话令牌。
func (s *Store) RevokeSession(ctx context.Context, token string) error {
	if !IsSessionToken(token) {
		return nil
	}
	if err := s.db.WithContext(ctx).Where("token = ?", token).Delete(&Session{}).Error; err != nil {
		return fmt.Errorf("吊销会话失败: %w", err)
	}
	return nil
}
