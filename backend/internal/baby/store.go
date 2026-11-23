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

// GetFirst 返回当前唯一的宝宝档案；尚未建档时返回 (nil, nil)。
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

// Create 在单宝宝模式下创建唯一宝宝档案；若已存在则返回 ErrAlreadyExists。
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
		created = Profile{
			Nickname:      clean.Nickname,
			BirthDate:     clean.BirthDate,
			Gender:        clean.Gender,
			BirthWeightKg: clean.BirthWeightKg,
			BirthHeightCm: clean.BirthHeightCm,
			CreatedAt:     ts,
			UpdatedAt:     ts,
		}
		return tx.Create(&created).Error
	})
	if txErr != nil {
		return nil, txErr
	}
	return &created, nil
}

// Update 更新现有唯一宝宝档案；尚未建档时返回 ErrNotFound。
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
		updated.UpdatedAt = timeutil.FormatUTC(now)

		return tx.Model(&updated).Select(
			"nickname", "birth_date", "gender", "birth_weight_kg", "birth_height_cm", "updated_at",
		).Updates(&updated).Error
	})
	if txErr != nil {
		return nil, txErr
	}
	return &updated, nil
}
