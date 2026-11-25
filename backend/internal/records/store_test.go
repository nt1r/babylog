package records_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/baby"
	"github.com/nt1r/babylog/backend/internal/database"
	"github.com/nt1r/babylog/backend/internal/records"
	"github.com/nt1r/babylog/backend/internal/timeutil"
)

func strPtr(v string) *string     { return &v }
func intPtr(v int) *int           { return &v }
func floatPtr(v float64) *float64 { return &v }

func openTestStores(t *testing.T, now time.Time) (*records.Store, int64) {
	t.Helper()

	db, err := database.Open(filepath.Join(t.TempDir(), "data"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	clock := func() time.Time { return now }
	babyStore := baby.NewStore(db.Gorm()).WithClock(clock)
	profile, err := babyStore.Create(context.Background(), baby.UpsertInput{
		Nickname:  "小团子",
		BirthDate: "2026-08-01",
		Gender:    "female",
	}, nil)
	if err != nil {
		t.Fatalf("create baby: %v", err)
	}

	return records.NewStore(db.Gorm()).WithClock(clock), profile.ID
}

// TestReadWindowBoundariesAndOverlap 验证内部时间窗口快照查询的区间边界、跨夜重叠及多 babyID 隔离契约。
func TestReadWindowBoundariesAndOverlap(t *testing.T) {
	ctx := context.Background()
	shanghai, err := timeutil.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatalf("load shanghai: %v", err)
	}
	now := time.Date(2026, 11, 23, 18, 0, 0, 0, shanghai)
	store, babyID := openTestStores(t, now)

	dayStart, dayEnd := timeutil.LocalDayBounds(now, shanghai)

	// 窗口边界外：前一天 23:59:59 喂养（不应落入今日窗口）
	if _, err := store.CreateFeeding(ctx, babyID, records.FeedingInput{
		Subtype:    records.FeedingSubtypeFormula,
		AmountML:   intPtr(90),
		RecordedAt: "2026-11-22T23:59:59+08:00",
	}); err != nil {
		t.Fatalf("create prev feeding: %v", err)
	}
	// 窗口起点整点：00:00:00 喂养（左闭区间，应落入今日窗口）
	if _, err := store.CreateFeeding(ctx, babyID, records.FeedingInput{
		Subtype:    records.FeedingSubtypeFormula,
		AmountML:   intPtr(120),
		RecordedAt: "2026-11-23T00:00:00+08:00",
	}); err != nil {
		t.Fatalf("create today feeding: %v", err)
	}
	// 跨夜睡眠：前一天 22:00 -> 今日 06:00（与今日窗口存在交集，应包含）
	if _, err := store.CreateSleep(ctx, babyID, records.SleepInput{
		Subtype:   records.SleepSubtypeNight,
		StartedAt: "2026-11-22T22:00:00+08:00",
		EndedAt:   "2026-11-23T06:00:00+08:00",
	}); err != nil {
		t.Fatalf("create cross-midnight sleep: %v", err)
	}
	// ended_at == dayStart 不构成交集，不应包含
	if _, err := store.CreateSleep(ctx, babyID, records.SleepInput{
		Subtype:   records.SleepSubtypeNap,
		StartedAt: "2026-11-22T23:00:00+08:00",
		EndedAt:   "2026-11-23T00:00:00+08:00",
	}); err != nil {
		t.Fatalf("create boundary sleep: %v", err)
	}
	if _, err := store.CreateCare(ctx, babyID, records.CareInput{
		Subtype:    records.CareSubtypeDiaper,
		DiaperKind: strPtr("pee"),
		RecordedAt: "2026-11-23T08:00:00+08:00",
	}); err != nil {
		t.Fatalf("create care: %v", err)
	}
	if _, err := store.CreateHealth(ctx, babyID, records.HealthInput{
		Subtype:      records.HealthSubtypeTemperature,
		TemperatureC: floatPtr(36.7),
		RecordedAt:   "2026-11-23T09:00:00+08:00",
	}); err != nil {
		t.Fatalf("create health: %v", err)
	}

	snap, err := store.ReadWindow(ctx, babyID, dayStart, dayEnd)
	if err != nil {
		t.Fatalf("ReadWindow: %v", err)
	}
	if len(snap.Feedings) != 1 || snap.Feedings[0].AmountML == nil || *snap.Feedings[0].AmountML != 120 {
		t.Fatalf("expected 1 today feeding (120ml), got %#v", snap.Feedings)
	}
	if len(snap.Sleeps) != 1 || snap.Sleeps[0].Subtype != records.SleepSubtypeNight {
		t.Fatalf("expected 1 overlapping night sleep, got %#v", snap.Sleeps)
	}
	if len(snap.Cares) != 1 || len(snap.Healths) != 1 {
		t.Fatalf("expected 1 care & 1 health, got cares=%d healths=%d", len(snap.Cares), len(snap.Healths))
	}

	// 空/反向窗口与无关 babyID 均应返回空快照
	emptySnap, err := store.ReadWindow(ctx, babyID, dayEnd, dayStart)
	if err != nil {
		t.Fatalf("ReadWindow reversed: %v", err)
	}
	if len(emptySnap.Feedings) != 0 || len(emptySnap.Sleeps) != 0 || len(emptySnap.Cares) != 0 || len(emptySnap.Healths) != 0 {
		t.Fatalf("expected empty snapshot for reversed window, got %#v", emptySnap)
	}
	otherSnap, err := store.ReadWindow(ctx, babyID+999, dayStart, dayEnd)
	if err != nil {
		t.Fatalf("ReadWindow other baby: %v", err)
	}
	if len(otherSnap.Feedings) != 0 || len(otherSnap.Sleeps) != 0 || len(otherSnap.Cares) != 0 || len(otherSnap.Healths) != 0 {
		t.Fatalf("expected empty snapshot for other baby, got %#v", otherSnap)
	}
}

// TestListSleepSub30sCrossMidnightDateKey 验证零点前不足 30 秒入睡（入睡日舍入为 0 分钟）时仍保留入睡日小计键，确保昨日小睡统计不丢失。
func TestListSleepSub30sCrossMidnightDateKey(t *testing.T) {
	ctx := context.Background()
	shanghai, err := timeutil.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatalf("load shanghai: %v", err)
	}
	now := time.Date(2026, 11, 23, 14, 0, 0, 0, shanghai)
	store, babyID := openTestStores(t, now)

	if _, err := store.CreateSleep(ctx, babyID, records.SleepInput{
		Subtype:   records.SleepSubtypeNap,
		StartedAt: "2026-11-22T14:00:00+08:00",
		EndedAt:   "2026-11-22T14:45:00+08:00",
	}); err != nil {
		t.Fatalf("create yesterday nap: %v", err)
	}
	if _, err := store.CreateSleep(ctx, babyID, records.SleepInput{
		Subtype:   records.SleepSubtypeNight,
		StartedAt: "2026-11-22T23:59:40+08:00",
		EndedAt:   "2026-11-23T06:00:00+08:00",
	}); err != nil {
		t.Fatalf("create sub-30s cross-midnight sleep: %v", err)
	}

	res, err := store.ListSleep(ctx, babyID, records.ListFilter{Range: "today", Loc: shanghai})
	if err != nil {
		t.Fatalf("ListSleep today: %v", err)
	}
	if yest, ok := res.DailySummaries["2026-11-22"]; !ok || yest.TotalMin != 45 || yest.NapCount != 1 {
		t.Fatalf("expected 2026-11-22 key preserved for sub-30s pre-midnight sleep, got ok=%v sum=%+v", ok, yest)
	}
	if today, ok := res.DailySummaries["2026-11-23"]; !ok || today.TotalMin != 360 || today.NightMin != 360 {
		t.Fatalf("expected 2026-11-23 summary 360m, got ok=%v sum=%+v", ok, today)
	}
}

