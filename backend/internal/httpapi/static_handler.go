package httpapi

import (
	"bytes"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/nt1r/babylog/backend/internal/webui"
)

const notBuiltMessage = "页面尚未构建，请先运行 pnpm build；开发时请访问 Vite 开发服务器"

type staticHandler struct {
	distDir         string
	fallbackDistDir string
	embeddedFS      fs.FS
	logger          *slog.Logger
}

// newStaticHandler 初始化静态文件处理器：仅在未显式指定 distDir 时探测内嵌文件系统，
// 并以打开 index.html 验证构建产物非空，防止空内嵌目录屏蔽本地 fallbackDistDir。
func newStaticHandler(distDir, fallbackDistDir string, logger *slog.Logger) *staticHandler {
	var embedded fs.FS
	if distDir == "" {
		if sub, err := webui.DistFS(); err == nil {
			if f, openErr := sub.Open("index.html"); openErr == nil {
				_ = f.Close()
				embedded = sub
			}
		}
	}
	return &staticHandler{
		distDir:         distDir,
		fallbackDistDir: fallbackDistDir,
		embeddedFS:      embedded,
		logger:          logger,
	}
}

// serve 提供静态文件托管与单页应用（SPA）回退：
// 1. 仅允许 GET/HEAD，并对原始路径做反编码及空字节/路径穿越检查；
// 2. 命中真实静态文件直接返回；未命中且无文件扩展名时回退到 index.html；
// 3. 缺失静态资源返回 404，尚未构建前端时给出中文构建指引。
func (h *staticHandler) serve(c *gin.Context) {
	if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
		c.JSON(http.StatusMethodNotAllowed, gin.H{"error": "不支持此请求方法"})
		return
	}

	// 优先读取 RawPath，避免 net/http 提前解码或规整 %2e%2e 造成穿越检查遗漏。
	rawPath := c.Request.URL.RawPath
	if rawPath == "" {
		rawPath = c.Request.URL.Path
	}

	decoded, err := url.PathUnescape(rawPath)
	if err != nil || strings.ContainsRune(decoded, '\x00') {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求路径无效"})
		return
	}
	if decoded == "" {
		decoded = "/"
	}

	if hasUnsafePathSegment(decoded) {
		c.JSON(http.StatusNotFound, gin.H{"error": "文件不存在"})
		return
	}

	targetRel := "index.html"
	if decoded != "/" {
		targetRel = strings.TrimPrefix(decoded, "/")
	}

	served, serveErr := h.serveFile(c, targetRel)
	if served {
		return
	}
	if serveErr != nil {
		h.logger.Error("serve static file failed", "path", targetRel, "error", serveErr)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
		return
	}

	// 无扩展名的前端路由回退到 index.html，缺失的静态资源仍返回 404。
	allowSpaFallback := path.Ext(decoded) == "" && decoded != "/"
	if allowSpaFallback {
		servedFallback, fallbackErr := h.serveFile(c, "index.html")
		if servedFallback {
			return
		}
		if fallbackErr != nil {
			h.logger.Error("serve SPA fallback failed", "path", "index.html", "error", fallbackErr)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器暂时无法处理请求"})
			return
		}
	}

	if decoded == "/" || allowSpaFallback {
		c.JSON(http.StatusNotFound, gin.H{"error": notBuiltMessage})
		return
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "文件不存在"})
}

// hasUnsafePathSegment 拒绝包含反斜杠或相对段（. / ..）的请求路径。
func hasUnsafePathSegment(decodedPath string) bool {
	if strings.Contains(decodedPath, "\\") {
		return true
	}
	for _, seg := range strings.Split(decodedPath, "/") {
		if seg == "." || seg == ".." {
			return true
		}
	}
	return false
}

