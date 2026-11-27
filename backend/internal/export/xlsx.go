// Package export 提供零外部依赖的宝宝照护数据多 Sheet Excel（.xlsx）导出服务与 OOXML 写入器。
package export

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

type cellValue struct {
	isNum bool
	num   float64
	str   string
}

func textCell(s string) cellValue {
	return cellValue{str: s}
}

func numCell(v float64) cellValue {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return cellValue{}
	}
	return cellValue{isNum: true, num: v}
}

func intCell(v int) cellValue {
	return cellValue{isNum: true, num: float64(v)}
}

type sheetSpec struct {
	Name      string
	Headers   []string
	Rows      [][]cellValue
	ColWidths []float64
}

// sanitizeSpreadsheetText 过滤 XML 1.0 非法控制字符，并对可能触发电子表格公式执行的危险前缀
// （=、+、-、@、\t、\r，含前导空白后的同类前缀）补加单引号，防止用户输入在 Excel/WPS/Numbers 中被误执行。
func sanitizeSpreadsheetText(raw string) string {
	if raw == "" {
		return ""
	}
	var b strings.Builder
	b.Grow(len(raw))
	for _, r := range raw {
		if r == '\t' || r == '\n' || r == '\r' || (r >= 0x20 && r != 0xFFFE && r != 0xFFFF) {
			b.WriteRune(r)
		}
	}
	cleaned := b.String()
	if cleaned == "" {
		return ""
	}
	first := cleaned[0]
	trimmed := strings.TrimLeft(cleaned, " \t\r\n")
	var trimmedFirst byte
	if len(trimmed) > 0 {
		trimmedFirst = trimmed[0]
	}
	if isFormulaPrefix(first) || isFormulaPrefix(trimmedFirst) {
		return "'" + cleaned
	}
	return cleaned
}

func isFormulaPrefix(b byte) bool {
	return b == '=' || b == '+' || b == '-' || b == '@' || b == '\t' || b == '\r'
}

// colIndexToName 将 0 起始列序号转换为 Excel 列字母（0->A, 25->Z, 26->AA）。
func colIndexToName(idx int) string {
	var chars []byte
	for n := idx; n >= 0; n = n/26 - 1 {
		chars = append(chars, byte('A'+n%26))
	}
	for i, j := 0, len(chars)-1; i < j; i, j = i+1, j-1 {
		chars[i], chars[j] = chars[j], chars[i]
	}
	return string(chars)
}

func xmlEscape(s string) string {
	var buf bytes.Buffer
	_ = xml.EscapeText(&buf, []byte(s))
	return buf.String()
}

// writeXLSXWorkbook 将若干工作表组装为标准 OOXML（.xlsx）ZIP 字节流，仅依赖 Go 标准库。
func writeXLSXWorkbook(sheets []sheetSpec) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	addEntry := func(name string, content string) error {
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = w.Write([]byte(content))
		return err
	}

	if err := addEntry("[Content_Types].xml", buildContentTypesXML(len(sheets))); err != nil {
		return nil, err
	}
	if err := addEntry("_rels/.rels", rootRelsXML); err != nil {
		return nil, err
	}
	if err := addEntry("xl/workbook.xml", buildWorkbookXML(sheets)); err != nil {
		return nil, err
	}
	if err := addEntry("xl/_rels/workbook.xml.rels", buildWorkbookRelsXML(len(sheets))); err != nil {
		return nil, err
	}
	if err := addEntry("xl/styles.xml", stylesXML); err != nil {
		return nil, err
	}

	for i, sheet := range sheets {
		sheetPath := fmt.Sprintf("xl/worksheets/sheet%d.xml", i+1)
		if err := addEntry(sheetPath, buildWorksheetXML(sheet, i == 0)); err != nil {
			return nil, err
		}
	}

	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

const rootRelsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
	`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
	`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
	`</Relationships>`

// stylesXML 定义最小合规样式表：字体 0 正文 / 字体 1 加粗表头；填充 0/1 为 Excel 保留项，填充 2 为淡鼠尾草绿表头底色。
const stylesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
	`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
	`<fonts count="2">` +
	`<font><sz val="11"/><name val="Calibri"/></font>` +
	`<font><b/><sz val="11"/><color rgb="FF1F2D24"/><name val="Calibri"/></font>` +
	`</fonts>` +
	`<fills count="3">` +
	`<fill><patternFill patternType="none"/></fill>` +
	`<fill><patternFill patternType="gray125"/></fill>` +
	`<fill><patternFill patternType="solid"><fgColor rgb="FFEAF1EC"/><bgColor indexed="64"/></patternFill></fill>` +
	`</fills>` +
	`<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
	`<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
	`<cellXfs count="2">` +
	`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="center"/></xf>` +
	`<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
	`</cellXfs>` +
	`<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
	`</styleSheet>`

func buildContentTypesXML(sheetCount int) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	b.WriteString(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`)
	b.WriteString(`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`)
	b.WriteString(`<Default Extension="xml" ContentType="application/xml"/>`)
	b.WriteString(`<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`)
	b.WriteString(`<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`)
	for i := 1; i <= sheetCount; i++ {
		fmt.Fprintf(&b, `<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`, i)
	}
	b.WriteString(`</Types>`)
	return b.String()
}

