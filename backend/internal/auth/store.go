package auth

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/nt1r/babylog/backend/internal/timeutil"
)

// Store 基于 GORM + SQLite 管理多用户凭据、单管理员约束、用户生命周期、会话存储以及内部登录防爆破与 scrypt 并发保护。
type Store struct {
	db    *gorm.DB
	now   func() time.Time
	guard *loginGuard
}

// NewStore 创建认证存储实例。
func NewStore(db *gorm.DB) *Store {
	return &Store{
		db:    db,
		now:   time.Now,
		guard: newLoginGuard(),
	}
}

// WithClock 替换内部时钟函数（同步作用于会话过期与 15 分钟登录限流窗口），返回自身以支持链式调用。
func (s *Store) WithClock(fn func() time.Time) *Store {
	if fn != nil {
		s.now = fn
		s.guard.setClock(fn)
	}
	return s
}

func isUniqueConstraintError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	return strings.Contains(strings.ToLower(err.Error()), "unique constraint failed")
}

// InitializeAdministrator 初始化全局唯一管理员（role = 'admin'），若已存在管理员则返回 [ErrAdminExists]，
// 若用户名已被占用则返回 [ErrUsernameExists]，scrypt 并发槽满时返回 [ErrRateLimited]。
// 密码派生在数据库事务之外执行并在完成后立即释放并发槽，避免占用 SQLite 单写连接或 CPU 槽位。
func (s *Store) InitializeAdministrator(ctx context.Context, username, password string) error {
	if err := ValidateUsername(username); err != nil {
		return err
	}
	if err := ValidatePassword(password); err != nil {
		return err
	}

	var adminCount int64
	if err := s.db.WithContext(ctx).Model(&User{}).Where("role = ?", RoleAdmin).Count(&adminCount).Error; err != nil {
		return fmt.Errorf("查询管理员状态失败: %w", err)
	}
	if adminCount > 0 {
		return ErrAdminExists
	}

	normName := NormalizeUsername(username)
	var nameCount int64
	if err := s.db.WithContext(ctx).Model(&User{}).Where("username_normalized = ?", normName).Count(&nameCount).Error; err != nil {
		return fmt.Errorf("查询用户名状态失败: %w", err)
	}
	if nameCount > 0 {
		return ErrUsernameExists
	}

	release, err := s.guard.acquireScrypt()
	if err != nil {
		return err
	}
	defer release()

	saltB64, hashB64, err := deriveEncodedCredentials(password)
	release()
	if err != nil {
		return err
	}

	ts := timeutil.FormatUTC(s.now())
	user := User{
		Username:           username,
		UsernameNormalized: normName,
		PasswordSalt:       saltB64,
		PasswordHash:       hashB64,
		Role:               RoleAdmin,
		Disabled:           false,
		MustChangePassword: false,
		CreatedAt:          ts,
		UpdatedAt:          ts,
	}
	if err := s.db.WithContext(ctx).Create(&user).Error; err != nil {
		if isUniqueConstraintError(err) {
			if strings.Contains(strings.ToLower(err.Error()), "users.role") {
				return ErrAdminExists
			}
			return ErrUsernameExists
		}
		return fmt.Errorf("写入管理员记录失败: %w", err)
	}
	return nil
}