// TestCrossBabyIDMutationIsolation 验证单宝宝模式之外的底层 baby_id 越权写入隔离契约（HTTP 层无法构造第二个 babyID）。
func TestCrossBabyIDMutationIsolation(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 11, 23, 12, 0, 0, 0, time.UTC)
	store, babyID := openTestStores(t, now)

	feed, err := store.CreateFeeding(ctx, babyID, records.FeedingInput{
		Subtype:    records.FeedingSubtypeFormula,
		AmountML:   intPtr(120),
		RecordedAt: "2026-11-23T08:00:00Z",
	})
	if err != nil {
		t.Fatalf("CreateFeeding: %v", err)
	}
	care, err := store.CreateCare(ctx, babyID, records.CareInput{
		Subtype:    records.CareSubtypeBath,
		RecordedAt: "2026-11-23T09:00:00Z",
	})
	if err != nil {
		t.Fatalf("CreateCare: %v", err)
	}

	if _, err := store.UpdateFeeding(ctx, babyID+1, feed.ID, records.FeedingInput{
		Subtype:    records.FeedingSubtypeFormula,
		AmountML:   intPtr(90),
		RecordedAt: "2026-11-23T08:00:00Z",
	}); !errors.Is(err, records.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for wrong babyID UpdateFeeding, got %v", err)
	}
	if err := store.DeleteCare(ctx, babyID+1, care.ID); !errors.Is(err, records.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for wrong babyID DeleteCare, got %v", err)
	}
}