func buildWorkbookXML(sheets []sheetSpec) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	b.WriteString(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`)
	b.WriteString(`<sheets>`)
	for i, s := range sheets {
		fmt.Fprintf(&b, `<sheet name="%s" sheetId="%d" r:id="rId%d"/>`, xmlEscape(s.Name), i+1, i+1)
	}
	b.WriteString(`</sheets></workbook>`)
	return b.String()
}

func buildWorkbookRelsXML(sheetCount int) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	b.WriteString(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`)
	for i := 1; i <= sheetCount; i++ {
		fmt.Fprintf(&b, `<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>`, i, i)
	}
	fmt.Fprintf(&b, `<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`, sheetCount+1)
	b.WriteString(`</Relationships>`)
	return b.String()
}

func buildWorksheetXML(sheet sheetSpec, selected bool) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	b.WriteString(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`)

	colCount := len(sheet.Headers)
	rowCount := len(sheet.Rows) + 1
	if colCount > 0 {
		fmt.Fprintf(&b, `<dimension ref="A1:%s%d"/>`, colIndexToName(colCount-1), rowCount)
	}

	// 冻结第 1 行表头（ySplit="1"），方便家长在长周期明细表中向下滚动时始终对照列名。
	b.WriteString(`<sheetViews><sheetView`)
	if selected {
		b.WriteString(` tabSelected="1"`)
	}
	b.WriteString(` workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`)
	b.WriteString(`<sheetFormatPr defaultRowHeight="20"/>`)

	if colCount > 0 {
		b.WriteString(`<cols>`)
		for i := range colCount {
			width := 14.0
			if i < len(sheet.ColWidths) && sheet.ColWidths[i] > 0 {
				width = sheet.ColWidths[i]
			} else {
				width = estimateColWidth(sheet.Headers[i])
			}
			fmt.Fprintf(&b, `<col min="%d" max="%d" width="%.1f" customWidth="1"/>`, i+1, i+1, width)
		}
		b.WriteString(`</cols>`)
	}

	b.WriteString(`<sheetData>`)
	// 文本单元格统一使用 inlineStr（直接内联文本而不维护全局 sharedStrings.xml 索引表），降低出错面并兼容主流表格软件；
	// 表头行固定位于第 1 行并应用样式 1（加粗 + 浅底色）。
	b.WriteString(`<row r="1" ht="24" customHeight="1">`)
	for colIdx, h := range sheet.Headers {
		ref := colIndexToName(colIdx) + "1"
		fmt.Fprintf(&b, `<c r="%s" s="1" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>`, ref, xmlEscape(sanitizeSpreadsheetText(h)))
	}
	b.WriteString(`</row>`)

	for rowIdx, row := range sheet.Rows {
		rNum := rowIdx + 2
		fmt.Fprintf(&b, `<row r="%d">`, rNum)
		for colIdx, cell := range row {
			ref := fmt.Sprintf("%s%d", colIndexToName(colIdx), rNum)
			if cell.isNum {
				fmt.Fprintf(&b, `<c r="%s" s="0" t="n"><v>%s</v></c>`, ref, strconv.FormatFloat(cell.num, 'f', -1, 64))
			} else if cell.str != "" {
				safe := sanitizeSpreadsheetText(cell.str)
				fmt.Fprintf(&b, `<c r="%s" s="0" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>`, ref, xmlEscape(safe))
			}
		}
		b.WriteString(`</row>`)
	}

	b.WriteString(`</sheetData></worksheet>`)
	return b.String()
}

func estimateColWidth(header string) float64 {
	// 按中文宽字符 2 宽度、ASCII 1 宽度估算默认列宽并留余量。
	w := 0.0
	for _, r := range header {
		if utf8.RuneLen(r) > 1 {
			w += 2.2
		} else {
			w += 1.1
		}
	}
	if w < 10 {
		w = 10
	}
	return math.Round((w+4)*10) / 10
}