// CreateUser 创建普通家庭用户（固定 role = 'user'），重名（忽略大小写）时返回 [ErrUsernameExists]，
// scrypt 并发槽满时返回 [ErrRateLimited]。
func (s *Store) CreateUser(ctx context.Context, username, password string, mustChangePassword bool) (*UserSummary, error) {
	if err := ValidateUsername(username); err != nil {
		return nil, err
	}
	if err := ValidatePassword(password); err != nil {
		return nil, err
	}

	normName := NormalizeUsername(username)
	var existing int64
	if err := s.db.WithContext(ctx).Model(&User{}).Where("username_normalized = ?", normName).Count(&existing).Error; err != nil {
		return nil, fmt.Errorf("查询用户名状态失败: %w", err)
	}
	if existing > 0 {
		return nil, ErrUsernameExists
	}

	release, err := s.guard.acquireScrypt()
	if err != nil {
		return nil, err
	}
	defer release()

	saltB64, hashB64, err := deriveEncodedCredentials(password)
	release()
	if err != nil {
		return nil, err
	}

	ts := timeutil.FormatUTC(s.now())
	user := User{
		Username:           username,
		UsernameNormalized: normName,
		PasswordSalt:       saltB64,
		PasswordHash:       hashB64,
		Role:               RoleUser,
		Disabled:           false,
		MustChangePassword: mustChangePassword,
		CreatedAt:          ts,
		UpdatedAt:          ts,
	}
	if err := s.db.WithContext(ctx).Create(&user).Error; err != nil {
		if isUniqueConstraintError(err) {
			return nil, ErrUsernameExists
		}
		return nil, fmt.Errorf("创建用户失败: %w", err)
	}
	summary := user.toSummary()
	return &summary, nil
}

// ListUsers 按创建顺序返回全部用户的非敏感账号元数据列表（绝不关联宝宝或记录统计）。
func (s *Store) ListUsers(ctx context.Context) ([]UserSummary, error) {
	var users []User
	if err := s.db.WithContext(ctx).Order("id ASC").Find(&users).Error; err != nil {
		return nil, fmt.Errorf("查询用户列表失败: %w", err)
	}
	out := make([]UserSummary, 0, len(users))
	for _, u := range users {
		out = append(out, u.toSummary())
	}
	return out, nil
}

// SetUserDisabledByID 按用户 ID 停用或启用普通用户；尝试停用唯一管理员返回 [ErrAdminProtected]，
// 停用时在同一事务内吊销该用户的全部活跃会话。
func (s *Store) SetUserDisabledByID(ctx context.Context, userID int64, disabled bool) (*UserSummary, error) {
	return s.setUserDisabled(ctx, func(tx *gorm.DB) *gorm.DB {
		return tx.Where("id = ?", userID)
	}, disabled)
}

// SetUserDisabledByUsername 按归一化用户名停用或启用普通用户（供 CLI 维护使用）。
func (s *Store) SetUserDisabledByUsername(ctx context.Context, username string, disabled bool) (*UserSummary, error) {
	if err := ValidateUsername(username); err != nil {
		return nil, err
	}
	return s.setUserDisabled(ctx, func(tx *gorm.DB) *gorm.DB {
		return tx.Where("username_normalized = ?", NormalizeUsername(username))
	}, disabled)
}

