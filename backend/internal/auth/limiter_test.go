package auth_test

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/auth"
)

func TestLoginGuardWindowResetAndConcurrency(t *testing.T) {
	now := time.Date(2026, 11, 25, 10, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }

	t.Run("同一归一化用户名15分钟内连续失败10次后触发限流并按窗口恢复或成功清零", func(t *testing.T) {
		guard := auth.NewLoginGuard().WithClock(clock)

		// 混用大小写记录 10 次失败，前 10 次均允许进入校验。
		for i := 0; i < 10; i++ {
			name := "Alice"
			if i%2 == 1 {
				name = "alice"
			}
			if err := guard.CheckAllowed(name); err != nil {
				t.Fatalf("第 %d 次校验期望放行，实际返回 %v", i+1, err)
			}
			guard.RecordFailure(name)
		}

		// 第 11 次触发限流，且不影响其他用户名。
		if err := guard.CheckAllowed("ALICE"); !errors.Is(err, auth.ErrRateLimited) {
			t.Fatalf("期望第 11 次返回 ErrRateLimited，实际为 %v", err)
		}
		if err := guard.CheckAllowed("bob"); err != nil {
			t.Fatalf("其他用户不应受影响，实际返回 %v", err)
		}

		// 推进 14 分钟仍在窗口内，继续拒绝；推进满 15 分钟后窗口滑出自动恢复。
		now = now.Add(14 * time.Minute)
		if err := guard.CheckAllowed("alice"); !errors.Is(err, auth.ErrRateLimited) {
			t.Fatalf("14 分钟时仍应限流，实际返回 %v", err)
		}
		now = now.Add(1 * time.Minute)
		if err := guard.CheckAllowed("alice"); err != nil {
			t.Fatalf("满 15 分钟后应自动恢复，实际返回 %v", err)
		}

		// 再次累积 5 次失败后记录一次成功，应彻底清零计数。
		for i := 0; i < 5; i++ {
			guard.RecordFailure("alice")
		}
		guard.RecordSuccess("Alice")
		for i := 0; i < 10; i++ {
			if err := guard.CheckAllowed("alice"); err != nil {
				t.Fatalf("成功清零后第 %d 次应放行，实际返回 %v", i+1, err)
			}
			guard.RecordFailure("alice")
		}
	})

	t.Run("全局scrypt并发槽满时立即拒绝并在释放后恢复", func(t *testing.T) {
		guard := auth.NewLoginGuard()
		releases := make([]func(), 0, 8)
		for i := 0; i < 8; i++ {
			rel, err := guard.AcquireScrypt()
			if err != nil {
				t.Fatalf("占用第 %d 个并发槽失败: %v", i+1, err)
			}
			releases = append(releases, rel)
		}

		if _, err := guard.AcquireScrypt(); !errors.Is(err, auth.ErrRateLimited) {
			t.Fatalf("期望第 9 个并发请求返回 ErrRateLimited，实际为 %v", err)
		}

		// 释放幂等且释放后可重新获取。
		releases[0]()
		releases[0]()
		rel, err := guard.AcquireScrypt()
		if err != nil {
			t.Fatalf("释放一个槽位后应重新放行，实际返回 %v", err)
		}
		rel()
		for _, r := range releases[1:] {
			r()
		}
	})

	t.Run("随机用户名洪泛时淘汰冷桶且不挤掉已被限流的账号", func(t *testing.T) {
		floodNow := time.Date(2026, 11, 25, 11, 0, 0, 0, time.UTC)
		guard := auth.NewLoginGuard().WithClock(func() time.Time { return floodNow })

		// 先把 target 触发满 10 次失败进入限流态。
		for i := 0; i < 10; i++ {
			guard.RecordFailure("target")
		}
		if err := guard.CheckAllowed("target"); !errors.Is(err, auth.ErrRateLimited) {
			t.Fatalf("期望 target 已被限流，实际 %v", err)
		}

		// 在同一 15 分钟窗口内洪泛 1500 个随机不存在用户名，触发硬上限淘汰。
		for i := 0; i < 1500; i++ {
			floodNow = floodNow.Add(100 * time.Millisecond)
			guard.RecordFailure(fmt.Sprintf("random-flood-%d", i))
		}

		// 已被限流的 target 桶失败次数更高，不应被单次探测洪泛挤出。
		if err := guard.CheckAllowed("target"); !errors.Is(err, auth.ErrRateLimited) {
			t.Fatalf("随机用户名洪泛不应解除 target 的限流，实际 %v", err)
		}
	})
}
