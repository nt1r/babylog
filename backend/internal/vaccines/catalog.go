package vaccines

// medicalDisclaimer 为面向家长的统一医疗风险声明，强调本应用仅作记录参考，不得替代官方接种证与医嘱。
const medicalDisclaimer = "仅供参考，不能作为医疗依据；接种前请务必自行核实，以纸质《预防接种证》及接种医生医嘱为准。"

// optionalCatalogDisclaimer 为自费疫苗模板库专属风险提示。
const optionalCatalogDisclaimer = "自费疫苗因品牌与起始月龄不同，剂次间隔差异较大；加入后请按接种门诊排期及说明书核对日期。"

// templateDose 定义模板中单剂的适龄月龄与剂次专属说明。
type templateDose struct {
	DoseNumber      int
	AgeMonths       int
	AgeLabel        string
	Route           string // 可覆盖疫苗级默认接种途径（如脊灰前2剂IPV注射、后2剂bOPV口服）
	DoseTip         string
	IsBirthHospital bool
}

// vaccineTemplate 定义内置只读疫苗知识库条目（国家免疫规划 + 常见自费模板）。
type vaccineTemplate struct {
	Code              string
	Name              string
	ShortName         string
	Category          string
	Prevents          string
	Route             string
	PrecautionsBefore []string
	PrecautionsAfter  []string
	RiskWarning       string
	Doses             []templateDose
}

var (
	commonPrecautionsBefore = []string{
		"携带纸质《预防接种证》，给宝宝穿宽松衣物。",
		"发热、急性疾病或严重腹泻期应告知医生并暂缓接种。",
		"主动告知既往过敏史、上次接种反应及近期用药情况。",
	}
	commonPrecautionsAfter = []string{
		"接种后现场留观满 30 分钟无异常再离开。",
		"当日避开针眼揉搓与久泡，留意精神、食欲与体温。",
		"轻度低热或局部微红多在 48–72 小时缓解；持续高热（≥38.5℃）、精神萎靡或全身皮疹请立即就医。",
	}
)