func (s *Store) setUserDisabled(ctx context.Context, locate func(*gorm.DB) *gorm.DB, disabled bool) (*UserSummary, error) {
	nowStr := timeutil.FormatUTC(s.now())
	var updated User
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := locate(tx).Take(&updated).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrUserNotFound
			}
			return err
		}
		if updated.Role == RoleAdmin {
			return ErrAdminProtected
		}
		updated.Disabled = disabled
		updated.UpdatedAt = nowStr
		if err := tx.Model(&updated).Select("disabled", "updated_at").Updates(&updated).Error; err != nil {
			return err
		}
		if disabled {
			if err := tx.Where("user_id = ?", updated.ID).Delete(&Session{}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	summary := updated.toSummary()
	return &summary, nil
}

// ResetUserPasswordByID 供 Web 管理员接口重置指定普通用户密码（默认拒绝重置唯一管理员并返回 [ErrAdminProtected]，
// scrypt 并发槽满时返回 [ErrRateLimited]），在单事务内更新哈希、标记 mustChangePassword 并吊销该用户全部活跃会话。
func (s *Store) ResetUserPasswordByID(ctx context.Context, userID int64, newPassword string, mustChangePassword bool) (*UserSummary, error) {
	return s.resetUserPassword(ctx, func(tx *gorm.DB) *gorm.DB {
		return tx.Where("id = ?", userID)
	}, newPassword, mustChangePassword, false)
}

// ResetUserPasswordByUsername 供宿主机 CLI 重置任意用户（包含唯一管理员救灾场景）密码（scrypt 并发槽满时返回 [ErrRateLimited]），
// 在单事务内更新哈希、设置 mustChangePassword 并吊销该用户全部活跃会话。
func (s *Store) ResetUserPasswordByUsername(ctx context.Context, username, newPassword string, mustChangePassword bool) (*UserSummary, error) {
	if err := ValidateUsername(username); err != nil {
		return nil, err
	}
	return s.resetUserPassword(ctx, func(tx *gorm.DB) *gorm.DB {
		return tx.Where("username_normalized = ?", NormalizeUsername(username))
	}, newPassword, mustChangePassword, true)
}

func (s *Store) resetUserPassword(ctx context.Context, locate func(*gorm.DB) *gorm.DB, newPassword string, mustChangePassword bool, allowAdmin bool) (*UserSummary, error) {
	if err := ValidatePassword(newPassword); err != nil {
		return nil, err
	}

	// 先查一次目标用户状态，避免目标不存在或受保护时浪费 scrypt CPU，同时把 scrypt 放在写事务之外。
	var preview User
	if err := locate(s.db.WithContext(ctx)).Take(&preview).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("查询用户失败: %w", err)
	}
	if preview.Role == RoleAdmin && !allowAdmin {
		return nil, ErrAdminProtected
	}

	release, err := s.guard.acquireScrypt()
	if err != nil {
		return nil, err
	}
	defer release()

	saltB64, hashB64, err := deriveEncodedCredentials(newPassword)
	release()
	if err != nil {
		return nil, err
	}

	nowStr := timeutil.FormatUTC(s.now())
	var updated User
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ?", preview.ID).Take(&updated).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrUserNotFound
			}
			return err
		}
		if updated.Role == RoleAdmin && !allowAdmin {
			return ErrAdminProtected
		}
		updated.PasswordSalt = saltB64
		updated.PasswordHash = hashB64
		updated.MustChangePassword = mustChangePassword
		updated.UpdatedAt = nowStr
		if err := tx.Model(&updated).Select("password_salt", "password_hash", "must_change_password", "updated_at").Updates(&updated).Error; err != nil {
			return err
		}
		return tx.Where("user_id = ?", updated.ID).Delete(&Session{}).Error
	})
	if err != nil {
		return nil, err
	}
	summary := updated.toSummary()
	return &summary, nil
}

// Login 执行完整用户登录流程：按归一化用户名防爆破限流、获取全局 scrypt 并发槽、常量时间校验凭据、
// 按结果更新失败计数并轮换签发新会话令牌。停用账号密码正确时返回 [ErrUserDisabled]（不计入失败次数）；
// 凭据错误记录失败并返回 [ErrInvalidCredentials]；触发限流或并发槽满返回 [ErrRateLimited]。
func (s *Store) Login(ctx context.Context, username, password, previousToken string) (*AuthUser, string, error) {
	if err := s.guard.checkAllowed(username); err != nil {
		return nil, "", err
	}
	release, err := s.guard.acquireScrypt()
	if err != nil {
		return nil, "", err
	}
	defer release()

	user, err := s.Authenticate(ctx, username, password)
	release()
	if err != nil {
		return nil, "", err
	}
	if user == nil {
		s.guard.recordFailure(username)
		return nil, "", ErrInvalidCredentials
	}

	s.guard.recordSuccess(username)
	newToken, err := s.CreateSession(ctx, user.ID, previousToken)
	if err != nil {
		return nil, "", err
	}
	return user, newToken, nil
}

