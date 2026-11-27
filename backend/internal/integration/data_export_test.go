package integration_test

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/nt1r/babylog/backend/internal/records"
)

type xlsxWorkbookXML struct {
	Sheets []struct {
		Name string `xml:"name,attr"`
	} `xml:"sheets>sheet"`
}

type xlsxWorksheetXML struct {
	Rows []struct {
		Index int `xml:"r,attr"`
		Cells []struct {
			Ref   string `xml:"r,attr"`
			Value string `xml:"v"`
			Text  string `xml:"is>t"`
		} `xml:"c"`
	} `xml:"sheetData>row"`
}

// extractRowValues 提取指定工作表 XML 中每一行的单元格文本/数值切片，用于精确核对行归属与本地时区格式化结果。
func extractRowValues(t *testing.T, sheetXML string) [][]string {
	t.Helper()
	var ws xlsxWorksheetXML
	if err := xml.Unmarshal([]byte(sheetXML), &ws); err != nil {
		t.Fatalf("解析工作表 XML 失败：%v", err)
	}
	rows := make([][]string, 0, len(ws.Rows))
	for _, r := range ws.Rows {
		vals := make([]string, 0, len(r.Cells))
		for _, c := range r.Cells {
			if c.Text != "" {
				vals = append(vals, c.Text)
			} else {
				vals = append(vals, c.Value)
			}
		}
		rows = append(rows, vals)
	}
	return rows
}

// decodeXLSXSheets 解包并解析导出响应中的工作簿名称与全部工作表 XML 文本，用于黑盒断言工作簿内容。
func decodeXLSXSheets(t *testing.T, raw []byte) ([]string, map[string]string) {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatalf("导出响应不是有效的 ZIP/XLSX 文件：%v", err)
	}
	files := make(map[string][]byte, len(zr.File))
	for _, f := range zr.File {
		rc, openErr := f.Open()
		if openErr != nil {
			t.Fatalf("打开工作簿条目 %s 失败：%v", f.Name, openErr)
		}
		b, readErr := io.ReadAll(rc)
		_ = rc.Close()
		if readErr != nil {
			t.Fatalf("读取工作簿条目 %s 失败：%v", f.Name, readErr)
		}
		files[f.Name] = b
	}

	var wb xlsxWorkbookXML
	if err := xml.Unmarshal(files["xl/workbook.xml"], &wb); err != nil {
		t.Fatalf("解析 xl/workbook.xml 失败：%v", err)
	}
	names := make([]string, 0, len(wb.Sheets))
	sheetXML := make(map[string]string, len(wb.Sheets))
	for i, s := range wb.Sheets {
		names = append(names, s.Name)
		key := "xl/worksheets/sheet" + strconv.Itoa(i+1) + ".xml"
		content, ok := files[key]
		if !ok {
			t.Fatalf("缺少工作表文件 %s（对应 %s）", key, s.Name)
		}
		sheetXML[s.Name] = string(content)
	}
	return names, sheetXML
}

/*
 * Spec: data-export / Multi-sheet Excel workbook export by date range and categories / Export multi-sheet workbook with daily summary and selected category detail sheets; Export filtered category subset and sanitize spreadsheet formula prefixes
 * 测试场景：验证多 Sheet Excel 导出（按日汇总 + 全五类明细）、按所选类别裁剪工作表与列、跨夜睡眠汇总、多宝宝严格隔离及公式前缀注入中和。
 * 业务背景：家长在就医或阶段复盘时会按时间范围与指标类别导出 Excel，需保证导出文件可被主流表格软件直接打开、只含当前宝宝记录且危险文本不会被误作公式执行。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：已初始化并登录管理员
 * - 宝宝档案：目标宝宝小汤圆与同账号下的另一个宝宝小团子（步骤 3 另建空记录且昵称含特殊字符的宝宝）
 * - 前置业务记录：小汤圆在 11-21 至 11-23 写入含危险公式备注的配方奶、瓶喂母乳、亲喂、跨夜睡眠、尿布与洗澡、体温与用药、生长测量与长牙记录；小团子写入特征备注喂养记录
 * 测试目标：
 * 1. 验证自定义区间全五类导出返回合法 .xlsx 响应头、6 个有序工作表、跨夜睡眠按日切分汇总与多宝宝严格隔离。
 * 2. 验证仅选 feeding,care 的子集导出仅包含按日汇总与对应两张明细表，且危险公式前缀备注已被安全中和为纯文本。
 * 3. 验证空记录特殊字符昵称宝宝的默认参数导出（30 天全 5 类 + Content-Disposition 防头注入清洗）与恰好 366 天上限边界导出均返回合法 .xlsx。
 */
