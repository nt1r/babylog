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

// InitializeAdministrator 初始化唯一管理员（id = 1），若已存在则拒绝覆盖。
func (s *Store) InitializeAdministrator(ctx context.Context, username, password string) error {
	if err := ValidateUsername(username); err != nil {
		return err
	}
	if err := ValidatePassword(password); err != nil {
		return err
	}

	var count int64
	if err := s.db.WithContext(ctx).Model(&Administrator{}).Where("id = ?", 1).Count(&count).Error; err != nil {
		return fmt.Errorf("查询管理员状态失败: %w", err)
	}
	if count > 0 {
		return newAdministratorError("管理员已存在，不能覆盖")
	}

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
	res := s.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&admin)
	if res.Error != nil {
		return fmt.Errorf("写入管理员记录失败: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return newAdministratorError("管理员已存在，不能覆盖")
	}
	return nil
}

// Authenticate 验证管理员用户名与密码；无论管理员是否存在均执行 scrypt 派生以缓解时序侧信道。
func (s *Store) Authenticate(ctx context.Context, username, password string) (*AdminUser, error) {
	var admin Administrator
	err := s.db.WithContext(ctx).Where("id = ?", 1).Take(&admin).Error
	exists := true
	if errors.Is(err, gorm.ErrRecordNotFound) {
		exists = false
	} else if err != nil {
		return nil, fmt.Errorf("查询管理员记录失败: %w", err)
	}

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

// GetSession 根据会话令牌恢复有效管理员身份；若令牌已过期或不存在则尝试清理并返回 nil。
func (s *Store) GetSession(ctx context.Context, token string) (*AdminUser, error) {
	if !IsSessionToken(token) {
		return nil, nil
	}

	nowMs := s.now().UnixMilli()
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

// CreateSession 创建新会话并轮换旧令牌，同时清理已过期的历史会话。
func (s *Store) CreateSession(ctx context.Context, previousToken string) (string, error) {
	token, err := generateSessionToken()
	if err != nil {
		return "", err
	}

	nowMs := s.now().UnixMilli()
	expiresAt := nowMs + int64(SessionMaxAgeSeconds)*1000

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
