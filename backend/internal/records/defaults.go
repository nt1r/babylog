package records

import (
	"context"
	"sort"
)

// GetSmartDefaults 根据最近历史记录汇总智能默认值，为空历史提供开箱即用的兜底预设。
//
// 仅回溯最近 60 条喂养（约 1 周）、20 条睡眠、40 条体温/用药与 30 条自定义护理记录，
// 确保默认值紧贴宝宝当前月龄习惯，不被早期陈旧数据稀释。
func (s *Store) GetSmartDefaults(ctx context.Context, babyID int64) (*SmartDefaults, error) {
	// 1. 初始化冷启动兜底默认值。
	defaults := &SmartDefaults{
		Feeding: FeedingDefaults{
			LastMilkML:            DefaultStarterMilk,
			FrequentMilkML:        []int{60, 90, 120},
			LastFeedingSubtype:    FeedingSubtypeFormula,
			LastMilkSubtype:       FeedingSubtypeFormula,
			LastBreastMode:        "direct",
			LastBreastDurationMin: DefaultStarterBreastMin,
			SuggestedBreastSide:   "left",
			RecentSolids:          []SolidFoodPreset{},
		},
		Sleep: SleepDefaults{
			SuggestedNapMin:   DefaultStarterNapMin,
			SuggestedNightMin: DefaultStarterNightMin,
		},
		Health: HealthDefaults{
			LastTemperatureC: DefaultStarterTemp,
			RecentMedicines:  []MedicinePreset{},
		},
		Care: CareDefaults{
			RecentOtherTitles: []string{},
		},
	}

	// 2. 回溯最近 60 条喂养记录（按时间倒序），单次遍历同步提取最近奶量、高频奶量、母乳方式/时长、亲喂建议侧别与最近辅食。
	var feedings []FeedingRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ?", babyID).
		Order("recorded_at DESC, id DESC").
		Limit(60).
		Find(&feedings).Error; err != nil {
		return nil, err
	}

	if len(feedings) > 0 {
		defaults.Feeding.LastFeedingSubtype = feedings[0].Subtype
	}

	// mlStat 记录每个奶量档位的出现次数与最早出现的倒序下标（firstIndex 越小表示越近期，用于同频次破平局）。
	type mlStat struct {
		ml         int
		count      int
		firstIndex int
	}
	mlCounts := make(map[int]*mlStat)
	hasLastMilk := false
	hasLastMilkSubtype := false
	hasLastBreastMode := false
	hasLastBreast := false
	hasLastBreastDur := false
	solidSeen := make(map[string]struct{})

	for idx, f := range feedings {
		// 记录最近一次奶类喂养类型（忽略辅食），避免纯亲喂/瓶喂母乳宝宝记一顿辅食后首页直记卡回退为配方奶。
		if !hasLastMilkSubtype && (f.Subtype == FeedingSubtypeFormula || f.Subtype == FeedingSubtypeBreast) {
			defaults.Feeding.LastMilkSubtype = f.Subtype
			hasLastMilkSubtype = true
		}
		if f.AmountML != nil && *f.AmountML > 0 {
			ml := *f.AmountML
			if !hasLastMilk {
				defaults.Feeding.LastMilkML = ml
				hasLastMilk = true
			}
			if st, ok := mlCounts[ml]; ok {
				st.count++
			} else {
				mlCounts[ml] = &mlStat{ml: ml, count: 1, firstIndex: idx}
			}
		}
		if !hasLastBreastMode && f.Subtype == FeedingSubtypeBreast && f.FeedingMode != nil &&
			(*f.FeedingMode == "direct" || *f.FeedingMode == "bottle") {
			defaults.Feeding.LastBreastMode = *f.FeedingMode
			hasLastBreastMode = true
		}
		// 亲喂侧别推荐：命中最近一次亲喂后，自动建议交替使用另一侧（上次左侧→建议右侧，其余→建议左侧）。
		if !hasLastBreast && f.Subtype == FeedingSubtypeBreast && f.FeedingMode != nil && *f.FeedingMode == "direct" && f.BreastSide != nil {
			side := *f.BreastSide
			defaults.Feeding.LastBreastSide = &side
			switch side {
			case "left":
				defaults.Feeding.SuggestedBreastSide = "right"
			default:
				defaults.Feeding.SuggestedBreastSide = "left"
			}
			hasLastBreast = true
		}
		if !hasLastBreastDur && f.Subtype == FeedingSubtypeBreast && f.FeedingMode != nil && *f.FeedingMode == "direct" &&
			f.DurationMin != nil && *f.DurationMin > 0 {
			defaults.Feeding.LastBreastDurationMin = *f.DurationMin
			hasLastBreastDur = true
		}
		if f.Subtype == FeedingSubtypeSolid && f.SolidFood != nil && len(defaults.Feeding.RecentSolids) < 5 {
			food := *f.SolidFood
			if _, exists := solidSeen[food]; !exists {
				solidSeen[food] = struct{}{}
				amount := ""
				if f.SolidAmount != nil {
					amount = *f.SolidAmount
				}
				defaults.Feeding.RecentSolids = append(defaults.Feeding.RecentSolids, SolidFoodPreset{
					Food:   food,
					Amount: amount,
				})
			}
		}
	}

	// 3. 选出前 3 个最高频奶量（同频次按最近优先），不足 3 档时用默认档位 [60, 90, 120] 去重补齐。
	if len(mlCounts) > 0 {
		stats := make([]*mlStat, 0, len(mlCounts))
		for _, st := range mlCounts {
			stats = append(stats, st)
		}
		sort.Slice(stats, func(i, j int) bool {
			if stats[i].count != stats[j].count {
				return stats[i].count > stats[j].count
			}
			return stats[i].firstIndex < stats[j].firstIndex
		})
		top := make([]int, 0, 3)
		topSeen := make(map[int]struct{})
		for _, st := range stats {
			if len(top) >= 3 {
				break
			}
			top = append(top, st.ml)
			topSeen[st.ml] = struct{}{}
		}
		for _, fallback := range []int{60, 90, 120} {
			if len(top) >= 3 {
				break
			}
			if _, ok := topSeen[fallback]; !ok {
				top = append(top, fallback)
				topSeen[fallback] = struct{}{}
			}
		}
		// 高频前 3 档按升序展示给前端胶囊，符合用户从少到多的视觉直觉。
		sort.Ints(top)
		defaults.Feeding.FrequentMilkML = top
	}

	// 4. 回溯最近 20 条睡眠记录，分别提取最多 5 条小睡与夜觉的中位数时长（按 5 / 15 分钟步长对齐）。
	var sleeps []SleepRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ?", babyID).
		Order("ended_at DESC, id DESC").
		Limit(20).
		Find(&sleeps).Error; err != nil {
		return nil, err
	}
	napDurs := make([]int, 0, 5)
	nightDurs := make([]int, 0, 5)
	for _, sl := range sleeps {
		if sl.DurationMin <= 0 {
			continue
		}
		switch sl.Subtype {
		case SleepSubtypeNap:
			if len(napDurs) < 5 {
				napDurs = append(napDurs, sl.DurationMin)
			}
		case SleepSubtypeNight:
			if len(nightDurs) < 5 {
				nightDurs = append(nightDurs, sl.DurationMin)
			}
		}
	}
	if len(napDurs) > 0 {
		defaults.Sleep.SuggestedNapMin = medianRounded(napDurs, 5, 15, 240)
	}
	if len(nightDurs) > 0 {
		defaults.Sleep.SuggestedNightMin = medianRounded(nightDurs, 15, 120, 720)
	}

	// 5. 回溯最近 40 条体温与用药记录，提取最近一次体温与去重后的前 5 个常用药品（保留该药品最近一次剂量）。
	var healths []HealthRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ? AND subtype IN ?", babyID, []string{HealthSubtypeTemperature, HealthSubtypeMedicine}).
		Order("recorded_at DESC, id DESC").
		Limit(40).
		Find(&healths).Error; err != nil {
		return nil, err
	}

	hasTemp := false
	medSeen := make(map[string]struct{})
	for _, h := range healths {
		if !hasTemp && h.Subtype == HealthSubtypeTemperature && h.TemperatureC != nil {
			defaults.Health.LastTemperatureC = *h.TemperatureC
			hasTemp = true
		}
		if h.Subtype == HealthSubtypeMedicine && h.MedicineName != nil && len(defaults.Health.RecentMedicines) < 5 {
			name := *h.MedicineName
			if _, exists := medSeen[name]; !exists {
				medSeen[name] = struct{}{}
				dosage := ""
				if h.MedicineDosage != nil {
					dosage = *h.MedicineDosage
				}
				defaults.Health.RecentMedicines = append(defaults.Health.RecentMedicines, MedicinePreset{
					Name:   name,
					Dosage: dosage,
				})
			}
		}
	}

	// 6. 回溯最近 30 条自定义护理记录，去重提取前 5 个常用护理标题。
	var cares []CareRecord
	if err := s.db.WithContext(ctx).
		Where("baby_id = ? AND subtype = ?", babyID, CareSubtypeOther).
		Order("recorded_at DESC, id DESC").
		Limit(30).
		Find(&cares).Error; err != nil {
		return nil, err
	}
	careSeen := make(map[string]struct{})
	for _, c := range cares {
		if c.CareTitle != nil && len(defaults.Care.RecentOtherTitles) < 5 {
			title := *c.CareTitle
			if _, exists := careSeen[title]; !exists {
				careSeen[title] = struct{}{}
				defaults.Care.RecentOtherTitles = append(defaults.Care.RecentOtherTitles, title)
			}
		}
	}

	return defaults, nil
}

// medianRounded 计算时长样本的中位数并四舍五入到指定分钟步长，再钳位到 [minVal, maxVal]，
// 用中位数而非单次最近值可避免偶发短睡或长睡导致下一次默认倒推时长失真。
func medianRounded(durations []int, step, minVal, maxVal int) int {
	sorted := append([]int(nil), durations...)
	sort.Ints(sorted)
	mid := len(sorted) / 2
	med := sorted[mid]
	if len(sorted)%2 == 0 {
		med = (sorted[mid-1] + sorted[mid]) / 2
	}
	rounded := ((med + step/2) / step) * step
	if rounded < minVal {
		return minVal
	}
	if rounded > maxVal {
		return maxVal
	}
	return rounded
}
