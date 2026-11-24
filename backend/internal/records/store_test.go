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

// openTestStores 在独立临时目录中初始化 SQLite 与已建档单宝宝环境，并注入固定时钟，
// 确保所有时间窗口与分页小计测试不受宿主机当前系统日期影响。
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
		Subtype:    "formula",
		AmountML:   intPtr(90),
		RecordedAt: "2026-11-22T23:59:59+08:00",
	}); err != nil {
		t.Fatalf("create prev feeding: %v", err)
	}
	// 窗口起点整点：00:00:00 喂养（左闭区间，应落入今日窗口）
	if _, err := store.CreateFeeding(ctx, babyID, records.FeedingInput{
		Subtype:    "formula",
		AmountML:   intPtr(120),
		RecordedAt: "2026-11-23T00:00:00+08:00",
	}); err != nil {
		t.Fatalf("create today feeding: %v", err)
	}
	// 跨夜睡眠：前一天 22:00 -> 今日 06:00（与今日窗口存在交集，应包含）
	if _, err := store.CreateSleep(ctx, babyID, records.SleepInput{
		Subtype:   "night",
		StartedAt: "2026-11-22T22:00:00+08:00",
		EndedAt:   "2026-11-23T06:00:00+08:00",
	}); err != nil {
		t.Fatalf("create cross-midnight sleep: %v", err)
	}
	// 前一天纯日间睡眠（ended_at == dayStart 不构成交集，不应包含）
	if _, err := store.CreateSleep(ctx, babyID, records.SleepInput{
		Subtype:   "nap",
		StartedAt: "2026-11-22T23:00:00+08:00",
		EndedAt:   "2026-11-23T00:00:00+08:00",
	}); err != nil {
		t.Fatalf("create boundary sleep: %v", err)
	}
	// 今日护理与健康记录
	if _, err := store.CreateCare(ctx, babyID, records.CareInput{
		Subtype:    "diaper",
		DiaperKind: strPtr("pee"),
		RecordedAt: "2026-11-23T08:00:00+08:00",
	}); err != nil {
		t.Fatalf("create care: %v", err)
	}
	if _, err := store.CreateHealth(ctx, babyID, records.HealthInput{
		Subtype:      "temperature",
		TemperatureC: floatPtr(36.7),
		RecordedAt:   "2026-11-23T09:00:00+08:00",
	}); err != nil {
		t.Fatalf("create health: %v", err)
	}

	snap, err := store.ReadWindow(ctx, babyID, dayStart, dayEnd, records.WindowOptions{IncludeHealth: true})
	if err != nil {
		t.Fatalf("ReadWindow: %v", err)
	}
	if len(snap.Feedings) != 1 || snap.Feedings[0].AmountML == nil || *snap.Feedings[0].AmountML != 120 {
		t.Fatalf("expected 1 today feeding (120ml), got %#v", snap.Feedings)
	}
	if len(snap.Sleeps) != 1 || snap.Sleeps[0].Subtype != "night" {
		t.Fatalf("expected 1 overlapping night sleep, got %#v", snap.Sleeps)
	}
	if len(snap.Cares) != 1 || len(snap.Healths) != 1 {
		t.Fatalf("expected 1 care & 1 health, got cares=%d healths=%d", len(snap.Cares), len(snap.Healths))
	}

	// IncludeHealth=false 时跳过健康记录查询
	noHealthSnap, err := store.ReadWindow(ctx, babyID, dayStart, dayEnd, records.WindowOptions{IncludeHealth: false})
	if err != nil {
		t.Fatalf("ReadWindow without health: %v", err)
	}
	if len(noHealthSnap.Healths) != 0 || len(noHealthSnap.Feedings) != 1 {
		t.Fatalf("expected 0 healths & 1 feeding when IncludeHealth=false, got healths=%d feedings=%d", len(noHealthSnap.Healths), len(noHealthSnap.Feedings))
	}

	// 空/反向窗口与无关 babyID 均应返回空快照
	emptySnap, err := store.ReadWindow(ctx, babyID, dayEnd, dayStart, records.WindowOptions{IncludeHealth: true})
	if err != nil {
		t.Fatalf("ReadWindow reversed: %v", err)
	}
	if len(emptySnap.Feedings) != 0 || len(emptySnap.Sleeps) != 0 || len(emptySnap.Cares) != 0 || len(emptySnap.Healths) != 0 {
		t.Fatalf("expected empty snapshot for reversed window, got %#v", emptySnap)
	}
	otherSnap, err := store.ReadWindow(ctx, babyID+999, dayStart, dayEnd, records.WindowOptions{IncludeHealth: true})
	if err != nil {
		t.Fatalf("ReadWindow other baby: %v", err)
	}
	if len(otherSnap.Feedings) != 0 || len(otherSnap.Sleeps) != 0 || len(otherSnap.Cares) != 0 || len(otherSnap.Healths) != 0 {
		t.Fatalf("expected empty snapshot for other baby, got %#v", otherSnap)
	}
}

