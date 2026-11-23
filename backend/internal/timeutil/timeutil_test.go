package timeutil

import (
	"testing"
	"time"
)

func TestLoadLocation(t *testing.T) {
	loc, err := LoadLocation("")
	if err != nil {
		t.Fatalf("empty tz should fallback to default, got err: %v", err)
	}
	if loc.String() != DefaultTimezone {
		t.Fatalf("expected %s, got %s", DefaultTimezone, loc.String())
	}

	utcLoc, err := LoadLocation("UTC")
	if err != nil || utcLoc.String() != "UTC" {
		t.Fatalf("expected UTC, got %v, err=%v", utcLoc, err)
	}

	for _, bad := range []string{"Invalid/Zone", "Local", "Mars/Olympus"} {
		if _, err := LoadLocation(bad); err == nil {
			t.Errorf("expected error for tz %q, got nil", bad)
		}
	}
}

func TestIsBeyondFutureSkew(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	if IsBeyondFutureSkew(now.Add(-1*time.Hour), now) {
		t.Error("past time should not be beyond future skew")
	}
	if IsBeyondFutureSkew(now.Add(4*time.Minute), now) {
		t.Error("+4m should be within 5m future skew")
	}
	if !IsBeyondFutureSkew(now.Add(6*time.Minute), now) {
		t.Error("+6m should be rejected as beyond future skew")
	}
}

func TestSplitIntervalMinutesByLocalDay(t *testing.T) {
	shanghai, err := LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatalf("load shanghai: %v", err)
	}

	// 单日睡眠：14:00 - 14:45
	s1 := time.Date(2026, 11, 23, 14, 0, 0, 0, shanghai)
	e1 := time.Date(2026, 11, 23, 14, 45, 0, 0, shanghai)
	got1 := SplitIntervalMinutesByLocalDay(s1, e1, shanghai)
	if len(got1) != 1 || got1["2026-11-23"] != 45 {
		t.Fatalf("unexpected single-day split: %#v", got1)
	}

	// 跨夜睡眠：22:00 -> 次日 06:00（前一天 120 分钟，次日 360 分钟）
	s2 := time.Date(2026, 11, 22, 22, 0, 0, 0, shanghai)
	e2 := time.Date(2026, 11, 23, 6, 0, 0, 0, shanghai)
	got2 := SplitIntervalMinutesByLocalDay(s2, e2, shanghai)
	if got2["2026-11-22"] != 120 || got2["2026-11-23"] != 360 {
		t.Fatalf("unexpected cross-midnight split: %#v", got2)
	}

	// 跨多日边界（极端 26 小时区间）
	s3 := time.Date(2026, 11, 21, 23, 0, 0, 0, shanghai)
	e3 := time.Date(2026, 11, 23, 1, 0, 0, 0, shanghai)
	got3 := SplitIntervalMinutesByLocalDay(s3, e3, shanghai)
	if got3["2026-11-21"] != 60 || got3["2026-11-22"] != 1440 || got3["2026-11-23"] != 60 {
		t.Fatalf("unexpected multi-day split: %#v", got3)
	}

	// 带秒跨零点边界（23:59:20 -> 次日 00:00:40），应分别四舍五入为 1 分钟，不被截断为 0。
	s4 := time.Date(2026, 11, 22, 23, 59, 20, 0, shanghai)
	e4 := time.Date(2026, 11, 23, 0, 0, 40, 0, shanghai)
	got4 := SplitIntervalMinutesByLocalDay(s4, e4, shanghai)
	if got4["2026-11-22"] != 1 || got4["2026-11-23"] != 1 {
		t.Fatalf("unexpected sub-minute boundary split: %#v", got4)
	}
}

func TestRecentLocalDateKeys(t *testing.T) {
	shanghai, err := LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatalf("load shanghai: %v", err)
	}

	now := time.Date(2026, 11, 23, 0, 30, 0, 0, shanghai)
	keys := RecentLocalDateKeys(now, 7, shanghai)
	if len(keys) != 7 || keys[0] != "2026-11-17" || keys[6] != "2026-11-23" {
		t.Fatalf("unexpected 7-day keys: %#v", keys)
	}
}