func TestDataExportMultiSheetXLSXAndSanitization(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	s := app.Scenario()
	babyA := s.EnsureBaby(BabyParams{Nickname: "小汤圆"})
	babyB := s.EnsureBaby(BabyParams{Nickname: "小团子"})
	sA := s.ForBaby(babyA.ID)
	sB := s.ForBaby(babyB.ID)

	// 前置造数：目标宝宝写入 5 类记录（含跨 UTC 喂养、公式前缀备注与跨夜睡眠），另一宝宝写入隔离校验记录。
	sA.AddFormula(120, "2026-11-22T16:30:00Z", "=SUM(A1:A2)")                              // 11-23 00:30+08
	sA.AddBottleBreast(80, "2026-11-23T01:00:00Z", "正常母乳")                                 // 11-23 09:00+08
	sA.AddDirectBreast("left", 15, "2026-11-22T02:00:00Z")                                 // 11-22 10:00+08
	sA.AddSleep(records.SleepSubtypeNight, "2026-11-22T14:00:00Z", "2026-11-22T22:00:00Z") // 22:00→次日06:00（2.0h / 6.0h）
	sA.AddDiaper("both", "soft", "yellow", "2026-11-23T01:10:00Z")                         // 11-23 嘘嘘+便便
	sA.AddBath("2026-11-22T11:00:00Z")                                                     // 11-22 洗澡
	sA.AddTemperature(37.8, "2026-11-23T01:20:00Z")                                        // 11-23 体温
	sA.AddMedicine("维生素 D3", "1 粒", "2026-11-23T01:25:00Z")                                // 11-23 用药
	sA.AddGrowth(GrowthParams{WeightKg: ptr(7.35), HeightCm: ptr(65.2), RecordedAt: "2026-11-21T04:00:00Z"})
	sA.AddTooth("下中切牙（第 1 颗）", "2026-11-22T04:00:00Z")
	sB.AddFormula(180, "2026-11-23T01:30:00Z", "隔离标记-仅小团子可见")

	// 1. 请求自定义区间全五类导出，校验响应头、6 张有序 Sheet、跨夜睡眠汇总与零跨宝宝串数。
	fullResp := app.Client().Get(t, babyPath(babyA.ID, "/export/xlsx?start=2026-11-21&end=2026-11-23&categories=feeding,sleep,care,health,growth&tz=Asia/Shanghai"))
	fullResp.RequireStatus(t, http.StatusOK)

	wantCT := "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	if gotCT := fullResp.Header.Get("Content-Type"); !strings.HasPrefix(gotCT, wantCT) {
		t.Errorf("导出 Content-Type 异常：got=%q want=%q", gotCT, wantCT)
	}
	if cc := fullResp.Header.Get("Cache-Control"); cc != "no-store" {
		t.Errorf("导出响应须禁用缓存，实际 Cache-Control=%q", cc)
	}
	if cd := fullResp.Header.Get("Content-Disposition"); !strings.Contains(cd, "attachment;") || !strings.Contains(cd, "babylog-export-20261121-20261123.xlsx") {
		t.Errorf("导出 Content-Disposition 缺少预期文件名：%q", cd)
	}

	names, sheets := decodeXLSXSheets(t, fullResp.Body)
	wantNames := []string{"按日汇总", "喂养明细", "睡眠明细", "护理明细", "健康明细", "生长发育明细"}
	if strings.Join(names, ",") != strings.Join(wantNames, ",") {
		t.Fatalf("全分类导出工作表清单异常：got=%v want=%v", names, wantNames)
	}

	// 逐行核验按日汇总：确认 11-21（生长）、11-22（跨夜睡眠首日 2h + 亲喂 15min + 长牙）与 11-23（跨夜睡眠次日 6h + 奶量 200ml + 体温 37.8）均归属准确。
	summaryRows := extractRowValues(t, sheets["按日汇总"])
	if len(summaryRows) != 4 {
		t.Fatalf("按日汇总预期 1 行表头 + 3 行数据，实际 %d 行", len(summaryRows))
	}
	row21 := strings.Join(summaryRows[1], "|")
	row22 := strings.Join(summaryRows[2], "|")
	row23 := strings.Join(summaryRows[3], "|")
	if !strings.HasPrefix(row21, "2026-11-21|") || !strings.Contains(row21, "|7.35|65.2") {
		t.Errorf("2026-11-21 汇总行异常：%s", row21)
	}
	if !strings.HasPrefix(row22, "2026-11-22|") || !strings.Contains(row22, "|2|2|0|0|") || !strings.Contains(row22, "下中切牙（第 1 颗）") {
		t.Errorf("2026-11-22 跨夜睡眠首日（预期 2h）与长牙汇总行异常：%s", row22)
	}
	if !strings.HasPrefix(row23, "2026-11-23|200|120|1|80|1|") || !strings.Contains(row23, "|6|6|0|0|") || !strings.Contains(row23, "|37.8|1") {
		t.Errorf("2026-11-23 跨夜睡眠次日（预期 6h）、奶量与健康汇总行异常：%s", row23)
	}
	// 核验喂养明细中跨 UTC 日界线记录（2026-11-22T16:30:00Z）已按东八区格式化为 2026-11-23 00:30。
	feedingRows := extractRowValues(t, sheets["喂养明细"])
	if len(feedingRows) != 4 || !strings.HasPrefix(strings.Join(feedingRows[2], "|"), "2026-11-23|00:30|配方奶|120|") {
		t.Errorf("喂养明细跨 UTC 记录东八区格式化异常：rows=%v", feedingRows)
	}
	for sheetName, content := range sheets {
		if strings.Contains(content, "隔离标记-仅小团子可见") {
			t.Errorf("工作表 %s 泄露了同账号其他宝宝的数据", sheetName)
		}
	}
	if !strings.Contains(sheets["健康明细"], "维生素 D3") || strings.Contains(sheets["健康明细"], "下中切牙") {
		t.Errorf("健康明细应仅包含体温与用药，不应混入生长长牙")
	}
	if !strings.Contains(sheets["生长发育明细"], "下中切牙") || strings.Contains(sheets["生长发育明细"], "维生素 D3") {
		t.Errorf("生长发育明细应仅包含体格与长牙，不应混入体温用药")
	}

	// 2. 请求仅含 feeding,care 的子集导出，校验仅输出 3 张表、剔除未选列且公式前缀备注已中和。
	subResp := app.Client().Get(t, babyPath(babyA.ID, "/export/xlsx?days=7&categories=feeding,care&tz=Asia/Shanghai"))
	subResp.RequireStatus(t, http.StatusOK)

	subNames, subSheets := decodeXLSXSheets(t, subResp.Body)
	wantSubNames := []string{"按日汇总", "喂养明细", "护理明细"}
	if strings.Join(subNames, ",") != strings.Join(wantSubNames, ",") {
		t.Fatalf("子集导出工作表清单异常：got=%v want=%v", subNames, wantSubNames)
	}
	if strings.Contains(subSheets["按日汇总"], "总睡眠(小时)") || strings.Contains(subSheets["按日汇总"], "最高体温(℃)") {
		t.Errorf("按日汇总不应包含未勾选分类的统计列")
	}
	if !strings.Contains(subSheets["喂养明细"], "&#39;=SUM(A1:A2)") {
		t.Errorf("喂养明细未对危险公式前缀备注进行单引号中和：%s", subSheets["喂养明细"])
	}

	// 3. 空记录特殊字符昵称宝宝：验证默认参数导出（30 天全 5 类 + 防 Content-Disposition 头注入）与恰好 366 天上限边界。
	emptyBaby := s.EnsureBaby(BabyParams{Nickname: `小"汤;圆/宝`})
	defaultResp := app.Client().Get(t, babyPath(emptyBaby.ID, "/export/xlsx"))
	defaultResp.RequireStatus(t, http.StatusOK)
	cd := defaultResp.Header.Get("Content-Disposition")
	if strings.Contains(cd, "%22") || strings.Contains(cd, "%3B") || strings.Contains(cd, "%2F") ||
		!strings.Contains(cd, "filename*=UTF-8''"+url.PathEscape("小汤圆宝-照护记录-")) {
		t.Fatalf("Content-Disposition 未按预期清洗危险字符并保留合法中文昵称：%q", cd)
	}
	defNames, defSheets := decodeXLSXSheets(t, defaultResp.Body)
	if strings.Join(defNames, ",") != strings.Join(wantNames, ",") {
		t.Fatalf("默认参数导出应包含全 6 张 Sheet，实际 %v", defNames)
	}
	if defSummary := extractRowValues(t, defSheets["按日汇总"]); len(defSummary) != 31 {
		t.Fatalf("默认 30 天导出按日汇总预期 31 行（1 表头 + 30 天），实际 %d", len(defSummary))
	}
	if defFeed := extractRowValues(t, defSheets["喂养明细"]); len(defFeed) != 1 {
		t.Fatalf("空记录宝宝喂养明细预期仅含 1 行表头，实际 %d", len(defFeed))
	}

	maxSpanResp := app.Client().Get(t, babyPath(emptyBaby.ID, "/export/xlsx?start=2025-11-23&end=2026-11-23&categories=feeding&tz=Asia/Shanghai"))
	maxSpanResp.RequireStatus(t, http.StatusOK)
	_, maxSheets := decodeXLSXSheets(t, maxSpanResp.Body)
	if maxSummary := extractRowValues(t, maxSheets["按日汇总"]); len(maxSummary) != 367 {
		t.Fatalf("恰好 366 天上限导出按日汇总预期 367 行（1 表头 + 366 天），实际 %d", len(maxSummary))
	}
}