func TestReadLatestHighlights(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	store, babyID := openTestStores(t, now)

	// 空库时所有标记均为 nil
	emptyHL, err := store.ReadLatestHighlights(ctx, babyID)
	if err != nil {
		t.Fatalf("ReadLatestHighlights empty: %v", err)
	}
	if emptyHL.LastFeedingAt != nil || emptyHL.LastDiaperAt != nil || emptyHL.LatestTempC != nil || emptyHL.LatestTempAt != nil {
		t.Fatalf("expected all nil highlights on empty db, got %#v", emptyHL)
	}

	// 写入不同时间的喂养、尿布（加一条更晚的洗澡记录验证不干扰尿布）、体温（加一条更晚的生长记录验证不干扰体温）
	if _, err := store.CreateFeeding(ctx, babyID, records.FeedingInput{
		Subtype:    "formula",
		AmountML:   intPtr(100),
		RecordedAt: "2026-11-22T12:00:00Z",
	}); err != nil {
		t.Fatalf("create older feeding: %v", err)
	}
	if _, err := store.CreateFeeding(ctx, babyID, records.FeedingInput{
		Subtype:     "breast",
		FeedingMode: strPtr("direct"),
		BreastSide:  strPtr("left"),
		DurationMin: intPtr(15),
		RecordedAt:  "2026-11-23T08:00:00Z",
	}); err != nil {
		t.Fatalf("create newer feeding: %v", err)
	}
	if _, err := store.CreateCare(ctx, babyID, records.CareInput{
		Subtype:    "diaper",
		DiaperKind: strPtr("poop"),
		RecordedAt: "2026-11-23T07:30:00Z",
	}); err != nil {
		t.Fatalf("create diaper: %v", err)
	}
	if _, err := store.CreateCare(ctx, babyID, records.CareInput{
		Subtype:    "bath",
		RecordedAt: "2026-11-23T09:00:00Z",
	}); err != nil {
		t.Fatalf("create bath: %v", err)
	}
	if _, err := store.CreateHealth(ctx, babyID, records.HealthInput{
		Subtype:      "temperature",
		TemperatureC: floatPtr(36.8),
		RecordedAt:   "2026-11-23T06:00:00Z",
	}); err != nil {
		t.Fatalf("create temp 1: %v", err)
	}
	if _, err := store.CreateHealth(ctx, babyID, records.HealthInput{
		Subtype:      "temperature",
		TemperatureC: floatPtr(37.4),
		RecordedAt:   "2026-11-23T08:30:00Z",
	}); err != nil {
		t.Fatalf("create temp 2: %v", err)
	}
	if _, err := store.CreateHealth(ctx, babyID, records.HealthInput{
		Subtype:    "growth",
		WeightKg:   floatPtr(6.5),
		RecordedAt: "2026-11-23T09:30:00Z",
	}); err != nil {
		t.Fatalf("create growth: %v", err)
	}

	hl, err := store.ReadLatestHighlights(ctx, babyID)
	if err != nil {
		t.Fatalf("ReadLatestHighlights: %v", err)
	}
	if hl.LastFeedingAt == nil || *hl.LastFeedingAt != "2026-11-23T08:00:00Z" {
		t.Fatalf("expected LastFeedingAt=2026-11-23T08:00:00Z, got %v", hl.LastFeedingAt)
	}
	if hl.LastDiaperAt == nil || *hl.LastDiaperAt != "2026-11-23T07:30:00Z" {
		t.Fatalf("expected LastDiaperAt=2026-11-23T07:30:00Z, got %v", hl.LastDiaperAt)
	}
	if hl.LatestTempC == nil || *hl.LatestTempC != 37.4 || hl.LatestTempAt == nil || *hl.LatestTempAt != "2026-11-23T08:30:00Z" {
		t.Fatalf("expected LatestTemp=37.4@2026-11-23T08:30:00Z, got temp=%v at=%v", hl.LatestTempC, hl.LatestTempAt)
	}
}

