package dashboard

import (
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/timeutil"
)

func TestDaySlotLabel(t *testing.T) {
	shanghai, err := timeutil.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatalf("load shanghai: %v", err)
	}

	cases := []struct {
		hour int
		min  int
		want string
	}{
		{4, 59, "夜间"},
		{5, 0, "清晨"},
		{8, 59, "清晨"},
		{9, 0, "上午"},
		{11, 59, "上午"},
		{12, 0, "下午"},
		{17, 59, "下午"},
		{18, 0, "傍晚"},
		{20, 59, "傍晚"},
		{21, 0, "夜间"},
		{0, 30, "夜间"},
	}

	for _, tc := range cases {
		ts := time.Date(2026, 11, 23, tc.hour, tc.min, 0, 0, shanghai)
		if got := daySlotLabel(ts, shanghai); got != tc.want {
			t.Errorf("%02d:%02d expected %q, got %q", tc.hour, tc.min, tc.want, got)
		}
	}
}
