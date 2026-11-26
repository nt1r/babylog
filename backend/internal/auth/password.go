package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/scrypt"
)

const (
	// SessionMaxAgeSeconds 为会话有效期（7 天），同时用于数据库过期时间与 Cookie Max-Age。
	SessionMaxAgeSeconds = 7 * 24 * 60 * 60
	// SessionCookieName 为服务端签发的 HttpOnly 会话 Cookie 名称。
	SessionCookieName = "babylog_session"
	// 用户名与密码长度边界（按 Unicode 字符数统计）。
	MinPasswordLength = 12
	MaxPasswordLength = 1024
	MaxUsernameLength = 128

	// scrypt 派生参数与原 Node.js crypto.scrypt(password, salt, 64) 默认值完全一致，兼容已有 SQLite 数据。
	scryptN      = 16384
	scryptR      = 8
	scryptP      = 1
	scryptKeyLen = 64
	saltByteLen  = 32
	tokenByteLen = 32
	// 32 字节（256 bit）随机令牌经无填充 base64url 编码后长度固定为 ceil(32*4/3) = 43 个 ASCII 字符。
	tokenTextLen = 43
)

var (
	// ErrInvalidCredentials 表示认证凭据（账号或当前密码）不正确。
	ErrInvalidCredentials = errors.New("账号或密码不正确")
	// ErrUserDisabled 表示账号已被管理员停用。
	ErrUserDisabled = errors.New("该账号已被停用，请联系管理员")
	// ErrUserNotFound 表示目标用户不存在。
	ErrUserNotFound = errors.New("用户不存在")
	// ErrUsernameExists 表示归一化用户名已存在（映射 HTTP 409）。
	ErrUsernameExists = errors.New("用户名已存在")
	// ErrAdminExists 表示唯一管理员已存在，禁止重复初始化或创建第二个管理员。
	ErrAdminExists = errors.New("管理员已存在，不能覆盖")
	// ErrAdminProtected 表示禁止在管理接口或停用命令中停用或重置唯一管理员。
	ErrAdminProtected = errors.New("不能对唯一管理员执行此操作")
	// ErrRateLimited 表示触发登录失败频次限制或全局密码校验并发保护（映射 HTTP 429）。
	ErrRateLimited = errors.New("登录尝试过于频繁，请稍后再试")
)

// ValidationError 表示账号参数或密码校验相关的预期业务错误（映射 HTTP 400 或 CLI 中文报错）。
type ValidationError struct {
	Message string
}

// Error 实现内置 error 接口，返回可直接展示给用户的中文错误说明。
func (e *ValidationError) Error() string {
	return e.Message
}

func newValidationError(msg string) error {
	return &ValidationError{Message: msg}
}

// NormalizeUsername 返回用于判重与不区分大小写登录查询的归一化用户名。
func NormalizeUsername(username string) string {
	return strings.ToLower(username)
}

// ValidateUsername 校验用户名长度（1-128 字符）及首尾不可含空白。
// 使用 utf8.RuneCountInString 按 Unicode 字符数计数，确保中文按单字符统计。
func ValidateUsername(username string) error {
	length := utf8.RuneCountInString(username)
	if length == 0 || length > MaxUsernameLength || strings.TrimSpace(username) != username {
		return newValidationError("用户名须为 1 至 128 个字符，且首尾不能有空白")
	}
	return nil
}

// ValidatePassword 校验密码长度（12-1024 字符）；刻意不做 TrimSpace，原样保留密码中的空白字符。
func ValidatePassword(password string) error {
	length := utf8.RuneCountInString(password)
	if length < MinPasswordLength || length > MaxPasswordLength {
		return newValidationError("密码长度须为 12 至 1024 个字符")
	}
	return nil
}

// IsSessionToken 判断给定字符串是否为合法的 43 位无填充 base64url 会话令牌。
// 在查库前先做快速格式拦截，过滤畸形或恶意构造的 Cookie 值。
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

func deriveEncodedCredentials(password string) (saltB64, hashB64 string, err error) {
	salt, err := generateRandomBytes(saltByteLen)
	if err != nil {
		return "", "", err
	}
	hash, err := derivePassword(password, salt)
	if err != nil {
		return "", "", fmt.Errorf("派生密码哈希失败: %w", err)
	}
	return base64.StdEncoding.EncodeToString(salt), base64.StdEncoding.EncodeToString(hash), nil
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