func TestAccumulateSleepAndHealthSummary(t *testing.T) {
	var sleepSum records.SleepDailySummary
	records.AccumulateSleepSummary(&sleepSum, records.SleepRecord{Subtype: "night"}, 360)
	records.AccumulateSleepSummary(&sleepSum, records.SleepRecord{Subtype: "nap"}, 45)
	records.AccumulateSleepSummary(&sleepSum, records.SleepRecord{Subtype: "nap"}, 0) // 忽略非正分钟数
	records.AccumulateSleepSummary(&sleepSum, records.SleepRecord{Subtype: "night"}, -10)

	if sleepSum.TotalMin != 405 || sleepSum.NightMin != 360 || sleepSum.NapCount != 1 {
		t.Fatalf("unexpected sleep summary: %#v", sleepSum)
	}

	var healthSum records.HealthDailySummary
	// 按降序遍历时首条体温成为 LatestTempC
	records.AccumulateHealthSummary(&healthSum, records.HealthRecord{Subtype: "temperature", TemperatureC: floatPtr(38.2)})
	records.AccumulateHealthSummary(&healthSum, records.HealthRecord{Subtype: "temperature", TemperatureC: floatPtr(36.7)})
	records.AccumulateHealthSummary(&healthSum, records.HealthRecord{Subtype: "medicine"})
	records.AccumulateHealthSummary(&healthSum, records.HealthRecord{Subtype: "growth"})
	records.AccumulateHealthSummary(&healthSum, records.HealthRecord{Subtype: "teeth"})

	if healthSum.TotalCount != 5 || healthSum.MedicineCount != 1 || healthSum.GrowthCount != 1 || healthSum.TeethCount != 1 {
		t.Fatalf("unexpected health counts: %#v", healthSum)
	}
	if healthSum.LatestTempC == nil || *healthSum.LatestTempC != 38.2 {
		t.Fatalf("expected LatestTempC=38.2, got %v", healthSum.LatestTempC)
	}
}