/*
 * Spec: data-export / Authenticated baby-scoped access to data export / Reject unauthenticated, pending-password, or foreign-baby export request
 * Spec: data-export / Multi-sheet Excel workbook export by date range and categories / Reject invalid export query parameters
 * 测试场景：验证 Excel 导出端点的鉴权（401）、强制改密门禁（403）、未知或跨用户宝宝隔离（404）以及各类非法查询参数拦截（400）。
 * 业务背景：数据导出一次可打包最多一年的宝宝健康与照护记录，必须在入口层严格守住身份认证、账号改密状态、宝宝归属隔离与范围上限防线。
 * 前置数据：
 * - 时钟与时区：2026-11-23 10:00+08:00（Asia/Shanghai）
 * - 管理员与会话：用户 A（admin）、待强制改密用户 P、已完成改密用户 B 及匿名客户端
 * - 宝宝档案：用户 A 建档小汤圆
 * - 前置业务记录：无
 * 测试目标：
 * 1. 验证匿名请求返回 401、待强制改密用户返回 403、未知宝宝及跨用户访问他人宝宝返回 404 且不返回任何工作簿字节。
 * 2. 验证非法时区、缺半边起止日期、倒置区间、超过 366 天跨度、同时传 days 与起止日期、越界 days 及非法 categories 均返回 400 中文错误。
 */