// serveFile 按“外部 BABYLOG_DIST_DIR > 内嵌 embed.FS > 工作目录 dist/”优先级查找并响应静态文件。
func (h *staticHandler) serveFile(c *gin.Context, relPath string) (bool, error) {
	if !fs.ValidPath(relPath) {
		return false, nil
	}

	// 1. 显式指定 BABYLOG_DIST_DIR 时优先从外部磁盘目录读取。
	if h.distDir != "" {
		return serveFromDiskRoot(c, h.distDir, relPath)
	}

	// 2. 生产单二进制优先使用内嵌前端产物。
	if h.embeddedFS != nil {
		return serveFromFS(c, h.embeddedFS, relPath)
	}

	// 3. 本地构建前端后直接运行时回退检查调用方注入的默认产物目录（如工作目录下的 dist/）。
	if h.fallbackDistDir == "" {
		return false, nil
	}
	return serveFromDiskRoot(c, h.fallbackDistDir, relPath)
}

// serveFromDiskRoot 通过 os.OpenRoot 在受限根目录内打开普通文件，防止符号链接与父目录逃逸。
func serveFromDiskRoot(c *gin.Context, dir, relPath string) (bool, error) {
	root, err := os.OpenRoot(dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	defer func() { _ = root.Close() }()

	file, err := root.Open(relPath)
	if err != nil {
		if isNotFoundOrEscaped(err) {
			return false, nil
		}
		return false, err
	}
	defer func() { _ = file.Close() }()

	info, err := file.Stat()
	if err != nil {
		return false, err
	}
	if !info.Mode().IsRegular() {
		return false, nil
	}

	applyStaticHeaders(c, relPath)
	http.ServeContent(c.Writer, c.Request, info.Name(), info.ModTime(), file)
	return true, nil
}

// applyStaticHeaders 为 PWA 关键资源补充显式 MIME 与缓存策略：
// 1. .webmanifest 显式声明 application/manifest+json，防止精简系统缺少扩展名映射；
// 2. index.html、sw.js 与 manifest.webmanifest 使用 no-cache，确保发版后立即发现更新；
// 3. Vite 生成的带内容哈希 /assets/* 文件启用长期不可变缓存，加快主屏幕二次启动。
func applyStaticHeaders(c *gin.Context, relPath string) {
	if strings.HasSuffix(relPath, ".webmanifest") {
		c.Header("Content-Type", "application/manifest+json; charset=utf-8")
		c.Header("Cache-Control", "no-cache")
		return
	}
	if relPath == "sw.js" || relPath == "index.html" {
		c.Header("Cache-Control", "no-cache")
		return
	}
	if strings.HasPrefix(relPath, "assets/") {
		c.Header("Cache-Control", "public, max-age=31536000, immutable")
	}
}

// isNotFoundOrEscaped 判断错误是否属于资源缺失、无效路径或 os.Root 拦截的路径/符号链接逃逸。
func isNotFoundOrEscaped(err error) bool {
	if errors.Is(err, fs.ErrNotExist) || errors.Is(err, fs.ErrInvalid) || errors.Is(err, syscall.ENOTDIR) {
		return true
	}
	return strings.Contains(err.Error(), "escapes from parent")
}

// serveFromFS 从抽象只读文件系统（如生产单二进制内嵌的 embed.FS）读取并响应静态文件。
func serveFromFS(c *gin.Context, fsys fs.FS, relPath string) (bool, error) {
	file, err := fsys.Open(relPath)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	defer func() { _ = file.Close() }()

	info, err := file.Stat()
	if err != nil {
		return false, err
	}
	if info.IsDir() {
		return false, nil
	}

	applyStaticHeaders(c, relPath)
	// http.ServeContent 需要 io.ReadSeeker 以支持 Range 请求与条件缓存；
	// embed.FS 打开的文件通常已实现该接口，通过接口断言优先零拷贝输出，否则兜底读入内存再包装。
	if seeker, ok := file.(io.ReadSeeker); ok {
		http.ServeContent(c.Writer, c.Request, info.Name(), info.ModTime(), seeker)
		return true, nil
	}

	data, err := io.ReadAll(file)
	if err != nil {
		return false, err
	}
	http.ServeContent(c.Writer, c.Request, info.Name(), time.Time{}, bytes.NewReader(data))
	return true, nil
}