func TestListSleepCrossMidnightDateKeysAndDailySummaries(t *testing.T) {
	ctx := context.Background()
	shanghai, err := timeutil.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatalf("load shanghai: %v", err)
	}
	now := time.Date(2026, 11, 23, 14, 0, 0, 0, shanghai)
	store, babyID := openTestStores(t, now)

	// 昨日 22:00 -> 今日 06:00（昨日 120min，今日 360min）
	if _, err := store.CreateSleep(ctx, babyID, records.SleepInput{
		Subtype:   records.SleepSubtypeNight,
		StartedAt: "2026-11-22T22:00:00+08:00",
		EndedAt:   "2026-11-23T06:00:00+08:00",
	}); err != nil {
		t.Fatalf("create cross-midnight sleep: %v", err)
	}
	// 昨日白天小睡 14:00 -> 14:45（45min，用于验证昨日完整小计）
	if _, err := store.CreateSleep(ctx, babyID, records.SleepInput{
		Subtype:   records.SleepSubtypeNap,
		StartedAt: "2026-11-22T14:00:00+08:00",
		EndedAt:   "2026-11-22T14:45:00+08:00",
	}); err != nil {
		t.Fatalf("create yesterday nap: %v", err)
	}

	// range=today 仅返回与今日有交集的跨夜夜觉，但 daily_summaries 必须同时包含昨日(入睡日)与今日(醒来日)
	res, err := store.ListSleep(ctx, babyID, records.ListFilter{
		Range: "today",
		Loc:   shanghai,
	})
	if err != nil {
		t.Fatalf("ListSleep today: %v", err)
	}
	if res.Total != 1 || len(res.Items) != 1 || res.HasMore {
		t.Fatalf("expected 1 overlapping sleep for today, got total=%d len=%d hasMore=%v", res.Total, len(res.Items), res.HasMore)
	}
	todaySum, hasToday := res.DailySummaries["2026-11-23"]
	if !hasToday || todaySum.TotalMin != 360 || todaySum.NightMin != 360 {
		t.Fatalf("expected 2026-11-23 sleep summary 360m night, got ok=%v sum=%+v", hasToday, todaySum)
	}
	yestSum, hasYest := res.DailySummaries["2026-11-22"]
	if !hasYest || yestSum.TotalMin != 165 || yestSum.NightMin != 120 || yestSum.NapCount != 1 {
		t.Fatalf("expected 2026-11-22 full sleep summary 165m (120+45), got ok=%v sum=%+v", hasYest, yestSum)
	}

	// 零点前不足 30 秒入睡的跨夜睡眠（入睡日舍入为 0 分钟）仍须保留入睡日小计键，确保昨日小睡统计不丢失
	store2, babyID2 := openTestStores(t, now)
	if _, err := store2.CreateSleep(ctx, babyID2, records.SleepInput{
		Subtype:   records.SleepSubtypeNap,
		StartedAt: "2026-11-22T14:00:00+08:00",
		EndedAt:   "2026-11-22T14:45:00+08:00",
	}); err != nil {
		t.Fatalf("create sub30s yesterday nap: %v", err)
	}
	if _, err := store2.CreateSleep(ctx, babyID2, records.SleepInput{
		Subtype:   records.SleepSubtypeNight,
		StartedAt: "2026-11-22T23:59:40+08:00",
		EndedAt:   "2026-11-23T06:00:00+08:00",
	}); err != nil {
		t.Fatalf("create sub30s cross-midnight sleep: %v", err)
	}
	subRes, err := store2.ListSleep(ctx, babyID2, records.ListFilter{Range: "today", Loc: shanghai})
	if err != nil {
		t.Fatalf("ListSleep sub30s today: %v", err)
	}
	if subYest, ok := subRes.DailySummaries["2026-11-22"]; !ok || subYest.TotalMin != 45 || subYest.NapCount != 1 {
		t.Fatalf("expected 2026-11-22 key preserved for sub-30s pre-midnight sleep, got ok=%v sum=%+v", ok, subYest)
	}
	if subToday, ok := subRes.DailySummaries["2026-11-23"]; !ok || subToday.TotalMin != 360 || subToday.NightMin != 360 {
		t.Fatalf("expected 2026-11-23 summary 360m, got ok=%v sum=%+v", ok, subToday)
	}

	// 非法子类型返回 ValidationError
	if _, err := store.ListSleep(ctx, babyID, records.ListFilter{Subtype: "invalid", Loc: shanghai}); err == nil {
		t.Fatalf("expected error for invalid sleep subtype filter")
	}
}

