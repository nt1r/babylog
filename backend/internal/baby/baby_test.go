package baby

import (
	"strings"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/timeutil"
)

func floatPtr(v float64) *float64 { return &v }
func strPtr(v string) *string     { return &v }

func TestValidateAndNormalize(t *testing.T) {
	shanghai, _ := timeutil.LoadLocation("Asia/Shanghai")
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, shanghai)

	validCases := []struct {
		name string
		in   UpsertInput
		want string
	}{
		{
			name: "基本必填项并裁剪昵称空白",
			in: UpsertInput{
				Nickname:  "  小汤圆  ",
				BirthDate: "2026-07-15",
				Gender:    "female",
			},
			want: "小汤圆",
		},
		{
			name: "包含出生体重与身高以及当天出生",
			in: UpsertInput{
				Nickname:      "团子",
				BirthDate:     "2026-11-23",
				Gender:        "male",
				BirthWeightKg: floatPtr(3.35),
				BirthHeightCm: floatPtr(50.5),
			},
			want: "团子",
		},
		{
			name: "未知性别允许通过",
			in: UpsertInput{
				Nickname:  "小宝",
				BirthDate: "2026-01-01",
				Gender:    "unknown",
			},
			want: "小宝",
		},
		{
			name: "合法常去接种门诊并裁剪空白",
			in: UpsertInput{
				Nickname:          "小宝",
				BirthDate:         "2026-01-01",
				Gender:            "female",
				DefaultClinicName: strPtr("  阳光街道社区卫生服务中心  "),
			},
			want: "小宝",
		},
		{
			name: "空常去接种门诊允许清空",
			in: UpsertInput{
				Nickname:          "小宝",
				BirthDate:         "2026-01-01",
				Gender:            "female",
				DefaultClinicName: strPtr("   "),
			},
			want: "小宝",
		},
	}

	for _, tc := range validCases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ValidateAndNormalize(tc.in, now, shanghai)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.Nickname != tc.want {
				t.Fatalf("expected nickname %q, got %q", tc.want, got.Nickname)
			}
		})
	}

	invalidCases := []struct {
		name string
		in   UpsertInput
	}{
		{
			name: "空昵称",
			in:   UpsertInput{Nickname: "   ", BirthDate: "2026-07-15", Gender: "male"},
		},
		{
			name: "昵称超过32字符",
			in:   UpsertInput{Nickname: strings.Repeat("宝", 33), BirthDate: "2026-07-15", Gender: "male"},
		},
		{
			name: "非法出生日期格式",
			in:   UpsertInput{Nickname: "小宝", BirthDate: "2026/07/15", Gender: "male"},
		},
		{
			name: "未来出生日期",
			in:   UpsertInput{Nickname: "小宝", BirthDate: "2026-11-24", Gender: "male"},
		},
		{
			name: "非法性别",
			in:   UpsertInput{Nickname: "小宝", BirthDate: "2026-07-15", Gender: "other"},
		},
		{
			name: "负数体重",
			in:   UpsertInput{Nickname: "小宝", BirthDate: "2026-07-15", Gender: "male", BirthWeightKg: floatPtr(-1)},
		},
		{
			name: "越界体重",
			in:   UpsertInput{Nickname: "小宝", BirthDate: "2026-07-15", Gender: "male", BirthWeightKg: floatPtr(20)},
		},
		{
			name: "越界身高",
			in:   UpsertInput{Nickname: "小宝", BirthDate: "2026-07-15", Gender: "male", BirthHeightCm: floatPtr(120)},
		},
		{
			name: "常去接种门诊超过80字符",
			in: UpsertInput{
				Nickname:          "小宝",
				BirthDate:         "2026-07-15",
				Gender:            "male",
				DefaultClinicName: strPtr(strings.Repeat("医", MaxClinicNameLength+1)),
			},
		},
	}

	for _, tc := range invalidCases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := ValidateAndNormalize(tc.in, now, shanghai); err == nil {
				t.Errorf("expected validation error for %s, got nil", tc.name)
			}
		})
	}
}
