package dashboard

import (
	"context"
	"encoding/json"
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

// setupDashboardFixture 构建带固定时钟与独立临时 SQLite 的看板测试夹具，保证跨夜与多日趋势断言完全确定。
func setupDashboardFixture(t *testing.T, now time.Time) (*records.Store, *Service, int64) {
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

	recordStore := records.NewStore(db.Gorm()).WithClock(clock)
	svc := NewService(recordStore).WithClock(clock)
	return recordStore, svc, profile.ID
}

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

func TestGetSummaryEmptyAndPopulatedJSONContract(t *testing.T) {
	ctx := context.Background()
	shanghai, err := timeutil.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatalf("load shanghai: %v", err)
	}
	now := time.Date(2026, 11, 23, 14, 0, 0, 0, shanghai)
	recordStore, svc, babyID := setupDashboardFixture(t, now)

	// 1. 空库场景（loc=nil 时应回退到默认时区）
	emptyResp, err := svc.GetSummary(ctx, babyID, nil, nil)
	if err != nil {
		t.Fatalf("GetSummary empty: %v", err)
	}
	if emptyResp.Date != "2026-11-23" || emptyResp.Timezone != timeutil.DefaultTimezone {
		t.Fatalf("unexpected empty date/tz: %+v", emptyResp)
	}
	if emptyResp.Feeding.TotalCount != 0 || emptyResp.Feeding.LastFeedingAt != nil ||
		emptyResp.Sleep.TotalMin != 0 ||
		emptyResp.Health.LatestTempC != nil || emptyResp.Health.LatestTempAt != nil ||
		emptyResp.Care.TotalCount != 0 || emptyResp.Care.LastDiaperAt != nil {
		t.Fatalf("expected all zero/nil on empty db: %+v", emptyResp)
	}

	// 2. 写入跨日与当日混合记录
	// 昨日体温（应作为最近体温返回）
	if _, err := recordStore.CreateHealth(ctx, babyID, records.HealthInput{
		Subtype:      "temperature",
		TemperatureC: floatPtr(36.9),
		RecordedAt:   "2026-11-22T20:00:00+08:00",
	}); err != nil {
		t.Fatalf("create temp: %v", err)
	}
	// 今日喂养：配方奶 120ml + 瓶装母乳 80ml + 亲喂 15min + 辅食
	if _, err := recordStore.CreateFeeding(ctx, babyID, records.FeedingInput{
		Subtype:    "formula",
		AmountML:   intPtr(120),
		RecordedAt: "2026-11-23T00:30:00+08:00",
	}); err != nil {
		t.Fatalf("create formula: %v", err)
	}
	if _, err := recordStore.CreateFeeding(ctx, babyID, records.FeedingInput{
		Subtype:     "breast",
		FeedingMode: strPtr("bottle"),
		AmountML:    intPtr(80),
		RecordedAt:  "2026-11-23T07:00:00+08:00",
	}); err != nil {
		t.Fatalf("create bottle breast: %v", err)
	}
	if _, err := recordStore.CreateFeeding(ctx, babyID, records.FeedingInput{
		Subtype:     "breast",
		FeedingMode: strPtr("direct"),
		BreastSide:  strPtr("left"),
		DurationMin: intPtr(15),
		RecordedAt:  "2026-11-23T10:30:00+08:00",
	}); err != nil {
		t.Fatalf("create direct breast: %v", err)
	}
	if _, err := recordStore.CreateFeeding(ctx, babyID, records.FeedingInput{
		Subtype:    "solid",
		SolidFood:  strPtr("南瓜泥"),
		RecordedAt: "2026-11-23T12:00:00+08:00",
	}); err != nil {
		t.Fatalf("create solid: %v", err)
	}
	// 睡眠：跨夜 22:00 -> 06:00（今日 360min）+ 白天小睡 12:30 -> 13:15（45min）
	if _, err := recordStore.CreateSleep(ctx, babyID, records.SleepInput{
		Subtype:   "night",
		StartedAt: "2026-11-22T22:00:00+08:00",
		EndedAt:   "2026-11-23T06:00:00+08:00",
	}); err != nil {
		t.Fatalf("create night sleep: %v", err)
	}
	if _, err := recordStore.CreateSleep(ctx, babyID, records.SleepInput{
		Subtype:   "nap",
		StartedAt: "2026-11-23T12:30:00+08:00",
		EndedAt:   "2026-11-23T13:15:00+08:00",
	}); err != nil {
		t.Fatalf("create nap: %v", err)
	}
	// 护理：尿布（both）+ 洗澡
	if _, err := recordStore.CreateCare(ctx, babyID, records.CareInput{
		Subtype:    "diaper",
		DiaperKind: strPtr("both"),
		RecordedAt: "2026-11-23T09:15:00+08:00",
	}); err != nil {
		t.Fatalf("create diaper: %v", err)
	}
	if _, err := recordStore.CreateCare(ctx, babyID, records.CareInput{
		Subtype:    "bath",
		RecordedAt: "2026-11-23T11:00:00+08:00",
	}); err != nil {
		t.Fatalf("create bath: %v", err)
	}

	got, err := svc.GetSummary(ctx, babyID, shanghai, nil)
	if err != nil {
		t.Fatalf("GetSummary: %v", err)
	}
	if got.Feeding.TotalML != 200 || got.Feeding.DirectBreastCount != 1 || got.Feeding.DirectBreastMin != 15 ||
		got.Feeding.SolidCount != 1 || got.Feeding.TotalCount != 4 {
		t.Fatalf("unexpected feeding summary: %+v", got.Feeding)
	}
	if got.Feeding.LastFeedingAt == nil || *got.Feeding.LastFeedingAt != "2026-11-23T04:00:00Z" {
		t.Fatalf("unexpected last_feeding_at: %v", got.Feeding.LastFeedingAt)
	}
	if got.Sleep.TotalMin != 405 || got.Sleep.NightMin != 360 || got.Sleep.NapCount != 1 {
		t.Fatalf("unexpected sleep summary: %+v", got.Sleep)
	}
	if got.Health.LatestTempC == nil || *got.Health.LatestTempC != 36.9 {
		t.Fatalf("unexpected health summary: %+v", got.Health)
	}
	if got.Care.TotalCount != 2 || got.Care.PeeCount != 1 || got.Care.PoopCount != 1 || got.Care.BathCount != 1 {
		t.Fatalf("unexpected care summary: %+v", got.Care)
	}

	// 验证内嵌 struct 扁平化与精简后的 JSON 契约
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal summary: %v", err)
	}
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		t.Fatalf("unmarshal summary: %v", err)
	}
	feedingObj, ok := obj["feeding"].(map[string]any)
	if !ok || feedingObj["total_ml"] == nil {
		t.Fatalf("expected flat feeding.total_ml in JSON: %s", string(raw))
	}
	careObj, ok := obj["care"].(map[string]any)
	if !ok || careObj["pee_count"] == nil {
		t.Fatalf("expected flat care.pee_count in JSON: %s", string(raw))
	}
	sleepObj, ok := obj["sleep"].(map[string]any)
	if !ok || sleepObj["total_min"] == nil {
		t.Fatalf("expected sleep object in JSON: %s", string(raw))
	}
	if _, hasTotalCount := sleepObj["total_count"]; hasTotalCount {
		t.Fatalf("sleep summary JSON must not expose total_count: %s", string(raw))
	}
}

