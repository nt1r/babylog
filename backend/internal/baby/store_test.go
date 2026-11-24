package baby_test

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/baby"
	"github.com/nt1r/babylog/backend/internal/database"
	"github.com/nt1r/babylog/backend/internal/timeutil"
)

func strPtr(v string) *string { return &v }

func TestStoreDefaultClinicTriStateAndUpdate(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "data"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	shanghai, _ := timeutil.LoadLocation("Asia/Shanghai")
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, shanghai)
	store := baby.NewStore(db.Gorm()).WithClock(func() time.Time { return now })
	ctx := context.Background()

	// 1. 新建档案未传 default_clinic_name 时默认落库空串。
	created, err := store.Create(ctx, baby.UpsertInput{
		Nickname:  "小汤圆",
		BirthDate: "2026-07-15",
		Gender:    "female",
	}, shanghai)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if created.DefaultClinicName != "" {
		t.Fatalf("expected empty default_clinic_name on create, got %q", created.DefaultClinicName)
	}

	// 2. 更新档案传入含首尾空白的常去门诊，验证裁剪并落库。
	updated, err := store.Update(ctx, baby.UpsertInput{
		Nickname:          "小汤圆",
		BirthDate:         "2026-07-15",
		Gender:            "female",
		DefaultClinicName: strPtr("  阳光街道社区卫生服务中心  "),
	}, shanghai)
	if err != nil {
		t.Fatalf("Update with clinic: %v", err)
	}
	if updated.DefaultClinicName != "阳光街道社区卫生服务中心" {
		t.Fatalf("expected trimmed clinic, got %q", updated.DefaultClinicName)
	}

	// 3. 再次更新档案省略 DefaultClinicName（nil），验证保留既有常去门诊不被清空。
	preserved, err := store.Update(ctx, baby.UpsertInput{
		Nickname:  "大汤圆",
		BirthDate: "2026-07-15",
		Gender:    "female",
	}, shanghai)
	if err != nil {
		t.Fatalf("Update omitting clinic: %v", err)
	}
	if preserved.DefaultClinicName != "阳光街道社区卫生服务中心" {
		t.Fatalf("expected omitted default_clinic_name preserved, got %q", preserved.DefaultClinicName)
	}

	// 从 SQLite 回读确认持久化终态。
	persisted, err := store.GetFirst(ctx)
	if err != nil || persisted == nil || persisted.DefaultClinicName != "阳光街道社区卫生服务中心" {
		t.Fatalf("read back preserved clinic: err=%v profile=%+v", err, persisted)
	}

	// 4. 传入空串显式清空默认门诊。
	cleared, err := store.Update(ctx, baby.UpsertInput{
		Nickname:          "大汤圆",
		BirthDate:         "2026-07-15",
		Gender:            "female",
		DefaultClinicName: strPtr(""),
	}, shanghai)
	if err != nil {
		t.Fatalf("Update clearing clinic: %v", err)
	}
	if cleared.DefaultClinicName != "" {
		t.Fatalf("expected empty clinic after clear, got %q", cleared.DefaultClinicName)
	}

	// 5. UpdateDefaultClinic 单独设置与超长（>80 字）校验拦截。
	setName, err := store.UpdateDefaultClinic(ctx, created.ID, "  高新社区卫生服务中心  ")
	if err != nil || setName != "高新社区卫生服务中心" {
		t.Fatalf("UpdateDefaultClinic valid: name=%q err=%v", setName, err)
	}
	tooLong := strings.Repeat("医", baby.MaxClinicNameLength+1)
	if _, err := store.UpdateDefaultClinic(ctx, created.ID, tooLong); err == nil {
		t.Fatalf("expected ValidationError for oversized clinic name")
	} else {
		var valErr *baby.ValidationError
		if !errors.As(err, &valErr) {
			t.Fatalf("expected *baby.ValidationError, got %T: %v", err, err)
		}
	}
	persisted, err = store.GetFirst(ctx)
	if err != nil || persisted == nil || persisted.DefaultClinicName != "高新社区卫生服务中心" {
		t.Fatalf("expected stored clinic untouched after validation error, got err=%v profile=%+v", err, persisted)
	}
}
