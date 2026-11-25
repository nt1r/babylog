package baby

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	"github.com/nt1r/babylog/backend/internal/timeutil"
)

// Store 封装宝宝档案在 SQLite 中的读写操作。
type Store struct {
	db  *gorm.DB
	now func() time.Time
}

// NewStore 创建基于 GORM 的宝宝档案存储实例。
func NewStore(db *gorm.DB) *Store {
	return &Store{
		db:  db,
		now: time.Now,
	}
}

// WithClock 替换内部时钟函数（用于确定性测试，避免受宿主机系统日期影响）。
func (s *Store) WithClock(fn func() time.Time) *Store {
	if fn != nil {
		s.now = fn
	}
	return s
}

// GetFirst 返回当前唯一的宝宝档案；尚未建档时返回 (nil, nil)，供调用方区分“未建档”与数据库异常。
func (s *Store) GetFirst(ctx context.Context) (*Profile, error) {
	var p Profile
	err := s.db.WithContext(ctx).Order("id ASC").First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// Create 在单宝宝模式下创建唯一宝宝档案；在事务内检查唯一性，若已存在则返回 [ErrAlreadyExists]。
func (s *Store) Create(ctx context.Context, in UpsertInput, loc *time.Location) (*Profile, error) {
	now := s.now()
	clean, err := ValidateAndNormalize(in, now, loc)
	if err != nil {
		return nil, err
	}

	var created Profile
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&Profile{}).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrAlreadyExists
		}

		ts := timeutil.FormatUTC(now)
		defaultClinic := ""
		if clean.DefaultClinicName != nil {
			defaultClinic = *clean.DefaultClinicName
		}
		created = Profile{
			Nickname:          clean.Nickname,
			BirthDate:         clean.BirthDate,
			Gender:            clean.Gender,
			BirthWeightKg:     clean.BirthWeightKg,
			BirthHeightCm:     clean.BirthHeightCm,
			DefaultClinicName: defaultClinic,
			CreatedAt:         ts,
			UpdatedAt:         ts,
		}
		return tx.Create(&created).Error
	})
	if txErr != nil {
		return nil, txErr
	}
	return &created, nil
}

// Update 在单个事务内更新现有唯一宝宝档案；尚未建档时返回 [ErrNotFound]。
func (s *Store) Update(ctx context.Context, in UpsertInput, loc *time.Location) (*Profile, error) {
	now := s.now()
	clean, err := ValidateAndNormalize(in, now, loc)
	if err != nil {
		return nil, err
	}

	var updated Profile
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Order("id ASC").First(&updated).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}

		updated.Nickname = clean.Nickname
		updated.BirthDate = clean.BirthDate
		updated.Gender = clean.Gender
		updated.BirthWeightKg = clean.BirthWeightKg
		updated.BirthHeightCm = clean.BirthHeightCm
		// 遵循 UpsertInput.DefaultClinicName 的 *string 三态约定：仅非 nil 时覆写（"" 表示显式清空），nil 保留既有值。
		if clean.DefaultClinicName != nil {
			updated.DefaultClinicName = *clean.DefaultClinicName
		}
		updated.UpdatedAt = timeutil.FormatUTC(now)

		// GORM 默认的 Updates(&struct) 会跳过 nil 指针与零值字段；
		// 显式调用 Select 指定全部可更新列，保证家长清空出生体重/身高或常去门诊时能正确落库。
		return tx.Model(&updated).Select(
			"nickname", "birth_date", "gender", "birth_weight_kg", "birth_height_cm", "default_clinic_name", "updated_at",
		).Updates(&updated).Error
	})
	if txErr != nil {
		return nil, txErr
	}
	return &updated, nil
}

// UpdateDefaultClinic 单独设置或清空指定宝宝的常去接种门诊名称（允许传空串清空）；
// 校验失败返回 [*ValidationError]，目标宝宝不存在返回 [ErrNotFound]。
func (s *Store) UpdateDefaultClinic(ctx context.Context, babyID int64, rawClinicName string) (string, error) {
	clinicName, err := ValidateClinicName(rawClinicName)
	if err != nil {
		return "", err
	}

	nowStr := timeutil.FormatUTC(s.now())
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 使用 map[string]any 而非结构体更新，可绕过 GORM 忽略空串零值的默认行为，并省去先查后改。
		res := tx.Model(&Profile{}).
			Where("id = ?", babyID).
			Updates(map[string]any{
				"default_clinic_name": clinicName,
				"updated_at":          nowStr,
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return ErrNotFound
		}
		return nil
	})
	if txErr != nil {
		return "", txErr
	}
	return clinicName, nil
}