// builtInCatalog 依据《国家免疫规划疫苗儿童免疫程序及说明》（含 2025 年 1 月起百白破新规）
// 与国内常见非免疫规划疫苗说明书整理；仅作为只读参考目录，不替代当地接种门诊医嘱。
var builtInCatalog = []vaccineTemplate{
	// ===================== 国家免疫规划疫苗（免费 · 8 类共 22 剂） =====================
	{
		Code:              "hepb",
		Name:              "乙肝疫苗",
		ShortName:         "乙肝",
		Category:          CategoryNIP,
		Prevents:          "乙型病毒性肝炎",
		Route:             "肌内注射",
		PrecautionsBefore: commonPrecautionsBefore,
		PrecautionsAfter:  commonPrecautionsAfter,
		RiskWarning:       "HBsAg 阳性/不详产妇且出生体重 <2000g 的新生儿常需 4 剂程序（出生 12h 内联用 HBIG + 1/2/7 月龄）；早产危重症须遵医嘱。",
		Doses: []templateDose{
			{DoseNumber: 1, AgeMonths: 0, AgeLabel: "出生时", DoseTip: "常规出生后 24 小时内（多在 2–12 小时）在产院接种。", IsBirthHospital: true},
			{DoseNumber: 2, AgeMonths: 1, AgeLabel: "1月龄", DoseTip: "与第 1 剂间隔 ≥28 天。"},
			{DoseNumber: 3, AgeMonths: 6, AgeLabel: "6月龄", DoseTip: "与第 2 剂间隔 ≥60 天，建议 12 月龄内完成。"},
		},
	},
	{
		Code:      "bcg",
		Name:      "卡介苗",
		ShortName: "卡介苗",
		Category:  CategoryNIP,
		Prevents:  "儿童重症结核病",
		Route:     "皮内注射",
		PrecautionsBefore: []string{
			"核对出院小结确认出生时是否已种；早产或黄疸暂缓者请按医嘱补种。",
		},
		PrecautionsAfter: []string{
			"2–4 周局部红肿化脓结痂属正常反应，切勿挤压或私自涂药。",
			"现场留观 30 分钟；腋下淋巴结明显肿大化脓请及时复诊。",
		},
		RiskWarning: "免疫缺陷、严重湿疹或未稳定早产儿须由医生评估；满 3 月龄及以上补种前通常需先做 PPD 皮试。",
		Doses: []templateDose{
			{DoseNumber: 1, AgeMonths: 0, AgeLabel: "出生时", DoseTip: "常规出生后次日或出院前接种，未种者 3 月龄内尽早补种。", IsBirthHospital: true},
		},
	},
	{
		Code:      "polio",
		Name:      "脊灰疫苗",
		ShortName: "脊灰",
		Category:  CategoryNIP,
		Prevents:  "脊髓灰质炎（小儿麻痹）",
		Route:     "IPV 注射 / bOPV 口服",
		PrecautionsBefore: []string{
			"口服 bOPV 前后 30 分钟内避免喂热奶、热水或进食。",
			"发热、急性腹泻或免疫功能缺陷请提前告知医生。",
		},
		PrecautionsAfter: commonPrecautionsAfter,
		RiskWarning:      "部分省市已免费升级为更多剂次 IPV；免疫缺陷儿童禁用口服 bOPV，须全程用 IPV。",
		Doses: []templateDose{
			{DoseNumber: 1, AgeMonths: 2, AgeLabel: "2月龄", Route: "肌内注射（IPV）", DoseTip: "第 1 剂为灭活注射（IPV）。"},
			{DoseNumber: 2, AgeMonths: 3, AgeLabel: "3月龄", Route: "肌内注射（IPV）", DoseTip: "第 2 剂为灭活注射（IPV），间隔 ≥28 天。"},
			{DoseNumber: 3, AgeMonths: 4, AgeLabel: "4月龄", Route: "口服（bOPV）", DoseTip: "常规为口服 bOPV，部分省市提供免费 IPV。"},
			{DoseNumber: 4, AgeMonths: 48, AgeLabel: "4周岁", Route: "口服（bOPV）", DoseTip: "4 周岁加强，口服前后 30 分钟避开热饮热奶。"},
		},
	},
	{
		Code:              "dtap",
		Name:              "百白破疫苗",
		ShortName:         "百白破",
		Category:          CategoryNIP,
		Prevents:          "百日咳、白喉、破伤风",
		Route:             "肌内注射",
		PrecautionsBefore: commonPrecautionsBefore,
		PrecautionsAfter:  commonPrecautionsAfter,
		RiskWarning:       "2025 年前已按旧程序（3/4/5 月龄起）接种的宝宝请以门诊衔接方案为准；既往出现严重过敏或脑病反应须医生评估。",
		Doses: []templateDose{
			{DoseNumber: 1, AgeMonths: 2, AgeLabel: "2月龄", DoseTip: "2025 新规第 1 剂提前至 2 月龄。"},
			{DoseNumber: 2, AgeMonths: 4, AgeLabel: "4月龄", DoseTip: "与第 1 剂间隔 ≥28 天。"},
			{DoseNumber: 3, AgeMonths: 6, AgeLabel: "6月龄", DoseTip: "建议 12 月龄内完成前 3 剂。"},
			{DoseNumber: 4, AgeMonths: 18, AgeLabel: "18月龄", DoseTip: "加强针，与第 3 剂间隔 ≥6 个月。"},
			{DoseNumber: 5, AgeMonths: 72, AgeLabel: "6周岁", DoseTip: "2025 新规 6 周岁加强接种百白破。"},
		},
	},
	{
		Code:              "mmr",
		Name:              "麻腮风疫苗",
		ShortName:         "麻腮风",
		Category:          CategoryNIP,
		Prevents:          "麻疹、流行性腮腺炎、风疹",
		Route:             "皮下注射",
		PrecautionsBefore: commonPrecautionsBefore,
		PrecautionsAfter: []string{
			"现场留观 30 分钟；接种后 5–12 天可能出现一过性低热或轻微皮疹，高热不退请就医。",
		},
		RiskWarning: "属减毒活疫苗，未与其他注射类减毒活疫苗同天接种须间隔 ≥28 天；近期输注血制品/免疫球蛋白或免疫缺陷者须遵医嘱。",
		Doses: []templateDose{
			{DoseNumber: 1, AgeMonths: 8, AgeLabel: "8月龄", DoseTip: "满 8 月龄尽早接种，建议 12 月龄内完成。"},
			{DoseNumber: 2, AgeMonths: 18, AgeLabel: "18月龄", DoseTip: "满 18 月龄加强第 2 剂。"},
		},
	},
	{
		Code:              "je_l",
		Name:              "乙脑减毒活疫苗",
		ShortName:         "乙脑",
		Category:          CategoryNIP,
		Prevents:          "流行性乙型脑炎",
		Route:             "皮下注射",
		PrecautionsBefore: commonPrecautionsBefore,
		PrecautionsAfter:  commonPrecautionsAfter,
		RiskWarning:       "部分省市免费提供乙脑灭活（4 剂），免疫缺陷儿童亦需选灭活；减毒活疫苗未同天接种须间隔 ≥28 天。",
		Doses: []templateDose{
			{DoseNumber: 1, AgeMonths: 8, AgeLabel: "8月龄", DoseTip: "可与麻腮风同天不同部位接种，不同天须间隔 ≥28 天。"},
			{DoseNumber: 2, AgeMonths: 24, AgeLabel: "2周岁", DoseTip: "2 周岁加强 1 剂。"},
		},
	},
	{
		Code:              "men_polysaccharide",
		Name:              "流脑多糖疫苗",
		ShortName:         "流脑",
		Category:          CategoryNIP,
		Prevents:          "流行性脑脊髓膜炎",
		Route:             "皮下注射",
		PrecautionsBefore: commonPrecautionsBefore,
		PrecautionsAfter:  commonPrecautionsAfter,
		RiskWarning:       "A 群两剂间隔 ≥3 个月，A+C 群两剂间隔 ≥3 年；具体以当地门诊方案为准。",
		Doses: []templateDose{
			{DoseNumber: 1, AgeMonths: 6, AgeLabel: "6月龄", DoseTip: "A 群流脑多糖第 1 剂。"},
			{DoseNumber: 2, AgeMonths: 9, AgeLabel: "9月龄", DoseTip: "A 群流脑多糖第 2 剂，间隔 ≥3 个月。"},
			{DoseNumber: 3, AgeMonths: 36, AgeLabel: "3周岁", DoseTip: "A+C 群流脑多糖第 1 剂。"},
			{DoseNumber: 4, AgeMonths: 72, AgeLabel: "6周岁", DoseTip: "A+C 群流脑多糖第 2 剂，间隔 ≥3 年。"},
		},
	},
	{
		Code:              "hepa_l",
		Name:              "甲肝减毒活疫苗",
		ShortName:         "甲肝",
		Category:          CategoryNIP,
		Prevents:          "甲型病毒性肝炎",
		Route:             "皮下注射",
		PrecautionsBefore: commonPrecautionsBefore,
		PrecautionsAfter:  commonPrecautionsAfter,
		RiskWarning:       "北京、上海、天津、江苏等部分省市免费提供甲肝灭活（2 剂：18 月龄、2 周岁）；减毒活未同天接种须间隔 ≥28 天。",
		Doses: []templateDose{
			{DoseNumber: 1, AgeMonths: 18, AgeLabel: "18月龄", DoseTip: "若当地接种甲肝灭活，通常需 2 周岁再种第 2 剂。"},
		},
	},

	// ===================== 常见非免疫规划疫苗（自费 · 5 类无冲突精选模板） =====================
	{
		Code:              "pcv13",
		Name:              "13价肺炎球菌结合疫苗",
		ShortName:         "13价肺炎",
		Category:          CategoryOptional,
		Prevents:          "13 种血清型肺炎球菌感染",
		Route:             "肌内注射",
		PrecautionsBefore: commonPrecautionsBefore,
		PrecautionsAfter:  commonPrecautionsAfter,
		RiskWarning:       "进口（辉瑞）限 15 月龄内，国产（沃森/康泰等）可种至 5 岁且大月龄起种剂次递减；载体蛋白不同，请以说明书为准。",
		Doses: []templateDose{
			{DoseNumber: 1, AgeMonths: 2, AgeLabel: "2月龄", DoseTip: "最早 6 周龄起种，不同品牌基础排期可能为 2/4/6 或 3/4/5 月龄。"},
			{DoseNumber: 2, AgeMonths: 4, AgeLabel: "4月龄", DoseTip: "与前剂间隔 4–8 周。"},
			{DoseNumber: 3, AgeMonths: 6, AgeLabel: "6月龄", DoseTip: "建议 12 月龄前完成基础 3 剂。"},
			{DoseNumber: 4, AgeMonths: 12, AgeLabel: "12月龄", DoseTip: "12–15 月龄加强，与第 3 剂间隔 ≥2 个月。"},
		},
	},
	{
		Code:      "rv5",
		Name:      "口服五价轮状病毒疫苗",
		ShortName: "五价轮状",
		Category:  CategoryOptional,
		Prevents:  "轮状病毒性重症腹泻",
		Route:     "口服",
		PrecautionsBefore: []string{
			"严守周龄窗口：第 1 剂须在 6–12 周龄口服，全部 3 剂须在 32 周龄前完成。",
			"口服前后 30 分钟内避免喂奶、喂水或进食。",
		},
		PrecautionsAfter: []string{
			"现场留观 30 分钟；当场吐出通常不补服，遵医嘱。",
			"回家若出现阵发性剧烈哭闹、呕吐或果酱样便，立即就医排查肠套叠。",
		},
		RiskWarning: "首剂超 12 周龄或末剂超 32 周龄均不可补种；有肠套叠病史或严重联合免疫缺陷（SCID）婴儿严禁接种。",
		Doses: []templateDose{
			{DoseNumber: 1, AgeMonths: 2, AgeLabel: "2月龄", DoseTip: "首剂须在 6–12 周龄（42–84 天）完成，超龄不可接种。"},
			{DoseNumber: 2, AgeMonths: 3, AgeLabel: "3月龄", DoseTip: "与第 1 剂间隔 4–10 周。"},
			{DoseNumber: 3, AgeMonths: 4, AgeLabel: "4月龄", DoseTip: "与第 2 剂间隔 4–10 周，务必满 32 周龄前完成。"},
		},
	},
	{
		Code:              "ev71",
		Name:              "EV71 手足口病疫苗",
		ShortName:         "EV71手足口",
		Category:          CategoryOptional,
		Prevents:          "EV71 型重症手足口病",
		Route:             "肌内注射",
		PrecautionsBefore: commonPrecautionsBefore,
		PrecautionsAfter:  commonPrecautionsAfter,
		RiskWarning:       "仅防 EV71 型病毒，不防柯萨奇 A16 等其他肠道病毒；不同厂家年龄上限略异（47 或 71 月龄）。",
		Doses: []templateDose{
			{DoseNumber: 1, AgeMonths: 6, AgeLabel: "6月龄", DoseTip: "满 6 月龄即可接种。"},
			{DoseNumber: 2, AgeMonths: 7, AgeLabel: "7月龄", DoseTip: "与第 1 剂间隔 ≥1 个月，建议 12 月龄前完成。"},
		},
	},
	{
		Code:              "varicella",
		Name:              "水痘减毒活疫苗",
		ShortName:         "水痘",
		Category:          CategoryOptional,
		Prevents:          "水痘",
		Route:             "皮下注射",
		PrecautionsBefore: commonPrecautionsBefore,
		PrecautionsAfter:  commonPrecautionsAfter,
		RiskWarning:       "部分城市已纳入地方免费；属减毒活疫苗，未与其他注射类减毒活疫苗同天接种须间隔 ≥28 天。",
		Doses: []templateDose{
			{DoseNumber: 1, AgeMonths: 12, AgeLabel: "12月龄", DoseTip: "满 1 周岁接种第 1 剂。"},
			{DoseNumber: 2, AgeMonths: 48, AgeLabel: "4周岁", DoseTip: "4–6 周岁入园前加强（两剂间隔 ≥3 个月）。"},
		},
	},
	{
		Code:              "flu",
		Name:              "儿童流感疫苗",
		ShortName:         "流感",
		Category:          CategoryOptional,
		Prevents:          "季节性甲型、乙型流感",
		Route:             "肌内注射",
		PrecautionsBefore: commonPrecautionsBefore,
		PrecautionsAfter:  commonPrecautionsAfter,
		RiskWarning:       "按当年秋冬到苗时间（常为 9–10 月）手动调整预计日期；往季打过则当季通常仅需 1 剂。",
		Doses: []templateDose{
			{DoseNumber: 1, AgeMonths: 6, AgeLabel: "6月龄起", DoseTip: "请按当年秋冬门诊到苗时间调整日期。"},
			{DoseNumber: 2, AgeMonths: 7, AgeLabel: "首季第2剂", DoseTip: "首季接种与第 1 剂间隔 ≥4 周；往季已种可删除此剂。"},
		},
	},
}

// catalogByCode 通过包初始化阶段立即执行的匿名函数构造只读查询索引，
// 使模板按编码查找保持 O(1) 且只在进程启动时构建一次。
var catalogByCode = func() map[string]vaccineTemplate {
	m := make(map[string]vaccineTemplate, len(builtInCatalog))
	for _, tpl := range builtInCatalog {
		m[tpl.Code] = tpl
	}
	return m
}()

// nipTemplates 返回全部国家免疫规划疫苗模板副本。
func nipTemplates() []vaccineTemplate {
	var out []vaccineTemplate
	for _, tpl := range builtInCatalog {
		if tpl.Category == CategoryNIP {
			out = append(out, tpl)
		}
	}
	return out
}

// optionalTemplates 返回全部内置自费疫苗模板副本。
func optionalTemplates() []vaccineTemplate {
	var out []vaccineTemplate
	for _, tpl := range builtInCatalog {
		if tpl.Category == CategoryOptional {
			out = append(out, tpl)
		}
	}
	return out
}

func lookupTemplate(code string) (vaccineTemplate, bool) {
	tpl, ok := catalogByCode[code]
	return tpl, ok
}
