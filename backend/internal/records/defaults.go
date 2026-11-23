package records

import (
	"context"
	"sort"
)

// GetSmartDefaults 根据最近历史记录汇总智能默认值，为空历史提供开箱即用的兜底预设。
// 仅回溯最近 60 条喂养（约 1 周）与 40 条健康记录，确保默认值紧贴宝宝当前月龄习惯而非早期历史。
func (s *Store) GetSmartDefaults(ctx context.Context, babyID int64) (*SmartDefaults, error) {
	defaults := &SmartDefaults{
		Feeding: FeedingDefaults{
			LastMilkML:          DefaultStarterMilk,
			FrequentMilkML:      []int{60, 90, 120},
			LastFeedingSubtype:  FeedingSubtypeFormula,
			SuggestedBreastSide: "left",
			RecentSolidFoods:    []string{},
		},
		Health: HealthDefaults{
			LastTemperatureC: DefaultStarterTemp,
			RecentMedicines:  []MedicinePreset{},
		},
		Care: CareDefaults{
			RecentOtherTitles: []string{},
		},
	}

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

	type mlStat struct {
		ml         int
		count      int
		firstIndex int
	}
	mlCounts := make(map[int]*mlStat)
	hasLastMilk := false
	hasLastBreast := false
	solidSeen := make(map[string]struct{})

	for idx, f := range feedings {
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
		if f.Subtype == FeedingSubtypeSolid && f.SolidFood != nil && len(defaults.Feeding.RecentSolidFoods) < 5 {
			food := *f.SolidFood
			if _, exists := solidSeen[food]; !exists {
				solidSeen[food] = struct{}{}
				defaults.Feeding.RecentSolidFoods = append(defaults.Feeding.RecentSolidFoods, food)
			}
		}
	}

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