func TestListCareHealthAndSparseAllRangeSummaries(t *testing.T) {
	ctx := context.Background()
	shanghai, err := timeutil.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatalf("load shanghai: %v", err)
	}
	now := time.Date(2026, 11, 23, 18, 0, 0, 0, shanghai)
	store, babyID := openTestStores(t, now)

	// 写入相隔 6 个月的稀疏喂养记录 + 中间月份干扰记录，验证稀疏 range=all 分页小计精准且不受中间月份影响
	for _, tc := range []struct {
		ts string
		ml int
	}{
		{"2026-05-01T08:00:00+08:00", 80},
		{"2026-05-01T14:00:00+08:00", 70},  // 同日第二条（即使分页截断也应计入 05-01 小计）
		{"2026-08-15T10:00:00+08:00", 110}, // 中间月，不在第 1 页中
		{"2026-11-23T09:00:00+08:00", 120},
		{"2026-11-23T12:00:00+08:00", 130},
	} {
		if _, err := store.CreateFeeding(ctx, babyID, records.FeedingInput{
			Subtype:    records.FeedingSubtypeFormula,
			AmountML:   intPtr(tc.ml),
			RecordedAt: tc.ts,
		}); err != nil {
			t.Fatalf("create feeding %s: %v", tc.ts, err)
		}
	}

	// 只拉取 1 条（2026-11-23 12:00），验证 11-23 小计仍完整聚合当日两条（250ml），且不包含其他日期
	page1, err := store.ListFeeding(ctx, babyID, records.ListFilter{
		Range:  "all",
		Loc:    shanghai,
		Limit:  1,
		Offset: 0,
	})
	if err != nil {
		t.Fatalf("ListFeeding page1: %v", err)
	}
	if page1.Total != 5 || len(page1.Items) != 1 || !page1.HasMore {
		t.Fatalf("unexpected page1 meta: total=%d len=%d hasMore=%v", page1.Total, len(page1.Items), page1.HasMore)
	}
	if len(page1.DailySummaries) != 1 || page1.DailySummaries["2026-11-23"].TotalML != 250 {
		t.Fatalf("unexpected page1 daily summaries: %+v", page1.DailySummaries)
	}

	// 构造跨越 05-01 与 11-23 但不包含 08-15 的多区间场景（先删掉 08-15 的情况用 offset/limit 或直接验证 all）
	allFeed, err := store.ListFeeding(ctx, babyID, records.ListFilter{Range: "all", Loc: shanghai, Limit: 4, Offset: 0})
	if err != nil {
		t.Fatalf("ListFeeding limit 4: %v", err)
	}
	// 前 4 条落在 11-23, 08-15, 05-01（05-01 只有 14:00 在本页，但小计必须含 08:00 的 80ml -> 150ml）
	if allFeed.DailySummaries["2026-05-01"].TotalML != 150 || allFeed.DailySummaries["2026-08-15"].TotalML != 110 || allFeed.DailySummaries["2026-11-23"].TotalML != 250 {
		t.Fatalf("unexpected multi-range feeding summaries: %+v", allFeed.DailySummaries)
	}

	// Care 列表与子类型筛选
	if _, err := store.CreateCare(ctx, babyID, records.CareInput{
		Subtype:    records.CareSubtypeDiaper,
		DiaperKind: strPtr("both"),
		RecordedAt: "2026-11-23T08:00:00+08:00",
	}); err != nil {
		t.Fatalf("create care diaper: %v", err)
	}
	if _, err := store.CreateCare(ctx, babyID, records.CareInput{
		Subtype:    records.CareSubtypeBath,
		RecordedAt: "2026-11-23T11:00:00+08:00",
	}); err != nil {
		t.Fatalf("create care bath: %v", err)
	}
	careRes, err := store.ListCare(ctx, babyID, records.ListFilter{Range: "today", Loc: shanghai})
	if err != nil {
		t.Fatalf("ListCare: %v", err)
	}
	if careRes.Total != 2 || careRes.DailySummaries["2026-11-23"].PeeCount != 1 || careRes.DailySummaries["2026-11-23"].PoopCount != 1 || careRes.DailySummaries["2026-11-23"].BathCount != 1 {
		t.Fatalf("unexpected ListCare result: total=%d sum=%+v", careRes.Total, careRes.DailySummaries)
	}

	// Health 列表：同日两条体温按时间降序应取最新一条 38.4 作为 LatestTempC
	if _, err := store.CreateHealth(ctx, babyID, records.HealthInput{
		Subtype:      records.HealthSubtypeTemperature,
		TemperatureC: floatPtr(36.8),
		RecordedAt:   "2026-11-23T08:00:00+08:00",
	}); err != nil {
		t.Fatalf("create temp 1: %v", err)
	}
	if _, err := store.CreateHealth(ctx, babyID, records.HealthInput{
		Subtype:      records.HealthSubtypeTemperature,
		TemperatureC: floatPtr(38.4),
		RecordedAt:   "2026-11-23T15:00:00+08:00",
	}); err != nil {
		t.Fatalf("create temp 2: %v", err)
	}
	if _, err := store.CreateHealth(ctx, babyID, records.HealthInput{
		Subtype:      records.HealthSubtypeMedicine,
		MedicineName: strPtr("维D"),
		RecordedAt:   "2026-11-23T16:00:00+08:00",
	}); err != nil {
		t.Fatalf("create medicine: %v", err)
	}
	healthRes, err := store.ListHealth(ctx, babyID, records.ListFilter{Range: "today", Loc: shanghai})
	if err != nil {
		t.Fatalf("ListHealth: %v", err)
	}
	hSum := healthRes.DailySummaries["2026-11-23"]
	if healthRes.Total != 3 || hSum.TotalCount != 3 || hSum.MedicineCount != 1 || hSum.LatestTempC == nil || *hSum.LatestTempC != 38.4 {
		t.Fatalf("unexpected ListHealth summary: total=%d sum=%+v", healthRes.Total, hSum)
	}
}

