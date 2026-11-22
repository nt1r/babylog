package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/scrypt"
)

const (
	SessionMaxAgeSeconds = 7 * 24 * 60 * 60
	SessionCookieName    = "babylog_session"
	MinPasswordLength    = 12
	MaxPasswordLength    = 1024
	MaxUsernameLength    = 128

	// 与原 Node.js crypto.scrypt(password, salt, 64) 默认参数完全一致，兼容已有 SQLite 数据。
	scryptN      = 16384
	scryptR      = 8
	scryptP      = 1
	scryptKeyLen = 64
	saltByteLen  = 32
	tokenByteLen = 32
	tokenTextLen = 43
)

// AdministratorError 表示管理员初始化或参数校验相关的预期业务错误。
type AdministratorError struct {
	Message string
}

func (e *AdministratorError) Error() string {
	return e.Message
}

func newAdministratorError(msg string) error {
	return &AdministratorError{Message: msg}
}

// ValidateUsername 校验管理员用户名长度（1-128 字符）及首尾不可含空白。
func ValidateUsername(username string) error {
	length := utf8.RuneCountInString(username)
	if length == 0 || length > MaxUsernameLength || strings.TrimSpace(username) != username {
		return newAdministratorError("管理员用户名须为 1 至 128 个字符，且首尾不能有空白")
	}
	return nil
}

// ValidatePassword 校验管理员密码长度（12-1024 字符）。
func ValidatePassword(password string) error {
	length := utf8.RuneCountInString(password)
	if length < MinPasswordLength || length > MaxPasswordLength {
		return newAdministratorError("管理员密码长度须为 12 至 1024 个字符")
	}
	return nil
}

// IsSessionToken 判断给定字符串是否为 43 位无填充 base64url 会话令牌。
func IsSessionToken(token string) bool {
	if len(token) != tokenTextLen {
		return false
	}
	for i := 0; i < len(token); i++ {
		c := token[i]
		isUpper := c >= 'A' && c <= 'Z'
		isLower := c >= 'a' && c <= 'z'
		isDigit := c >= '0' && c <= '9'
		if !isUpper && !isLower && !isDigit && c != '-' && c != '_' {
			return false
		}
	}
	return true
}

func derivePassword(password string, salt []byte) ([]byte, error) {
	return scrypt.Key([]byte(password), salt, scryptN, scryptR, scryptP, scryptKeyLen)
}

func generateRandomBytes(n int) ([]byte, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return nil, fmt.Errorf("生成随机数失败: %w", err)
	}
	return buf, nil
}

func generateSessionToken() (string, error) {
	buf, err := generateRandomBytes(tokenByteLen)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func constantTimeEqualBytes(a, b []byte) bool {
	return len(a) == len(b) && subtle.ConstantTimeCompare(a, b) == 1
}

func constantTimeEqualString(a, b string) bool {
	return constantTimeEqualBytes([]byte(a), []byte(b))
}
