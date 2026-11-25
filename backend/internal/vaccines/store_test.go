package vaccines_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/baby"
	"github.com/nt1r/babylog/backend/internal/database"
	"github.com/nt1r/babylog/backend/internal/timeutil"
	"github.com/nt1r/babylog/backend/internal/vaccines"
)

func strPtr(v string) *string { return &v }

// TestStoreSamplesClockOncePerRequest 验证每次读写请求仅采样一次时钟，消除跨午夜请求内的日期/时间戳分裂风险。
func TestStoreSamplesClockOncePerRequest(t *testing.T) {
	ctx := context.Background()
	shanghai, err := timeutil.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatalf("load shanghai: %v", err)
	}
	db, err := database.Open(filepath.Join(t.TempDir(), "data"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	// 固定前一日 23:59:59，若同一请求采样第二次则会跳到次日 00:00:01。
	ticks := 0
	baseTime := time.Date(2026, 6, 15, 23, 59, 59, 0, shanghai)
	steppingClock := func() time.Time {
		ticks++
		if ticks == 1 {
			return baseTime
		}
		return baseTime.Add(2 * time.Second)
	}

	babyStore := baby.NewStore(db.Gorm()).WithClock(func() time.Time { return baseTime })
	profile, err := babyStore.Create(ctx, baby.UpsertInput{
		Nickname:  "团团",
		BirthDate: "2026-01-15",
		Gender:    "female",
	}, shanghai)
	if err != nil {
		t.Fatalf("create baby: %v", err)
	}

	store := vaccines.NewStore(db.Gorm()).WithClock(steppingClock)

	assertSingleSample := func(name string, fn func() error) {
		t.Helper()
		ticks = 0
		if err := fn(); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if ticks != 1 {
			t.Fatalf("%s sampled clock %d times, want 1", name, ticks)
		}
	}

	var firstDoseID int64
	assertSingleSample("GetOverview(含首次NIP初始化)", func() error {
		ov, err := store.GetOverview(ctx, profile, shanghai)
		if err != nil {
			return err
		}
		if ov.Today != "2026-06-15" {
			t.Fatalf("expected Today=2026-06-15, got %s", ov.Today)
		}
		firstDoseID = ov.Doses[0].ID
		return nil
	})

	assertSingleSample("AddFromTemplate", func() error {
		_, err := store.AddFromTemplate(ctx, profile, shanghai, vaccines.AddTemplateInput{TemplateCode: "ev71"})
		return err
	})

	assertSingleSample("CreateCustom", func() error {
		_, err := store.CreateCustom(ctx, profile, shanghai, vaccines.CreateCustomInput{
			VaccineName: "四联疫苗",
			Category:    vaccines.CategoryOptional,
			Doses:       []vaccines.DosePlanInput{{AgeMonths: 3}},
		})
		return err
	})

	assertSingleSample("UpdateDose", func() error {
		_, err := store.UpdateDose(ctx, profile, firstDoseID, shanghai, vaccines.UpdateDoseInput{
			Status:       vaccines.StatusCompleted,
			VaccinatedAt: strPtr("2026-01-15"),
			ClinicName:   "产院",
		})
		return err
	})

	assertSingleSample("BatchUpdate", func() error {
		_, err := store.BatchUpdate(ctx, profile, shanghai, vaccines.BatchUpdateInput{
			Action:        vaccines.BatchActionSchedule,
			DoseIDs:       []int64{firstDoseID},
			ScheduledDate: strPtr("2026-06-20"),
		})
		return err
	})
}