func TestUpdateSubtypeClearingDeleteAndIsolation(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 11, 23, 12, 0, 0, 0, time.UTC)
	store, babyID := openTestStores(t, now)

	// 1. Feeding 从配方奶更新为亲喂，原 amount_ml 必须被显式清空为 NULL
	feed, err := store.CreateFeeding(ctx, babyID, records.FeedingInput{
		Subtype:    records.FeedingSubtypeFormula,
		AmountML:   intPtr(120),
		RecordedAt: "2026-11-23T08:00:00Z",
	})
	if err != nil {
		t.Fatalf("CreateFeeding: %v", err)
	}
	updatedFeed, err := store.UpdateFeeding(ctx, babyID, feed.ID, records.FeedingInput{
		Subtype:     records.FeedingSubtypeBreast,
		FeedingMode: strPtr("direct"),
		BreastSide:  strPtr("left"),
		DurationMin: intPtr(18),
		RecordedAt:  "2026-11-23T08:00:00Z",
	})
	if err != nil {
		t.Fatalf("UpdateFeeding: %v", err)
	}
	if updatedFeed.AmountML != nil || updatedFeed.DurationMin == nil || *updatedFeed.DurationMin != 18 {
		t.Fatalf("expected amount_ml cleared on subtype switch, got %+v", updatedFeed)
	}
	// 从 SQLite 回读验证持久化终态确实把 amount_ml 置为 NULL
	feedList, err := store.ListFeeding(ctx, babyID, records.ListFilter{Range: "all"})
	if err != nil || len(feedList.Items) != 1 || feedList.Items[0].AmountML != nil || feedList.Items[0].DurationMin == nil || *feedList.Items[0].DurationMin != 18 {
		t.Fatalf("persisted feeding after subtype switch unexpected: err=%v items=%+v", err, feedList)
	}

	// 2. Care 从便便更新为纯嘘嘘，原 stool_consistency / stool_color 必须被清空
	care, err := store.CreateCare(ctx, babyID, records.CareInput{
		Subtype:          records.CareSubtypeDiaper,
		DiaperKind:       strPtr("poop"),
		StoolConsistency: strPtr("soft"),
		StoolColor:       strPtr("yellow"),
		RecordedAt:       "2026-11-23T09:00:00Z",
	})
	if err != nil {
		t.Fatalf("CreateCare: %v", err)
	}
	updatedCare, err := store.UpdateCare(ctx, babyID, care.ID, records.CareInput{
		Subtype:    records.CareSubtypeDiaper,
		DiaperKind: strPtr("pee"),
		RecordedAt: "2026-11-23T09:00:00Z",
	})
	if err != nil {
		t.Fatalf("UpdateCare: %v", err)
	}
	if updatedCare.StoolConsistency != nil || updatedCare.StoolColor != nil {
		t.Fatalf("expected stool details cleared on pee update, got %+v", updatedCare)
	}
	careList, err := store.ListCare(ctx, babyID, records.ListFilter{Range: "all"})
	if err != nil || len(careList.Items) != 1 || careList.Items[0].StoolConsistency != nil || careList.Items[0].StoolColor != nil {
		t.Fatalf("persisted care after pee update unexpected: err=%v items=%+v", err, careList)
	}

	// 3. Health 从体温更新为生长记录，原 temperature_c 必须被清空
	health, err := store.CreateHealth(ctx, babyID, records.HealthInput{
		Subtype:      records.HealthSubtypeTemperature,
		TemperatureC: floatPtr(37.5),
		RecordedAt:   "2026-11-23T10:00:00Z",
	})
	if err != nil {
		t.Fatalf("CreateHealth: %v", err)
	}
	updatedHealth, err := store.UpdateHealth(ctx, babyID, health.ID, records.HealthInput{
		Subtype:    records.HealthSubtypeGrowth,
		WeightKg:   floatPtr(7.2),
		RecordedAt: "2026-11-23T10:00:00Z",
	})
	if err != nil {
		t.Fatalf("UpdateHealth: %v", err)
	}
	if updatedHealth.TemperatureC != nil || updatedHealth.WeightKg == nil || *updatedHealth.WeightKg != 7.2 {
		t.Fatalf("expected temperature_c cleared on growth update, got %+v", updatedHealth)
	}
	healthList, err := store.ListHealth(ctx, babyID, records.ListFilter{Range: "all"})
	if err != nil || len(healthList.Items) != 1 || healthList.Items[0].TemperatureC != nil || healthList.Items[0].WeightKg == nil || *healthList.Items[0].WeightKg != 7.2 {
		t.Fatalf("persisted health after growth update unexpected: err=%v items=%+v", err, healthList)
	}

	// 4. 跨 babyID 与不存在 ID 的更新/删除均返回 ErrNotFound
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
	if err := store.DeleteCare(ctx, babyID, care.ID); err != nil {
		t.Fatalf("DeleteCare: %v", err)
	}
	if err := store.DeleteCare(ctx, babyID, care.ID); !errors.Is(err, records.ErrNotFound) {
		t.Fatalf("expected ErrNotFound on second DeleteCare, got %v", err)
	}
	if err := store.DeleteHealth(ctx, babyID, health.ID); err != nil {
		t.Fatalf("DeleteHealth: %v", err)
	}
}

