package export

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/nt1r/babylog/backend/internal/timeutil"
)

func TestXLSXWriterAndSanitization(t *testing.T) {
	// 构造含 27 列（验证 Z -> AA 坐标进位）与多 Sheet 及危险公式前缀的工作簿。
	headers := make([]string, 27)
	row := make([]cellValue, 27)
	for i := range 27 {
		headers[i] = "列" + colIndexToName(i)
		row[i] = intCell(i + 1)
	}
	row[0] = textCell("=SUM(A1:A2)")
	row[1] = textCell("  +cmd|' /C calc'!A0")
	row[2] = textCell("-1+1")
	row[3] = textCell("@evil")
	row[4] = textCell("\tformula\x00\x07中文")
	row[5] = textCell("\rcarriage")
	row[6] = numCell(36.8)

	data, err := writeXLSXWorkbook([]sheetSpec{
		{Name: "按日汇总", Headers: headers, Rows: [][]cellValue{row}},
		{Name: "喂养明细", Headers: []string{"日期", "备注"}, Rows: [][]cellValue{{textCell("2026-11-23"), textCell("正常喝奶 & 休息")}}},
	})
	if err != nil {
		t.Fatalf("生成工作簿失败：%v", err)
	}

	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("解析 ZIP 失败：%v", err)
	}

	entries := make(map[string][]byte, len(zr.File))
	for _, f := range zr.File {
		rc, openErr := f.Open()
		if openErr != nil {
			t.Fatalf("打开 ZIP 条目 %s 失败：%v", f.Name, openErr)
		}
		raw, readErr := io.ReadAll(rc)
		_ = rc.Close()
		if readErr != nil {
			t.Fatalf("读取 ZIP 条目 %s 失败：%v", f.Name, readErr)
		}
		// 验证全部 XML 条目均可被标准 XML 解码器无错解析。
		dec := xml.NewDecoder(bytes.NewReader(raw))
		for {
			if _, tokErr := dec.Token(); tokErr != nil {
				if errors.Is(tokErr, io.EOF) {
					break
				}
				t.Fatalf("XML 条目 %s 格式非法：%v", f.Name, tokErr)
			}
		}
		entries[f.Name] = raw
	}

	required := []string{
		"[Content_Types].xml",
		"_rels/.rels",
		"xl/workbook.xml",
		"xl/_rels/workbook.xml.rels",
		"xl/styles.xml",
		"xl/worksheets/sheet1.xml",
		"xl/worksheets/sheet2.xml",
	}
	for _, name := range required {
		if _, ok := entries[name]; !ok {
			t.Fatalf("缺少必需的 OOXML 条目 %s", name)
		}
	}

	sheet1 := string(entries["xl/worksheets/sheet1.xml"])
	if !strings.Contains(sheet1, `r="AA1"`) || !strings.Contains(sheet1, `r="AA2"`) {
		t.Errorf("超 26 列坐标进位异常，未找到 AA1/AA2：%s", sheet1)
	}
	for _, want := range []string{
		`&#39;=SUM(A1:A2)`,
		`&#39;  +cmd|&#39; /C calc&#39;!A0`,
		`&#39;-1+1`,
		`&#39;@evil`,
		`&#39;&#x9;formula中文`,
		`&#39;&#xD;carriage`,
		`<v>36.8</v>`,
	} {
		if !strings.Contains(sheet1, want) {
			t.Errorf("sheet1 未包含预期的转义或数值内容 %q", want)
		}
	}
	if strings.Contains(sheet1, "\x00") || strings.Contains(sheet1, "\x07") {
		t.Errorf("sheet1 不应残留 XML 1.0 非法控制字符")
	}
}

func TestBuildExportWorkbookValidation(t *testing.T) {
	shanghai, err := timeutil.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatalf("load shanghai: %v", err)
	}
	fixedNow := time.Date(2026, 11, 23, 2, 0, 0, 0, time.UTC)
	svc := NewService(nil).WithClock(func() time.Time { return fixedNow })

	cases := []struct {
		name    string
		params  Params
		wantErr string
	}{
		{
			name:   "默认参数解析为近30天全5类",
			params: Params{BabyID: 1, Loc: shanghai},
		},
		{
			name:   "自定义366天上限边界合法",
			params: Params{BabyID: 1, StartRaw: "2025-11-23", EndRaw: "2026-11-23", CategoriesRaw: "feeding,care", Loc: shanghai},
		},
		{
			name:    "同时传入days与自定义起止日期拒绝",
			params:  Params{BabyID: 1, DaysRaw: "7", StartRaw: "2026-11-01", EndRaw: "2026-11-07", Loc: shanghai},
			wantErr: "请勿同时",
		},
		{
			name:    "仅传start缺少end拒绝",
			params:  Params{BabyID: 1, StartRaw: "2026-11-01", Loc: shanghai},
			wantErr: "同时提供",
		},
		{
			name:    "日期格式错误拒绝",
			params:  Params{BabyID: 1, StartRaw: "2026/11/01", EndRaw: "2026-11-07", Loc: shanghai},
			wantErr: "YYYY-MM-DD",
		},
		{
			name:    "结束日期早于开始日期拒绝",
			params:  Params{BabyID: 1, StartRaw: "2026-11-10", EndRaw: "2026-11-05", Loc: shanghai},
			wantErr: "不能早于",
		},
		{
			name:    "跨度367天超上限拒绝",
			params:  Params{BabyID: 1, StartRaw: "2025-11-22", EndRaw: "2026-11-23", Loc: shanghai},
			wantErr: "366",
		},
		{
			name:    "非法days超上限拒绝",
			params:  Params{BabyID: 1, DaysRaw: "367", Loc: shanghai},
			wantErr: "导出天数",
		},
		{
			name:    "非法days为0拒绝",
			params:  Params{BabyID: 1, DaysRaw: "0", Loc: shanghai},
			wantErr: "导出天数",
		},
		{
			name:    "显式传空categories拒绝",
			params:  Params{BabyID: 1, CategoriesRaw: "", CategoriesProvided: true, Loc: shanghai},
			wantErr: "导出指标类型无效",
		},
		{
			name:    "categories含空项拒绝",
			params:  Params{BabyID: 1, CategoriesRaw: "feeding,", CategoriesProvided: true, Loc: shanghai},
			wantErr: "导出指标类型无效",
		},
		{
			name:    "categories含未知分类拒绝",
			params:  Params{BabyID: 1, CategoriesRaw: "feeding,unknown", CategoriesProvided: true, Loc: shanghai},
			wantErr: "导出指标类型无效",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			q, qErr := svc.resolveQuery(tc.params, shanghai)
			if tc.wantErr != "" {
				var ve *ValidationError
				if !errors.As(qErr, &ve) || !strings.Contains(ve.Message, tc.wantErr) {
					t.Fatalf("预期 ValidationError 包含 %q，实际 err=%v", tc.wantErr, qErr)
				}
				return
			}
			if qErr != nil {
				t.Fatalf("预期合法参数通过校验，实际报错：%v", qErr)
			}
			if len(q.dateKeys) == 0 || len(q.categories) == 0 {
				t.Fatalf("合法参数应生成非空日期键与分类列表：%+v", q)
			}
		})
	}
}