// Authenticate 按不区分大小写的归一化用户名执行底层凭据校验（不含防爆破限流与 scrypt 并发保护，HTTP 登录须统一调用 [Store.Login]）：
// 无论账号是否存在都会执行完整 scrypt 派生与常量时间比对，缓解时序侧信道；
// 仅当密码校验通过且账号被停用时返回 [ErrUserDisabled]，其余凭据错误统一返回 (nil, nil)。
func (s *Store) Authenticate(ctx context.Context, username, password string) (*AuthUser, error) {
	var user User
	err := s.db.WithContext(ctx).Where("username_normalized = ?", NormalizeUsername(username)).Take(&user).Error
	exists := true
	if errors.Is(err, gorm.ErrRecordNotFound) {
		exists = false
	} else if err != nil {
		return nil, fmt.Errorf("查询用户记录失败: %w", err)
	}

	// 用户不存在时使用全零占位盐与期望哈希，确保下方 scrypt 执行同等计算量。
	salt := make([]byte, saltByteLen)
	expected := make([]byte, scryptKeyLen)
	if exists {
		decodedSalt, decSaltErr := base64.StdEncoding.DecodeString(user.PasswordSalt)
		if decSaltErr != nil {
			return nil, fmt.Errorf("解析用户密码盐失败: %w", decSaltErr)
		}
		decodedHash, decHashErr := base64.StdEncoding.DecodeString(user.PasswordHash)
		if decHashErr != nil {
			return nil, fmt.Errorf("解析用户密码哈希失败: %w", decHashErr)
		}
		salt = decodedSalt
		expected = decodedHash
	}

	actual, err := derivePassword(password, salt)
	if err != nil {
		return nil, fmt.Errorf("校验密码派生失败: %w", err)
	}

	passwordMatches := constantTimeEqualBytes(actual, expected)
	if !exists || !passwordMatches {
		return nil, nil
	}
	if user.Disabled {
		return nil, ErrUserDisabled
	}
	return user.toAuthUser(), nil
}

// ChangePassword 校验当前密码并更新用户新密码（scrypt 并发槽满时返回 [ErrRateLimited]），清除 must_change_password 标记，
// 同时在单事务内吊销该用户全部历史会话并签发轮换后的新会话令牌。
func (s *Store) ChangePassword(ctx context.Context, userID int64, currentPassword, newPassword string) (*AuthUser, string, error) {
	if err := ValidatePassword(newPassword); err != nil {
		return nil, "", err
	}

	var user User
	if err := s.db.WithContext(ctx).Where("id = ?", userID).Take(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, "", ErrUserNotFound
		}
		return nil, "", fmt.Errorf("查询用户记录失败: %w", err)
	}
	if user.Disabled {
		return nil, "", ErrUserDisabled
	}

	decodedSalt, err := base64.StdEncoding.DecodeString(user.PasswordSalt)
	if err != nil {
		return nil, "", fmt.Errorf("解析用户密码盐失败: %w", err)
	}
	decodedHash, err := base64.StdEncoding.DecodeString(user.PasswordHash)
	if err != nil {
		return nil, "", fmt.Errorf("解析用户密码哈希失败: %w", err)
	}
	release, err := s.guard.acquireScrypt()
	if err != nil {
		return nil, "", err
	}
	defer release()

	actual, err := derivePassword(currentPassword, decodedSalt)
	if err != nil {
		return nil, "", fmt.Errorf("校验当前密码失败: %w", err)
	}
	if !constantTimeEqualBytes(actual, decodedHash) {
		return nil, "", ErrInvalidCredentials
	}
	if user.MustChangePassword && constantTimeEqualString(currentPassword, newPassword) {
		return nil, "", newValidationError("新密码不能与初始密码相同")
	}

	saltB64, hashB64, err := deriveEncodedCredentials(newPassword)
	release()
	if err != nil {
		return nil, "", err
	}
	newToken, err := generateSessionToken()
	if err != nil {
		return nil, "", err
	}

	now := s.now()
	nowStr := timeutil.FormatUTC(now)
	nowMs := now.UnixMilli()
	expiresAt := nowMs + int64(SessionMaxAgeSeconds)*1000

	expectedHash := user.PasswordHash
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 条件更新防 TOCTOU：若在 scrypt 派生窗口内该账号被管理员停用或重置密码，则拒绝覆盖并回滚。
		res := tx.Model(&User{}).
			Where("id = ? AND disabled = 0 AND password_hash = ?", user.ID, expectedHash).
			Updates(map[string]any{
				"password_salt":        saltB64,
				"password_hash":        hashB64,
				"must_change_password": false,
				"updated_at":           nowStr,
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			var latest User
			if err := tx.Where("id = ?", user.ID).Take(&latest).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrUserNotFound
				}
				return err
			}
			if latest.Disabled {
				return ErrUserDisabled
			}
			return ErrInvalidCredentials
		}

		user.PasswordSalt = saltB64
		user.PasswordHash = hashB64
		user.MustChangePassword = false
		user.UpdatedAt = nowStr

		if err := tx.Where("user_id = ?", user.ID).Delete(&Session{}).Error; err != nil {
			return err
		}
		if err := tx.Where("expires_at <= ?", nowMs).Delete(&Session{}).Error; err != nil {
			return err
		}
		return tx.Create(&Session{
			Token:     newToken,
			UserID:    user.ID,
			ExpiresAt: expiresAt,
		}).Error
	})
	if err != nil {
		if errors.Is(err, ErrUserNotFound) || errors.Is(err, ErrUserDisabled) || errors.Is(err, ErrInvalidCredentials) {
			return nil, "", err
		}
		return nil, "", fmt.Errorf("更新密码失败: %w", err)
	}
	return user.toAuthUser(), newToken, nil
}

