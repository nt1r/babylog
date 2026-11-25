package integration_test

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/baby"
)

/*
 * Spec: baby-profile / Baby profile retrieval and onboarding status / Retrieve empty profile before onboarding; Retrieve existing baby profile
 * Spec: baby-profile / Single baby profile creation / Create baby profile successfully; Reject duplicate baby profile creation; Reject invalid baby profile input
 * Spec: baby-profile / Baby profile update / Update existing baby profile; Preserve or update default_clinic_name on baby profile update; Reject update before onboarding
 * Spec: baby-profile / Authenticated access to baby profile endpoints / Reject unauthenticated baby profile request
 * 场景：覆盖单宝宝档案完整生命周期（建档与更新 → 时区边界与默认门诊三态 → 未认证/非法入参/重复建档拒绝）。
 * 前置：每项子测试独立创建已登录或匿名隔离环境。
 * 目标：
 * 1. 验证未建档读取返回 {baby: null}，建档返回 201，推进时钟更新返回 200 并刷新 updated_at 且落库一致。
 * 2. 验证不同 ?tz= 时区下本地“今天”出生日期边界，以及 default_clinic_name 的设置/省略保留/空串清空/超长拒绝。
 * 3. 验证未认证 401、未建档更新 404、非法建档载荷 400（且 SQLite 无脏数据）及重复建档 409。
 */
