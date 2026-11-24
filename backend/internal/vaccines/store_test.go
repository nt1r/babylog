package vaccines_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/baby"
	"github.com/nt1r/babylog/backend/internal/database"
	"github.com/nt1r/babylog/backend/internal/timeutil"
	"github.com/nt1r/babylog/backend/internal/vaccines"
)

// setupTestStores 使用隔离临时 SQLite 与固定时钟建档；出生日期刻意选在 2026-01-31 以覆盖 2 月底钳位边界。
func setupTestStores(t *testing.T, now time.Time) (*database.DB, *vaccines.Store, *baby.Profile) {
	t.Helper()
	db, err := database.Open(filepath.Join(t.TempDir(), "data"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	clock := func() time.Time { return now }
	babyStore := baby.NewStore(db.Gorm()).WithClock(clock)
	loc, _ := timeutil.LoadLocation("Asia/Shanghai")
	profile, err := babyStore.Create(context.Background(), baby.UpsertInput{
		Nickname:  "小糯米",
		BirthDate: "2026-01-31",
		Gender:    "female",
	}, loc)
	if err != nil {
		t.Fatalf("create baby: %v", err)
	}

	vacStore := vaccines.NewStore(db.Gorm()).WithClock(clock)
	return db, vacStore, profile
}

func TestStoreIdempotentSeedAndStateTransitions(t *testing.T) {
	// 2026-03-10 10:00+08:00
	now := time.Date(2026, 3, 10, 2, 0, 0, 0, time.UTC)
	db, store, profile := setupTestStores(t, now)
	loc, _ := timeutil.LoadLocation("Asia/Shanghai")
	ctx := context.Background()

	// 首次读取自动初始化 22 剂 NIP，二次读取幂等不重复。
	ov1, err := store.GetOverview(ctx, profile.ID, profile.BirthDate, "", loc)
	if err != nil {
		t.Fatalf("GetOverview #1: %v", err)
	}
	if len(ov1.Doses) != 22 || ov1.Summary.NIPTotal != 22 {
		t.Fatalf("expected 22 NIP doses, got %d / %d", len(ov1.Doses), ov1.Summary.NIPTotal)
	}
	if !ov1.Summary.BirthConfirmPending || len(ov1.Summary.BirthPendingDoseIDs) != 2 {
		t.Fatalf("expected 2 pending birth doses, got %+v", ov1.Summary)
	}

	// 验证月底出生宝宝（2026-01-31）的 1 月龄乙肝第 2 剂自动钳位为 2026-02-28。
	var hepb2 *vaccines.DoseView
	for i := range ov1.Doses {
		if ov1.Doses[i].TemplateCode != nil && *ov1.Doses[i].TemplateCode == "hepb" && ov1.Doses[i].DoseNumber == 2 {
			hepb2 = &ov1.Doses[i]
			break
		}
	}
	if hepb2 == nil {
		t.Fatalf("hepb dose 2 not found")
	}
	if hepb2.EffectiveDate != "2026-02-28" {
		t.Fatalf("expected clamped effective date 2026-02-28, got %s", hepb2.EffectiveDate)
	}
	if hepb2.AlertState != vaccines.AlertDueSoon {
		t.Fatalf("expected 2026-02-28 on 2026-03-10 (-10d) to be due_soon, got %s", hepb2.AlertState)
	}

	ov2, err := store.GetOverview(ctx, profile.ID, profile.BirthDate, "", loc)
	if err != nil {
		t.Fatalf("GetOverview #2: %v", err)
	}
	if len(ov2.Doses) != 22 {
		t.Fatalf("expected idempotent 22 doses, got %d", len(ov2.Doses))
	}

	// 状态流转：pending -> scheduled -> completed -> pending，每步从 SQLite 回读确认废弃列落库清空。
	schedDate := "2026-03-12"
	schedTime := "09:30"
	_, err = store.UpdateDose(ctx, profile.ID, hepb2.ID, profile.BirthDate, loc, vaccines.UpdateDoseInput{
		Status:        vaccines.StatusScheduled,
		ScheduledDate: &schedDate,
		ScheduledTime: &schedTime,
		ClinicName:    "阳光街道社区卫生服务中心",
		Note:          "提前 10 分钟取号",
	})
	if err != nil {
		t.Fatalf("UpdateDose scheduled: %v", err)
	}

	var persisted vaccines.DoseRecord
	if err := db.Gorm().Where("id = ?", hepb2.ID).First(&persisted).Error; err != nil {
		t.Fatalf("read back scheduled: %v", err)
	}
	if persisted.Status != vaccines.StatusScheduled || persisted.ScheduledDate == nil || *persisted.ScheduledDate != schedDate || persisted.VaccinatedAt != nil {
		t.Fatalf("unexpected scheduled persisted state: %+v", persisted)
	}

	vacDate := "2026-03-10"
	_, err = store.UpdateDose(ctx, profile.ID, hepb2.ID, profile.BirthDate, loc, vaccines.UpdateDoseInput{
		Status:       vaccines.StatusCompleted,
		VaccinatedAt: &vacDate,
		ClinicName:   "阳光街道社区卫生服务中心",
		Site:         "左大腿前外侧",
		Manufacturer: "康泰生物",
		BatchNo:      "B202601",
		Reaction:     "无异常",
	})
	if err != nil {
		t.Fatalf("UpdateDose completed: %v", err)
	}
	if err := db.Gorm().Where("id = ?", hepb2.ID).First(&persisted).Error; err != nil {
		t.Fatalf("read back completed: %v", err)
	}
	if persisted.Status != vaccines.StatusCompleted || persisted.ScheduledDate != nil || persisted.ScheduledTime != nil || persisted.VaccinatedAt == nil || *persisted.VaccinatedAt != vacDate {
		t.Fatalf("expected scheduled columns cleared on completion, got %+v", persisted)
	}

	// 回退至 pending，验证所有预约与接种字段均已落库清空。
	_, err = store.UpdateDose(ctx, profile.ID, hepb2.ID, profile.BirthDate, loc, vaccines.UpdateDoseInput{
		Status: vaccines.StatusPending,
	})
	if err != nil {
		t.Fatalf("UpdateDose revert pending: %v", err)
	}
	if err := db.Gorm().Where("id = ?", hepb2.ID).First(&persisted).Error; err != nil {
		t.Fatalf("read back reverted: %v", err)
	}
	if persisted.Status != vaccines.StatusPending || persisted.VaccinatedAt != nil || persisted.ScheduledDate != nil ||
		persisted.Site != "" || persisted.Manufacturer != "" || persisted.BatchNo != "" || persisted.Reaction != "" || persisted.ClinicName != "" {
		t.Fatalf("expected all booking/completion columns cleared on revert, got %+v", persisted)
	}
}

func TestStoreBatchAtomicityRollback(t *testing.T) {
	now := time.Date(2026, 3, 10, 2, 0, 0, 0, time.UTC)
	db, store, profile := setupTestStores(t, now)
	loc, _ := timeutil.LoadLocation("Asia/Shanghai")
	ctx := context.Background()

	ov, err := store.GetOverview(ctx, profile.ID, profile.BirthDate, "", loc)
	if err != nil {
		t.Fatalf("GetOverview: %v", err)
	}
	validID := ov.Summary.BirthPendingDoseIDs[0]
	vacDate := profile.BirthDate
	clinic := "市妇幼保健院"

	_, err = store.BatchUpdate(ctx, profile.ID, profile.BirthDate, loc, vaccines.BatchUpdateInput{
		Action:       vaccines.BatchActionComplete,
		DoseIDs:      []int64{validID, 999999},
		VaccinatedAt: &vacDate,
		ClinicName:   &clinic,
	})
	if !errors.Is(err, vaccines.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}

	var persisted vaccines.DoseRecord
	if err := db.Gorm().Where("id = ?", validID).First(&persisted).Error; err != nil {
		t.Fatalf("read back validID: %v", err)
	}
	if persisted.Status != vaccines.StatusPending || persisted.VaccinatedAt != nil {
		t.Fatalf("expected transaction rollback keeping dose pending, got %+v", persisted)
	}

	// 验证批量更新时传 nil 保留既有门诊与备注，传入空字符串则显式清空旧值。
	schedDate := "2026-03-15"
	note := "需携带接种证"
	if _, err := store.BatchUpdate(ctx, profile.ID, profile.BirthDate, loc, vaccines.BatchUpdateInput{
		Action:        vaccines.BatchActionSchedule,
		DoseIDs:       []int64{validID},
		ScheduledDate: &schedDate,
		ClinicName:    &clinic,
		Note:          &note,
	}); err != nil {
		t.Fatalf("batch schedule with clinic and note: %v", err)
	}
	if _, err := store.BatchUpdate(ctx, profile.ID, profile.BirthDate, loc, vaccines.BatchUpdateInput{
		Action:        vaccines.BatchActionSchedule,
		DoseIDs:       []int64{validID},
		ScheduledDate: &schedDate,
	}); err != nil {
		t.Fatalf("batch schedule omit clinic and note: %v", err)
	}
	if err := db.Gorm().Where("id = ?", validID).First(&persisted).Error; err != nil {
		t.Fatalf("read back preserved clinic/note: %v", err)
	}
	if persisted.ClinicName != clinic || persisted.Note != note {
		t.Fatalf("expected nil clinic/note to preserve existing values, got clinic=%q note=%q", persisted.ClinicName, persisted.Note)
	}
	empty := ""
	if _, err := store.BatchUpdate(ctx, profile.ID, profile.BirthDate, loc, vaccines.BatchUpdateInput{
		Action:        vaccines.BatchActionSchedule,
		DoseIDs:       []int64{validID},
		ScheduledDate: &schedDate,
		ClinicName:    &empty,
	}); err != nil {
		t.Fatalf("batch schedule clear clinic: %v", err)
	}
	if err := db.Gorm().Where("id = ?", validID).First(&persisted).Error; err != nil {
		t.Fatalf("read back cleared clinic: %v", err)
	}
	if persisted.ClinicName != "" || persisted.Note != note {
		t.Fatalf("expected empty clinic_name and preserved note, got clinic=%q note=%q", persisted.ClinicName, persisted.Note)
	}
}

func TestStoreDeleteDoseRenumbersSiblingsAndDeleteTemplate(t *testing.T) {
	now := time.Date(2026, 3, 10, 2, 0, 0, 0, time.UTC)
	db, store, profile := setupTestStores(t, now)
	loc, _ := timeutil.LoadLocation("Asia/Shanghai")
	ctx := context.Background()

	// 1. 添加默认 4 剂 pcv13，删除第 2 剂，验证 SQLite 剩余 3 剂自动重排为 1/3、2/3、3/3（原 2/6/12 月龄）。
	added, err := store.AddFromTemplate(ctx, profile.ID, profile.BirthDate, loc, vaccines.AddTemplateInput{
		TemplateCode: "pcv13",
	})
	if err != nil || len(added) != 4 {
		t.Fatalf("AddFromTemplate pcv13: len=%d err=%v", len(added), err)
	}
	if err := store.DeleteDose(ctx, profile.ID, added[1].ID); err != nil {
		t.Fatalf("DeleteDose #2: %v", err)
	}

	var remaining []vaccines.DoseRecord
	if err := db.Gorm().Where("baby_id = ? AND template_code = ?", profile.ID, "pcv13").Order("dose_number ASC").Find(&remaining).Error; err != nil {
		t.Fatalf("read back pcv13: %v", err)
	}
	if len(remaining) != 3 {
		t.Fatalf("expected 3 remaining pcv13 doses, got %d", len(remaining))
	}
	wantMonths := []int{2, 6, 12}
	for i, rec := range remaining {
		if rec.DoseNumber != i+1 || rec.TotalDoses != 3 || rec.AgeMonths != wantMonths[i] {
			t.Fatalf("row %d: got dose %d/%d (%dm), want %d/3 (%dm)", i, rec.DoseNumber, rec.TotalDoses, rec.AgeMonths, i+1, wantMonths[i])
		}
	}

	// 2. 整套移出 pcv13，验证库中全部清空；拒绝移出 NIP 模板。
	if err := store.DeleteTemplate(ctx, profile.ID, "pcv13"); err != nil {
		t.Fatalf("DeleteTemplate pcv13: %v", err)
	}
	var count int64
	if err := db.Gorm().Model(&vaccines.DoseRecord{}).Where("baby_id = ? AND template_code = ?", profile.ID, "pcv13").Count(&count).Error; err != nil {
		t.Fatalf("count pcv13: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected 0 pcv13 rows after DeleteTemplate, got %d", count)
	}
	if err := store.DeleteTemplate(ctx, profile.ID, "hepb"); !errors.Is(err, vaccines.ErrCannotDeleteNIP) {
		t.Fatalf("expected ErrCannotDeleteNIP for hepb template, got %v", err)
	}

	// 3. 多剂自定义疫苗删除中间第 2 剂同样自动重排为 1/2、2/2。
	customDoses, err := store.CreateCustom(ctx, profile.ID, profile.BirthDate, loc, vaccines.CreateCustomInput{
		VaccineName: "五联疫苗",
		Category:    vaccines.CategoryOptional,
		Doses: []vaccines.DosePlanInput{
			{AgeMonths: 2},
			{AgeMonths: 3},
			{AgeMonths: 4},
		},
	})
	if err != nil || len(customDoses) != 3 {
		t.Fatalf("CreateCustom 3 doses: len=%d err=%v", len(customDoses), err)
	}
	if err := store.DeleteDose(ctx, profile.ID, customDoses[1].ID); err != nil {
		t.Fatalf("DeleteDose custom #2: %v", err)
	}
	var customRem []vaccines.DoseRecord
	if err := db.Gorm().Where("baby_id = ? AND vaccine_name = ?", profile.ID, "五联疫苗").Order("dose_number ASC").Find(&customRem).Error; err != nil {
		t.Fatalf("read back custom: %v", err)
	}
	if len(customRem) != 2 || customRem[0].DoseNumber != 1 || customRem[0].TotalDoses != 2 || customRem[1].DoseNumber != 2 || customRem[1].TotalDoses != 2 || customRem[1].AgeMonths != 4 {
		t.Fatalf("unexpected custom renumbered rows: %+v", customRem)
	}

	// 4. 添加流感模板并保留默认月龄时，保留定制阶段文案（6月龄起 / 首季第2剂）。
	fluDoses, err := store.AddFromTemplate(ctx, profile.ID, profile.BirthDate, loc, vaccines.AddTemplateInput{
		TemplateCode: "flu",
		Doses: []vaccines.DosePlanInput{
			{AgeMonths: 6},
			{AgeMonths: 7},
		},
	})
	if err != nil || len(fluDoses) != 2 {
		t.Fatalf("AddFromTemplate flu: len=%d err=%v", len(fluDoses), err)
	}
	if fluDoses[0].AgeLabel != "6月龄起" || fluDoses[1].AgeLabel != "首季第2剂" {
		t.Fatalf("expected flu custom AgeLabel preserved, got %q / %q", fluDoses[0].AgeLabel, fluDoses[1].AgeLabel)
	}
	// 更新状态时若未改月龄，继续保留「6月龄起」定制文案。
	sameAge := 6
	schedDate := "2026-10-01"
	updatedFlu, err := store.UpdateDose(ctx, profile.ID, fluDoses[0].ID, profile.BirthDate, loc, vaccines.UpdateDoseInput{
		Status:        vaccines.StatusScheduled,
		AgeMonths:     &sameAge,
		ScheduledDate: &schedDate,
	})
	if err != nil {
		t.Fatalf("UpdateDose flu keep age_label: %v", err)
	}
	if updatedFlu.AgeLabel != "6月龄起" {
		t.Fatalf("expected flu AgeLabel preserved on same age_months update, got %q", updatedFlu.AgeLabel)
	}
}

func TestStoreDefaultClinicAutoRememberExplicitPinAndBatchRollback(t *testing.T) {
	now := time.Date(2026, 3, 10, 2, 0, 0, 0, time.UTC)
	db, store, profile := setupTestStores(t, now)
	loc, _ := timeutil.LoadLocation("Asia/Shanghai")
	ctx := context.Background()

	readClinic := func() string {
		t.Helper()
		var p baby.Profile
		if err := db.Gorm().Where("id = ?", profile.ID).First(&p).Error; err != nil {
			t.Fatalf("read back baby profile: %v", err)
		}
		return p.DefaultClinicName
	}

	ov, err := store.GetOverview(ctx, profile.ID, profile.BirthDate, readClinic(), loc)
	if err != nil {
		t.Fatalf("GetOverview: %v", err)
	}
	if ov.DefaultClinicName != "" {
		t.Fatalf("expected initial default_clinic_name empty, got %q", ov.DefaultClinicName)
	}

	var birthHepB1, hepb2, polio1, dtap1 *vaccines.DoseView
	for i := range ov.Doses {
		d := &ov.Doses[i]
		if d.TemplateCode == nil {
			continue
		}
		switch {
		case *d.TemplateCode == "hepb" && d.DoseNumber == 1:
			birthHepB1 = d
		case *d.TemplateCode == "hepb" && d.DoseNumber == 2:
			hepb2 = d
		case *d.TemplateCode == "polio" && d.DoseNumber == 1:
			polio1 = d
		case *d.TemplateCode == "dtap" && d.DoseNumber == 1:
			dtap1 = d
		}
	}
	if birthHepB1 == nil || hepb2 == nil || polio1 == nil || dtap1 == nil {
		t.Fatalf("missing expected baseline doses")
	}

	// 1. 产院出生剂次（乙肝第 1 剂）填产院名称，不应污染默认社区门诊。
	birthDate := profile.BirthDate
	if _, err := store.UpdateDose(ctx, profile.ID, birthHepB1.ID, profile.BirthDate, loc, vaccines.UpdateDoseInput{
		Status:       vaccines.StatusCompleted,
		VaccinatedAt: &birthDate,
		ClinicName:   "市妇幼保健院",
	}); err != nil {
		t.Fatalf("complete birth dose: %v", err)
	}
	if got := readClinic(); got != "" {
		t.Fatalf("expected birth hospital dose not to pollute default_clinic_name, got %q", got)
	}

	// 2. 首次常规剂次填写社区医院时自动记住为默认门诊。
	schedDate := "2026-03-12"
	if _, err := store.UpdateDose(ctx, profile.ID, hepb2.ID, profile.BirthDate, loc, vaccines.UpdateDoseInput{
		Status:        vaccines.StatusScheduled,
		ScheduledDate: &schedDate,
		ClinicName:    "阳光街道社区卫生服务中心",
	}); err != nil {
		t.Fatalf("schedule routine dose: %v", err)
	}
	if got := readClinic(); got != "阳光街道社区卫生服务中心" {
		t.Fatalf("expected auto-remembered default_clinic_name, got %q", got)
	}

	// 3. 偶发去其他医院（SetDefaultClinic=false）不得覆盖既有默认门诊。
	if _, err := store.UpdateDose(ctx, profile.ID, polio1.ID, profile.BirthDate, loc, vaccines.UpdateDoseInput{
		Status:        vaccines.StatusScheduled,
		ScheduledDate: &schedDate,
		ClinicName:    "儿童医院",
	}); err != nil {
		t.Fatalf("schedule one-off clinic: %v", err)
	}
	if got := readClinic(); got != "阳光街道社区卫生服务中心" {
		t.Fatalf("expected one-off clinic not to overwrite default, got %q", got)
	}

	// 4. 显式 SetDefaultClinic=true 覆写默认门诊并回读 baby_profiles 确认落库。
	if _, err := store.UpdateDose(ctx, profile.ID, dtap1.ID, profile.BirthDate, loc, vaccines.UpdateDoseInput{
		Status:           vaccines.StatusScheduled,
		ScheduledDate:    &schedDate,
		ClinicName:       "高新社区卫生服务中心",
		SetDefaultClinic: true,
	}); err != nil {
		t.Fatalf("schedule with explicit pin: %v", err)
	}
	if got := readClinic(); got != "高新社区卫生服务中心" {
		t.Fatalf("expected persisted default_clinic_name updated to 高新社区卫生服务中心, got %q", got)
	}

	// 5. 批量更新包含非法 ID 且携带 SetDefaultClinic=true 时，事务完整回滚（剂次与默认门诊均不改动）。
	badClinic := "错误回滚医院"
	_, err = store.BatchUpdate(ctx, profile.ID, profile.BirthDate, loc, vaccines.BatchUpdateInput{
		Action:           vaccines.BatchActionSchedule,
		DoseIDs:          []int64{polio1.ID, 999999},
		ScheduledDate:    &schedDate,
		ClinicName:       &badClinic,
		SetDefaultClinic: true,
	})
	if !errors.Is(err, vaccines.ErrNotFound) {
		t.Fatalf("expected ErrNotFound on invalid batch ID, got %v", err)
	}
	if got := readClinic(); got != "高新社区卫生服务中心" {
		t.Fatalf("expected default_clinic_name rolled back, got %q", got)
	}
	var polioPersisted vaccines.DoseRecord
	if err := db.Gorm().Where("id = ?", polio1.ID).First(&polioPersisted).Error; err != nil {
		t.Fatalf("read back polio1 after rollback: %v", err)
	}
	if polioPersisted.ClinicName != "儿童医院" {
		t.Fatalf("expected polio1 clinic_name untouched after rollback, got %q", polioPersisted.ClinicName)
	}

	// 6. 独立验证合法常规剂次批量预约在空默认门诊时自动记住常去门诊。
	db2, store2, profile2 := setupTestStores(t, now)
	ov2, err := store2.GetOverview(ctx, profile2.ID, profile2.BirthDate, "", loc)
	if err != nil {
		t.Fatalf("GetOverview #2: %v", err)
	}
	var routineIDs []int64
	for _, d := range ov2.Doses {
		if d.AgeMonths == 2 {
			routineIDs = append(routineIDs, d.ID)
		}
	}
	if len(routineIDs) < 2 {
		t.Fatalf("expected >=2 2-month routine doses, got %d", len(routineIDs))
	}
	batchClinic := "滨江社区卫生服务中心"
	if _, err := store2.BatchUpdate(ctx, profile2.ID, profile2.BirthDate, loc, vaccines.BatchUpdateInput{
		Action:        vaccines.BatchActionSchedule,
		DoseIDs:       routineIDs,
		ScheduledDate: &schedDate,
		ClinicName:    &batchClinic,
	}); err != nil {
		t.Fatalf("valid batch schedule auto-remember: %v", err)
	}
	var profile2After baby.Profile
	if err := db2.Gorm().Where("id = ?", profile2.ID).First(&profile2After).Error; err != nil {
		t.Fatalf("read back profile2: %v", err)
	}
	if profile2After.DefaultClinicName != batchClinic {
		t.Fatalf("expected batch schedule to auto-remember %q, got %q", batchClinic, profile2After.DefaultClinicName)
	}
}