func TestGetSmartDefaultsHeuristics(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 11, 23, 18, 0, 0, 0, time.UTC)
	store, babyID := openTestStores(t, now)

	// 1. 空历史返回兜底预设
	starter, err := store.GetSmartDefaults(ctx, babyID)
	if err != nil {
		t.Fatalf("GetSmartDefaults empty: %v", err)
	}
	if starter.Feeding.LastMilkML != records.DefaultStarterMilk ||
		starter.Feeding.LastFeedingSubtype != records.FeedingSubtypeFormula ||
		starter.Feeding.SuggestedBreastSide != "left" ||
		starter.Health.LastTemperatureC != records.DefaultStarterTemp ||
		len(starter.Feeding.FrequentMilkML) != 3 {
		t.Fatalf("unexpected starter defaults: %+v", starter)
	}

	// 2. 写入频次与最近优先混合历史：150ml×2(较早), 180ml×1(最近) -> top 应为 [150, 180] + fallback 60 升序 -> [60, 150, 180]
	for _, f := range []records.FeedingInput{
		{Subtype: records.FeedingSubtypeFormula, AmountML: intPtr(150), RecordedAt: "2026-11-23T06:00:00Z"},
		{Subtype: records.FeedingSubtypeFormula, AmountML: intPtr(150), RecordedAt: "2026-11-23T08:00:00Z"},
		{Subtype: records.FeedingSubtypeFormula, AmountML: intPtr(180), RecordedAt: "2026-11-23T10:00:00Z"},
		// 最近一次亲喂为右侧 -> 建议换左侧
		{Subtype: records.FeedingSubtypeBreast, FeedingMode: strPtr("direct"), BreastSide: strPtr("right"), DurationMin: intPtr(12), RecordedAt: "2026-11-23T12:00:00Z"},
		// 6 种辅食（含重复）-> 去重后最多保留最近 5 种
		{Subtype: records.FeedingSubtypeSolid, SolidFood: strPtr("米糊"), RecordedAt: "2026-11-23T12:10:00Z"},
		{Subtype: records.FeedingSubtypeSolid, SolidFood: strPtr("南瓜泥"), RecordedAt: "2026-11-23T12:20:00Z"},
		{Subtype: records.FeedingSubtypeSolid, SolidFood: strPtr("苹果泥"), RecordedAt: "2026-11-23T12:30:00Z"},
		{Subtype: records.FeedingSubtypeSolid, SolidFood: strPtr("胡萝卜泥"), RecordedAt: "2026-11-23T12:40:00Z"},
		{Subtype: records.FeedingSubtypeSolid, SolidFood: strPtr("牛油果泥"), RecordedAt: "2026-11-23T12:50:00Z"},
		{Subtype: records.FeedingSubtypeSolid, SolidFood: strPtr("香蕉泥"), RecordedAt: "2026-11-23T13:00:00Z"},
		{Subtype: records.FeedingSubtypeSolid, SolidFood: strPtr("香蕉泥"), RecordedAt: "2026-11-23T13:10:00Z"},
	} {
		if _, err := store.CreateFeeding(ctx, babyID, f); err != nil {
			t.Fatalf("create feeding %+v: %v", f, err)
		}
	}

	got, err := store.GetSmartDefaults(ctx, babyID)
	if err != nil {
		t.Fatalf("GetSmartDefaults populated: %v", err)
	}
	if got.Feeding.LastMilkML != 180 || got.Feeding.LastFeedingSubtype != records.FeedingSubtypeSolid {
		t.Fatalf("unexpected last milk/subtype: %+v", got.Feeding)
	}
	if got.Feeding.LastBreastSide == nil || *got.Feeding.LastBreastSide != "right" || got.Feeding.SuggestedBreastSide != "left" {
		t.Fatalf("expected right->left breast suggestion, got %+v", got.Feeding)
	}
	wantFreq := []int{60, 150, 180}
	if len(got.Feeding.FrequentMilkML) != 3 ||
		got.Feeding.FrequentMilkML[0] != wantFreq[0] ||
		got.Feeding.FrequentMilkML[1] != wantFreq[1] ||
		got.Feeding.FrequentMilkML[2] != wantFreq[2] {
		t.Fatalf("expected frequent milk %v, got %v", wantFreq, got.Feeding.FrequentMilkML)
	}
	if len(got.Feeding.RecentSolidFoods) != 5 || got.Feeding.RecentSolidFoods[0] != "香蕉泥" {
		t.Fatalf("expected 5 deduped recent solid foods starting with 香蕉泥, got %v", got.Feeding.RecentSolidFoods)
	}
}
