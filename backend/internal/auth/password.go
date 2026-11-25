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
	// SessionMaxAgeSeconds 为会话有效期（7 天），同时用于数据库过期时间与 Cookie Max-Age。
	SessionMaxAgeSeconds = 7 * 24 * 60 * 60
	// SessionCookieName 为服务端签发的 HttpOnly 会话 Cookie 名称。
	SessionCookieName = "babylog_session"
	// 管理员用户名与密码长度边界（按 Unicode 字符数统计）。
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

// AdministratorError 表示管理员初始化或参数校验相关的预期业务错误。
// 调用方（如 CLI）可通过 errors.As 识别该类型并直接向用户展示中文 Message。
type AdministratorError struct {
	Message string
}

// Error 实现 Go 内置的 error 接口（Go 采用隐式接口，只要方法签名匹配即满足接口，无需显式声明 implements）。
func (e *AdministratorError) Error() string {
	return e.Message
}

func newAdministratorError(msg string) error {
	return &AdministratorError{Message: msg}
}

// ValidateUsername 校验管理员用户名长度（1-128 字符）及首尾不可含空白。
// 使用 utf8.RuneCountInString 按 Unicode 字符数（而非 len 返回的 UTF-8 字节数）计数，确保中文按单字符统计。
func ValidateUsername(username string) error {
	length := utf8.RuneCountInString(username)
	if length == 0 || length > MaxUsernameLength || strings.TrimSpace(username) != username {
		return newAdministratorError("管理员用户名须为 1 至 128 个字符，且首尾不能有空白")
	}
	return nil
}

// ValidatePassword 校验管理员密码长度（12-1024 字符）；刻意不做 TrimSpace，原样保留密码中的空白字符。
func ValidatePassword(password string) error {
	length := utf8.RuneCountInString(password)
	if length < MinPasswordLength || length > MaxPasswordLength {
		return newAdministratorError("管理员密码长度须为 12 至 1024 个字符")
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

// generateRandomBytes 使用 crypto/rand（操作系统密码学安全随机源，而非 math/rand）生成指定长度随机字节。
func generateRandomBytes(n int) ([]byte, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return nil, fmt.Errorf("生成随机数失败: %w", err)
	}
	return buf, nil
}

// generateSessionToken 生成 256 位随机字节并编码为 URL 安全、无 `=` 填充的 base64url 令牌。
func generateSessionToken() (string, error) {
	buf, err := generateRandomBytes(tokenByteLen)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// constantTimeEqualBytes 使用 subtle.ConstantTimeCompare 做常量时间字节比对，
// 防止攻击者根据普通比较提前退出的耗时差异推断密码哈希内容。
func constantTimeEqualBytes(a, b []byte) bool {
	return len(a) == len(b) && subtle.ConstantTimeCompare(a, b) == 1
}

func constantTimeEqualString(a, b string) bool {
	return constantTimeEqualBytes([]byte(a), []byte(b))
}
