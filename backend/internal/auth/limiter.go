package auth

import (
	"sync"
	"time"
)

const (
	// loginMaxFailures 为单账号在滑动窗口内允许的最大连续登录失败次数。
	loginMaxFailures = 10
	// loginFailureWindow 为单账号登录失败统计滑动窗口时长（15 分钟）。
	loginFailureWindow = 15 * time.Minute
	// maxConcurrentScrypt 为全局并发 scrypt 密码派生上限，防止突发登录请求打满 CPU。
	maxConcurrentScrypt = 8
	// maxTrackedFailureKeys 为内存中按用户名追踪失败桶的容量上限；超限时清理过期桶并淘汰最冷单次桶，
	// 避免恶意随机用户名洪泛造成内存无限增长或挤掉正在限流中的账号。
	maxTrackedFailureKeys = 1024
)

// loginGuard 为 Store 内部的零外部依赖内存防爆破限流（按归一化用户名滑动窗口）与全局 scrypt 并发保护。
type loginGuard struct {
	mu       sync.Mutex
	now      func() time.Time
	failures map[string][]time.Time
	sem      chan struct{}
}

// newLoginGuard 创建默认配置的内部登录防护守卫实例。
func newLoginGuard() *loginGuard {
	return &loginGuard{
		now:      time.Now,
		failures: make(map[string][]time.Time),
		sem:      make(chan struct{}, maxConcurrentScrypt),
	}
}

// setClock 替换内部时钟函数（随 Store.WithClock 同步，用于确定性测试 15 分钟窗口过期恢复）。
func (g *loginGuard) setClock(fn func() time.Time) *loginGuard {
	if fn != nil {
		g.mu.Lock()
		g.now = fn
		g.mu.Unlock()
	}
	return g
}

// checkAllowed 校验目标归一化用户名在当前 15 分钟窗口内是否未达失败上限；超限时返回 [ErrRateLimited]。
func (g *loginGuard) checkAllowed(username string) error {
	key := NormalizeUsername(username)
	g.mu.Lock()
	defer g.mu.Unlock()

	now := g.now()
	kept := pruneExpired(g.failures[key], now)
	if len(kept) == 0 {
		delete(g.failures, key)
		return nil
	}
	g.failures[key] = kept
	if len(kept) >= loginMaxFailures {
		return ErrRateLimited
	}
	return nil
}

// recordFailure 记录一次针对目标归一化用户名的登录失败；桶数触达上限时清理过期桶并淘汰最冷桶，确保内存严格有界。
func (g *loginGuard) recordFailure(username string) {
	key := NormalizeUsername(username)
	g.mu.Lock()
	defer g.mu.Unlock()

	now := g.now()
	if _, exists := g.failures[key]; !exists && len(g.failures) >= maxTrackedFailureKeys {
		var victimKey string
		var victimCount int
		var victimTime time.Time
		hasVictim := false
		for k, times := range g.failures {
			pruned := pruneExpired(times, now)
			if len(pruned) == 0 {
				delete(g.failures, k)
				continue
			}
			g.failures[k] = pruned
			last := pruned[len(pruned)-1]
			// 优先淘汰失败次数最少且最近失败最早的桶，防止随机用户名洪泛把正在被限流的真实账号挤出记忆表。
			if !hasVictim || len(pruned) < victimCount || (len(pruned) == victimCount && last.Before(victimTime)) {
				victimKey = k
				victimCount = len(pruned)
				victimTime = last
				hasVictim = true
			}
		}
		if len(g.failures) >= maxTrackedFailureKeys && hasVictim {
			delete(g.failures, victimKey)
		}
	}

	kept := pruneExpired(g.failures[key], now)
	kept = append(kept, now)
	g.failures[key] = kept
}

// recordSuccess 在目标用户登录成功后清零其失败计数桶。
func (g *loginGuard) recordSuccess(username string) {
	key := NormalizeUsername(username)
	g.mu.Lock()
	delete(g.failures, key)
	g.mu.Unlock()
}

// acquireScrypt 尝试占用一个全局 scrypt 并发槽位；槽满时立即返回 [ErrRateLimited]，
// 成功时返回一次性释放函数（须通过 defer 调用）。
func (g *loginGuard) acquireScrypt() (func(), error) {
	select {
	case g.sem <- struct{}{}:
		var once sync.Once
		return func() {
			once.Do(func() {
				<-g.sem
			})
		}, nil
	default:
		return nil, ErrRateLimited
	}
}

func pruneExpired(times []time.Time, now time.Time) []time.Time {
	if len(times) == 0 {
		return nil
	}
	cutoff := now.Add(-loginFailureWindow)
	idx := 0
	for idx < len(times) && !times[idx].After(cutoff) {
		idx++
	}
	if idx == len(times) {
		return nil
	}
	if idx == 0 {
		return times
	}
	kept := make([]time.Time, len(times)-idx)
	copy(kept, times[idx:])
	return kept
}
