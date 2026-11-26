package baby

import (
	"errors"
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
		name       string
		in         UpsertInput
		wantName   string
		wantClinic *string
	}{
		{
			name: "基本必填项并裁剪昵称空白",
			in: UpsertInput{
				Nickname:  "  小汤圆  ",
				BirthDate: "2026-07-15",
				Gender:    "female",
			},
			wantName: "小汤圆",
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
			wantName: "团子",
		},
		{
			name: "未知性别允许通过",
			in: UpsertInput{
				Nickname:  "小宝",
				BirthDate: "2026-01-01",
				Gender:    "unknown",
			},
			wantName: "小宝",
		},
		{
			name: "合法常去接种门诊并裁剪空白",
			in: UpsertInput{
				Nickname:          "小宝",
				BirthDate:         "2026-01-01",
				Gender:            "female",
				DefaultClinicName: strPtr("  阳光街道社区卫生服务中心  "),
			},
			wantName:   "小宝",
			wantClinic: strPtr("阳光街道社区卫生服务中心"),
		},
		{
			name: "全空白常去接种门诊归一为空串",
			in: UpsertInput{
				Nickname:          "小宝",
				BirthDate:         "2026-01-01",
				Gender:            "female",
				DefaultClinicName: strPtr("   "),
			},
			wantName:   "小宝",
			wantClinic: strPtr(""),
		},
	}

	for _, tc := range validCases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ValidateAndNormalize(tc.in, now, shanghai)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.Nickname != tc.wantName {
				t.Fatalf("expected nickname %q, got %q", tc.wantName, got.Nickname)
			}
			// 核验 DefaultClinicName 的 *string 三态契约：nil 保留原值、"" 显式清空、非空裁剪更新。
			if tc.wantClinic == nil {
				if got.DefaultClinicName != nil {
					t.Fatalf("expected nil DefaultClinicName, got %q", *got.DefaultClinicName)
				}
			} else if got.DefaultClinicName == nil || *got.DefaultClinicName != *tc.wantClinic {
				t.Fatalf("expected normalized DefaultClinicName %q, got %v", *tc.wantClinic, got.DefaultClinicName)
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
			_, err := ValidateAndNormalize(tc.in, now, shanghai)
			var valErr *ValidationError
			if !errors.As(err, &valErr) || strings.TrimSpace(valErr.Message) == "" {
				t.Errorf("expected non-empty *ValidationError for %s, got %T: %v", tc.name, err, err)
			}
		})
	}
}