func TestDataExportAuthScopeAndQueryParamGuards(t *testing.T) {
	t.Parallel()

	app := NewTestApp(t)
	anon := app.UnauthenticatedClient()
	clientA := app.Client()
	babyA := app.ScenarioFor(clientA).EnsureBaby()
	clientPending, _ := app.CreateUserViaAdmin("ExportPending", "pending-init-secret-123")
	clientB, _ := app.CreateReadyUserViaAdmin("ExportUserB", "userb-init-secret-123", "userb-final-secret-456")

	exportURL := babyPath(babyA.ID, "/export/xlsx")

	// 1. 验证匿名（401）、待强制改密（403）、未知宝宝与跨用户越权（404）全部被拦截。
	anon.Get(t, exportURL).RequireError(t, http.StatusUnauthorized, "")
	clientPending.Get(t, exportURL).RequireError(t, http.StatusForbidden, "初始密码")
	clientA.Get(t, babyPath(999, "/export/xlsx")).RequireError(t, http.StatusNotFound, "")
	clientB.Get(t, exportURL).RequireError(t, http.StatusNotFound, "")

	// 2. 验证各类非法查询参数均返回 HTTP 400 与明确中文错误消息。
	badQueries := []struct {
		query   string
		wantMsg string
	}{
		{"?tz=Invalid/Zone", "时区"},
		{"?start=2026-11-01", "同时提供"},
		{"?end=2026-11-23", "同时提供"},
		{"?start=2026-11-23&end=2026-11-01", "不能早于"},
		{"?start=2025-11-22&end=2026-11-23", "366"},
		{"?start=2026/11/01&end=2026-11-23", "YYYY-MM-DD"},
		{"?days=7&start=2026-11-17&end=2026-11-23", "请勿同时"},
		{"?days=0", "导出天数"},
		{"?days=367", "导出天数"},
		{"?days=abc", "导出天数"},
		{"?categories=", "导出指标类型"},
		{"?categories=feeding,unknown", "导出指标类型"},
		{"?categories=feeding,", "导出指标类型"},
	}
	for _, tc := range badQueries {
		clientA.Get(t, exportURL+tc.query).RequireError(t, http.StatusBadRequest, tc.wantMsg)
	}
}