func TestBabyProfileLifecycle(t *testing.T) {
	t.Parallel()

	t.Run("正常主流程_建档回读与更新刷新updated_at", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t)
		client := app.Client()

		// 1. 初始未建档返回 {baby: null}。
		emptyResp := client.Get(t, "/api/baby")
		emptyResp.RequireStatus(t, http.StatusOK)
		emptyBody := DecodeJSON[struct {
			Baby *baby.Profile `json:"baby"`
		}](t, emptyResp)
		if emptyBody.Baby != nil {
			t.Fatalf("expected baby=nil before onboarding, got %+v", emptyBody.Baby)
		}

		// 2. 创建宝宝档案（含首尾空白昵称与本地当天出生日）返回 201，并校验落库字段完整。
		createResp := client.Post(t, "/api/baby?tz=Asia/Shanghai", baby.UpsertInput{
			Nickname:      "  小汤圆  ",
			BirthDate:     "2026-11-23",
			Gender:        "female",
			BirthWeightKg: ptr(3.35),
			BirthHeightCm: ptr(50.2),
		})
		createResp.RequireStatus(t, http.StatusCreated)
		created := DecodeJSON[struct {
			Baby baby.Profile `json:"baby"`
		}](t, createResp).Baby
		if created.ID <= 0 || created.Nickname != "小汤圆" || created.BirthDate != "2026-11-23" ||
			created.Gender != "female" || created.BirthWeightKg == nil || *created.BirthWeightKg != 3.35 ||
			created.BirthHeightCm == nil || *created.BirthHeightCm != 50.2 ||
			created.DefaultClinicName != "" || created.CreatedAt == "" || created.UpdatedAt == "" {
			t.Fatalf("unexpected created baby profile: %+v", created)
		}

		// 3. GET /api/baby 回读档案一致。
		getResp := client.Get(t, "/api/baby")
		getResp.RequireStatus(t, http.StatusOK)
		fetched := DecodeJSON[struct {
			Baby *baby.Profile `json:"baby"`
		}](t, getResp).Baby
		if fetched == nil || fetched.ID != created.ID || fetched.Nickname != "小汤圆" {
			t.Fatalf("unexpected fetched baby profile: %+v", fetched)
		}

		// 4. 推进时钟后更新档案，验证 updated_at 刷新且 SQLite 终态同步更新。
		app.Clock.Advance(10 * time.Minute)
		updResp := client.Put(t, "/api/baby?tz=Asia/Shanghai", baby.UpsertInput{
			Nickname:      "大汤圆",
			BirthDate:     "2026-07-15",
			Gender:        "female",
			BirthWeightKg: ptr(3.45),
			BirthHeightCm: ptr(50.5),
		})
		updResp.RequireStatus(t, http.StatusOK)
		updated := DecodeJSON[struct {
			Baby baby.Profile `json:"baby"`
		}](t, updResp).Baby
		if updated.Nickname != "大汤圆" || updated.BirthDate != "2026-07-15" ||
			updated.BirthWeightKg == nil || *updated.BirthWeightKg != 3.45 ||
			updated.UpdatedAt <= created.UpdatedAt {
			t.Fatalf("expected updated profile with refreshed updated_at (> %q), got %+v", created.UpdatedAt, updated)
		}

		persisted := FirstRow[baby.Profile](t, app, "id = ?", created.ID)
		if persisted.Nickname != "大汤圆" || persisted.UpdatedAt != updated.UpdatedAt {
			t.Fatalf("SQLite persisted profile mismatch: %+v", persisted)
		}
	})

	t.Run("边界_跨时区本地当天出生日校验", func(t *testing.T) {
		t.Parallel()

		// 2026-11-22 20:00Z：UTC 仍为 11-22，Asia/Shanghai 已进入 11-23 04:00。
		app := NewTestApp(t, WithClock(time.Date(2026, 11, 22, 20, 0, 0, 0, time.UTC)))
		client := app.Client()

		// 1. 按 UTC 校验时 2026-11-23 为未来日期，应返回 400 且无落库记录。
		utcResp := client.Post(t, "/api/baby?tz=UTC", baby.UpsertInput{
			Nickname:  "时区宝",
			BirthDate: "2026-11-23",
			Gender:    "unknown",
		})
		utcResp.RequireError(t, http.StatusBadRequest, "不能晚于今天")
		if got := CountRows[baby.Profile](t, app, ""); got != 0 {
			t.Fatalf("expected 0 baby profiles after UTC future rejection, got %d", got)
		}

		// 2. 按 Asia/Shanghai 校验时 2026-11-23 即为本地当天，应建档成功。
		shResp := client.Post(t, "/api/baby?tz=Asia/Shanghai", baby.UpsertInput{
			Nickname:  "时区宝",
			BirthDate: "2026-11-23",
			Gender:    "unknown",
		})
		shResp.RequireStatus(t, http.StatusCreated)
		if got := CountRows[baby.Profile](t, app, ""); got != 1 {
			t.Fatalf("expected 1 persisted baby profile, got %d", got)
		}
	})

	t.Run("边界_default_clinic_name三态更新与超长拦截", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t)
		profile := app.Scenario().EnsureBaby()
		client := app.Client()

		// 1. 传入带首尾空白的常去门诊名称，验证裁剪落库。
		setResp := client.Put(t, "/api/baby?tz=Asia/Shanghai", baby.UpsertInput{
			Nickname:          profile.Nickname,
			BirthDate:         profile.BirthDate,
			Gender:            profile.Gender,
			DefaultClinicName: ptr("  阳光街道社区卫生服务中心  "),
		})
		setResp.RequireStatus(t, http.StatusOK)
		if got := DecodeJSON[struct {
			Baby baby.Profile `json:"baby"`
		}](t, setResp).Baby.DefaultClinicName; got != "阳光街道社区卫生服务中心" {
			t.Fatalf("expected trimmed default_clinic_name, got %q", got)
		}

		// 2. 省略 default_clinic_name 更新昵称，验证既有常去门诊不被清空。
		keepResp := client.Put(t, "/api/baby?tz=Asia/Shanghai", map[string]any{
			"nickname":   "大汤圆",
			"birth_date": profile.BirthDate,
			"gender":     profile.Gender,
		})
		keepResp.RequireStatus(t, http.StatusOK)
		if got := DecodeJSON[struct {
			Baby baby.Profile `json:"baby"`
		}](t, keepResp).Baby.DefaultClinicName; got != "阳光街道社区卫生服务中心" {
			t.Fatalf("expected omitted default_clinic_name preserved, got %q", got)
		}
		if persisted := FirstRow[baby.Profile](t, app, "id = ?", profile.ID); persisted.DefaultClinicName != "阳光街道社区卫生服务中心" {
			t.Fatalf("expected SQLite default_clinic_name preserved, got %q", persisted.DefaultClinicName)
		}

		// 3. 传入超长（81 字）常去门诊返回 400 中文错误且不改动已落库值。
		overResp := client.Put(t, "/api/baby?tz=Asia/Shanghai", baby.UpsertInput{
			Nickname:          "大汤圆",
			BirthDate:         profile.BirthDate,
			Gender:            profile.Gender,
			DefaultClinicName: ptr(strings.Repeat("医", baby.MaxClinicNameLength+1)),
		})
		overResp.RequireError(t, http.StatusBadRequest, "80")
		if persisted := FirstRow[baby.Profile](t, app, "id = ?", profile.ID); persisted.DefaultClinicName != "阳光街道社区卫生服务中心" {
			t.Fatalf("expected SQLite default_clinic_name untouched after 400, got %q", persisted.DefaultClinicName)
		}

		// 4. 传入空字符串 "" 显式清空并经 GET /api/baby 与 SQLite 双重回读验证。
		clearResp := client.Put(t, "/api/baby?tz=Asia/Shanghai", baby.UpsertInput{
			Nickname:          "大汤圆",
			BirthDate:         profile.BirthDate,
			Gender:            profile.Gender,
			DefaultClinicName: ptr(""),
		})
		clearResp.RequireStatus(t, http.StatusOK)

		afterGet := client.Get(t, "/api/baby")
		afterGet.RequireStatus(t, http.StatusOK)
		afterBaby := DecodeJSON[struct {
			Baby *baby.Profile `json:"baby"`
		}](t, afterGet).Baby
		if afterBaby == nil || afterBaby.DefaultClinicName != "" {
			t.Fatalf("expected non-nil baby with empty default_clinic_name via GET /api/baby, got %+v", afterBaby)
		}
		if persisted := FirstRow[baby.Profile](t, app, "id = ?", profile.ID); persisted.DefaultClinicName != "" {
			t.Fatalf("expected empty default_clinic_name in SQLite, got %q", persisted.DefaultClinicName)
		}
	})

	t.Run("拒绝_未认证未建档更新非法入参与重复建档", func(t *testing.T) {
		t.Parallel()

		app := NewTestApp(t)
		anon := app.UnauthenticatedClient()
		client := app.Client()

		// 1. 未认证访问 GET/POST/PUT /api/baby 均返回 401 中文错误。
		anon.Get(t, "/api/baby").RequireError(t, http.StatusUnauthorized, "")
		anon.Post(t, "/api/baby", baby.UpsertInput{Nickname: "宝", BirthDate: "2026-07-01", Gender: "male"}).
			RequireError(t, http.StatusUnauthorized, "")
		anon.Put(t, "/api/baby", baby.UpsertInput{Nickname: "宝", BirthDate: "2026-07-01", Gender: "male"}).
			RequireError(t, http.StatusUnauthorized, "")

		// 2. 未建档时 PUT /api/baby 返回 404。
		client.Put(t, "/api/baby?tz=Asia/Shanghai", baby.UpsertInput{
			Nickname:  "团子",
			BirthDate: "2026-07-15",
			Gender:    "male",
		}).RequireError(t, http.StatusNotFound, "")

		// 3. 非法建档入参全部返回 400 中文错误且 SQLite 保持零行。
		invalidPayloads := []struct {
			name string
			in   baby.UpsertInput
		}{
			{"空昵称", baby.UpsertInput{Nickname: "   ", BirthDate: "2026-07-15", Gender: "male"}},
			{"超长昵称", baby.UpsertInput{Nickname: strings.Repeat("宝", baby.MaxNicknameLength+1), BirthDate: "2026-07-15", Gender: "male"}},
			{"畸形日期", baby.UpsertInput{Nickname: "小宝", BirthDate: "2026/07/15", Gender: "male"}},
			{"未来出生日", baby.UpsertInput{Nickname: "小宝", BirthDate: "2026-11-24", Gender: "male"}},
			{"非法性别", baby.UpsertInput{Nickname: "小宝", BirthDate: "2026-07-15", Gender: "other"}},
			{"越界体重", baby.UpsertInput{Nickname: "小宝", BirthDate: "2026-07-15", Gender: "male", BirthWeightKg: ptr(20.0)}},
			{"越界身高", baby.UpsertInput{Nickname: "小宝", BirthDate: "2026-07-15", Gender: "male", BirthHeightCm: ptr(120.0)}},
		}
		for _, tc := range invalidPayloads {
			resp := client.Post(t, "/api/baby?tz=Asia/Shanghai", tc.in)
			resp.RequireError(t, http.StatusBadRequest, "")
		}
		if got := CountRows[baby.Profile](t, app, ""); got != 0 {
			t.Fatalf("expected 0 baby profiles after invalid POSTs, got %d", got)
		}

		// 4. 建档后重复 POST /api/baby 返回 409 且原档案不被篡改。
		created := app.Scenario().EnsureBaby(BabyParams{Nickname: "原汤圆"})
		client.Post(t, "/api/baby?tz=Asia/Shanghai", baby.UpsertInput{
			Nickname:  "二宝",
			BirthDate: "2026-08-01",
			Gender:    "male",
		}).RequireError(t, http.StatusConflict, "")

		if got := CountRows[baby.Profile](t, app, ""); got != 1 {
			t.Fatalf("expected 1 baby profile after duplicate 409, got %d", got)
		}
		if persisted := FirstRow[baby.Profile](t, app, "id = ?", created.ID); persisted.Nickname != "原汤圆" {
			t.Fatalf("expected existing baby profile unchanged, got %+v", persisted)
		}
	})
}