func TestGetTrendsWindowBoundsCrossMidnightAndSlots(t *testing.T) {
	ctx := context.Background()
	shanghai, err := timeutil.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatalf("load shanghai: %v", err)
	}
	// 2026-11-23 为周一
	now := time.Date(2026, 11, 23, 14, 0, 0, 0, shanghai)
	recordStore, svc, babyID := setupDashboardFixture(t, now)

	// 1. 跨 7 天窗口起点的睡眠（windowStart = 2026-11-17 00:00+08:00）：
	//    2026-11-16 22:00 -> 2026-11-17 06:00：2026-11-17 应计 6.0 小时，但入睡时间早于窗口起点不计入时段分布。
	if _, err := recordStore.CreateSleep(ctx, babyID, records.SleepInput{
		Subtype:   "night",
		StartedAt: "2026-11-16T22:00:00+08:00",
		EndedAt:   "2026-11-17T06:00:00+08:00",
	}); err != nil {
		t.Fatalf("create window-edge sleep: %v", err)
	}
	// 2. 窗口内亲喂与瓶喂（落在清晨 06:30 与夜间 22:00）
	if _, err := recordStore.CreateFeeding(ctx, babyID, records.FeedingInput{
		Subtype:     "breast",
		FeedingMode: strPtr("direct"),
		BreastSide:  strPtr("right"),
		DurationMin: intPtr(20),
		RecordedAt:  "2026-11-23T06:30:00+08:00",
	}); err != nil {
		t.Fatalf("create direct breast: %v", err)
	}
	if _, err := recordStore.CreateFeeding(ctx, babyID, records.FeedingInput{
		Subtype:    "formula",
		AmountML:   intPtr(150),
		RecordedAt: "2026-11-22T22:00:00+08:00",
	}); err != nil {
		t.Fatalf("create formula: %v", err)
	}
	// 3. 护理与健康记录计入上午/下午时段
	if _, err := recordStore.CreateCare(ctx, babyID, records.CareInput{
		Subtype:    "diaper",
		DiaperKind: strPtr("pee"),
		RecordedAt: "2026-11-23T09:30:00+08:00",
	}); err != nil {
		t.Fatalf("create care: %v", err)
	}
	if _, err := recordStore.CreateHealth(ctx, babyID, records.HealthInput{
		Subtype:      "temperature",
		TemperatureC: floatPtr(36.6),
		RecordedAt:   "2026-11-23T13:00:00+08:00",
	}); err != nil {
		t.Fatalf("create health: %v", err)
	}

	// days <= 0 应回退为 7 天并使用周几标签
	t7, err := svc.GetTrends(ctx, babyID, 0, shanghai)
	if err != nil {
		t.Fatalf("GetTrends(0): %v", err)
	}
	if t7.Days != 7 || len(t7.Daily) != 7 {
		t.Fatalf("expected 7 days, got days=%d len=%d", t7.Days, len(t7.Daily))
	}
	if t7.Daily[0].Date != "2026-11-17" || t7.Daily[0].SleepHours != 6.0 || t7.Daily[0].Label != "周二" {
		t.Fatalf("unexpected day[0]: %+v", t7.Daily[0])
	}
	if t7.Daily[5].Date != "2026-11-22" || t7.Daily[5].FeedingML != 150 || t7.Daily[5].DirectBreastMin != 0 {
		t.Fatalf("unexpected day[5]: %+v", t7.Daily[5])
	}
	if t7.Daily[6].Date != "2026-11-23" || t7.Daily[6].Label != "周一" ||
		t7.Daily[6].FeedingML != 0 || t7.Daily[6].DirectBreastMin != 20 || t7.Daily[6].DirectBreastCount != 1 {
		t.Fatalf("unexpected day[6]: %+v", t7.Daily[6])
	}

	slotMap := make(map[string]int, len(t7.Slots))
	for _, s := range t7.Slots {
		slotMap[s.Slot] = s.Count
	}
	// 清晨=1(亲喂), 上午=1(尿布), 下午=1(体温), 傍晚=0, 夜间=1(配方奶，窗口前入睡的跨夜睡眠不计入)
	if slotMap["清晨"] != 1 || slotMap["上午"] != 1 || slotMap["下午"] != 1 || slotMap["傍晚"] != 0 || slotMap["夜间"] != 1 {
		t.Fatalf("unexpected slot counts: %+v", slotMap)
	}

	// days > 7 应使用 "1/2" 日期标签，days > 90 应收敛到 90
	t14, err := svc.GetTrends(ctx, babyID, 14, shanghai)
	if err != nil {
		t.Fatalf("GetTrends(14): %v", err)
	}
	if t14.Days != 14 || len(t14.Daily) != 14 || t14.Daily[13].Label != "11/23" {
		t.Fatalf("unexpected 14-day trend: days=%d last=%+v", t14.Days, t14.Daily[len(t14.Daily)-1])
	}
	tClamped, err := svc.GetTrends(ctx, babyID, 120, shanghai)
	if err != nil {
		t.Fatalf("GetTrends(120): %v", err)
	}
	if tClamped.Days != 90 || len(tClamped.Daily) != 90 {
		t.Fatalf("expected days clamped to 90, got days=%d len=%d", tClamped.Days, len(tClamped.Daily))
	}
}