// GetSession 根据会话令牌恢复有效且未停用的用户身份；令牌非法、过期、不存在或用户已停用时返回 (nil, nil) 并惰性清理。
func (s *Store) GetSession(ctx context.Context, token string) (*AuthUser, error) {
	if !IsSessionToken(token) {
		return nil, nil
	}

	nowMs := s.now().UnixMilli()
	var result struct {
		ID                 int64  `gorm:"column:id"`
		Username           string `gorm:"column:username"`
		Role               string `gorm:"column:role"`
		MustChangePassword bool   `gorm:"column:must_change_password"`
	}
	err := s.db.WithContext(ctx).
		Model(&Session{}).
		Select("users.id AS id, users.username AS username, users.role AS role, users.must_change_password AS must_change_password").
		Joins("JOIN users ON users.id = sessions.user_id").
		Where("sessions.token = ? AND sessions.expires_at > ? AND users.disabled = 0", token, nowMs).
		Take(&result).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		_ = s.RevokeSession(ctx, token)
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("查询会话失败: %w", err)
	}

	return &AuthUser{
		ID:                 result.ID,
		Username:           result.Username,
		Role:               result.Role,
		MustChangePassword: result.MustChangePassword,
	}, nil
}

// CreateSession 在单个事务内完成会话轮换（吊销当前浏览器旧令牌、清理已过期会话并写入归属 userID 的新令牌）。
func (s *Store) CreateSession(ctx context.Context, userID int64, previousToken string) (string, error) {
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
		return tx.Create(&Session{
			Token:     token,
			UserID:    userID,
			ExpiresAt: expiresAt,
		}).Error
	})
	if err != nil {
		return "", fmt.Errorf("创建会话失败: %w", err)
	}
	return token, nil
}

// RevokeSession 精准吊销指定会话令牌，不影响同用户其他端或其他用户的会话。
func (s *Store) RevokeSession(ctx context.Context, token string) error {
	if !IsSessionToken(token) {
		return nil
	}
	if err := s.db.WithContext(ctx).Where("token = ?", token).Delete(&Session{}).Error; err != nil {
		return fmt.Errorf("吊销会话失败: %w", err)
	}
	return nil
}