func TestGetSummaryTodayMedicineAndGrowthHighlights(t *testing.T) {
	ctx := context.Background()
	shanghai, err := timeutil.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatalf("load shanghai: %v", err)
	}
	now := time.Date(2026, 11, 23, 16, 0, 0, 0, shanghai)
	recordStore, svc, babyID := setupDashboardFixture(t, now)

	baseline := &BirthBaseline{
		BirthDate: "2026-08-01",
		WeightKg:  floatPtr(3.3),
		HeightCm:  floatPtr(50.0),
	}

	// 1. 无生长记录、无今日用药（仅有昨日用药）：验证出生体格兜底与昨日用药不计入今日
	if _, err := recordStore.CreateHealth(ctx, babyID, records.HealthInput{
		Subtype:      records.HealthSubtypeMedicine,
		MedicineName: strPtr("昨日维D"),
		RecordedAt:   "2026-11-22T23:30:00+08:00",
	}); err != nil {
		t.Fatalf("create yesterday med: %v", err)
	}
	s1, err := svc.GetSummary(ctx, babyID, shanghai, baseline)
	if err != nil {
		t.Fatalf("GetSummary fallback: %v", err)
	}
	if s1.Health.TodayMedicineCount != 0 || s1.Health.LatestMedicineName != nil || s1.Health.LatestMedicineAt != nil {
		t.Fatalf("expected zero today medicine, got %+v", s1.Health)
	}
	if s1.Growth.LatestWeightKg == nil || *s1.Growth.LatestWeightKg != 3.3 || !s1.Growth.WeightIsBirth ||
		s1.Growth.WeightRecordedAt == nil || *s1.Growth.WeightRecordedAt != "2026-08-01" {
		t.Fatalf("expected birth weight fallback, got %+v", s1.Growth)
	}
	if s1.Growth.LatestHeightCm == nil || *s1.Growth.LatestHeightCm != 50.0 || !s1.Growth.HeightIsBirth ||
		s1.Growth.HeightRecordedAt == nil || *s1.Growth.HeightRecordedAt != "2026-08-01" {
		t.Fatalf("expected birth height fallback, got %+v", s1.Growth)
	}
	if s1.Growth.LatestHeadCm != nil || s1.Growth.TeethCount != 0 || s1.Growth.LatestToothNote != nil {
		t.Fatalf("expected empty head/teeth, got %+v", s1.Growth)
	}

	// 2. 写入今日两条用药、跨记录部分体格测量（旧身高 + 新体重，无头围）与两条长牙记录
	for _, in := range []records.HealthInput{
		{Subtype: records.HealthSubtypeMedicine, MedicineName: strPtr("维生素 D3"), RecordedAt: "2026-11-23T08:30:00+08:00"},
		{Subtype: records.HealthSubtypeMedicine, MedicineName: strPtr("布洛芬"), RecordedAt: "2026-11-23T14:00:00+08:00"},
		{Subtype: records.HealthSubtypeGrowth, HeightCm: floatPtr(62.5), RecordedAt: "2026-11-10T12:00:00+08:00"},
		{Subtype: records.HealthSubtypeGrowth, WeightKg: floatPtr(7.2), RecordedAt: "2026-11-20T12:00:00+08:00"},
		{Subtype: records.HealthSubtypeTeeth, ToothNote: strPtr("下中切牙（第 1 颗）"), RecordedAt: "2026-11-15T12:00:00+08:00"},
		{Subtype: records.HealthSubtypeTeeth, ToothNote: strPtr("下中切牙（第 2 颗）"), RecordedAt: "2026-11-22T12:00:00+08:00"},
	} {
		if _, err := recordStore.CreateHealth(ctx, babyID, in); err != nil {
			t.Fatalf("create health %s: %v", in.Subtype, err)
		}
	}

	s2, err := svc.GetSummary(ctx, babyID, shanghai, baseline)
	if err != nil {
		t.Fatalf("GetSummary partial growth: %v", err)
	}
	if s2.Health.TodayMedicineCount != 2 || s2.Health.LatestMedicineName == nil || *s2.Health.LatestMedicineName != "布洛芬" ||
		s2.Health.LatestMedicineAt == nil || *s2.Health.LatestMedicineAt != "2026-11-23T06:00:00Z" {
		t.Fatalf("unexpected today medicine summary: %+v", s2.Health)
	}
	if s2.Growth.LatestWeightKg == nil || *s2.Growth.LatestWeightKg != 7.2 || s2.Growth.WeightIsBirth ||
		s2.Growth.LatestHeightCm == nil || *s2.Growth.LatestHeightCm != 62.5 || s2.Growth.HeightIsBirth ||
		s2.Growth.LatestHeadCm != nil {
		t.Fatalf("unexpected independent partial growth summary: %+v", s2.Growth)
	}
	if s2.Growth.TeethCount != 2 || s2.Growth.LatestToothNote == nil || *s2.Growth.LatestToothNote != "下中切牙（第 2 颗）" {
		t.Fatalf("unexpected teeth summary: %+v", s2.Growth)
	}

	// 3. 补齐头围且不传出生基线，三项均返回手动最新值且非出生兜底
	if _, err := recordStore.CreateHealth(ctx, babyID, records.HealthInput{
		Subtype:    records.HealthSubtypeGrowth,
		HeadCm:     floatPtr(42.5),
		RecordedAt: "2026-11-23T12:00:00+08:00",
	}); err != nil {
		t.Fatalf("create head growth: %v", err)
	}
	s3, err := svc.GetSummary(ctx, babyID, shanghai, nil)
	if err != nil {
		t.Fatalf("GetSummary full growth: %v", err)
	}
	if s3.Growth.LatestWeightKg == nil || *s3.Growth.LatestWeightKg != 7.2 || s3.Growth.WeightIsBirth ||
		s3.Growth.LatestHeightCm == nil || *s3.Growth.LatestHeightCm != 62.5 || s3.Growth.HeightIsBirth ||
		s3.Growth.LatestHeadCm == nil || *s3.Growth.LatestHeadCm != 42.5 {
		t.Fatalf("unexpected full growth summary: %+v", s3.Growth)
	}
}
