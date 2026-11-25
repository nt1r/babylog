package baby

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	"github.com/nt1r/babylog/backend/internal/timeutil"
)

// Store 封装按用户归属隔离的宝宝档案读写与硬删除操作。
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

// ListByUser 按创建顺序（id ASC）返回指定用户归属的全部宝宝档案；无档案时返回空切片而非 nil。
func (s *Store) ListByUser(ctx context.Context, userID int64) ([]Profile, error) {
	profiles := make([]Profile, 0)
	if userID <= 0 {
		return profiles, nil
	}
	if err := s.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("id ASC").
		Find(&profiles).Error; err != nil {
		return nil, err
	}
	return profiles, nil
}

// GetByIDForUser 按主键与归属用户双条件读取宝宝档案；不存在或属于他人时统一返回 (nil, nil)。
func (s *Store) GetByIDForUser(ctx context.Context, userID, babyID int64) (*Profile, error) {
	if userID <= 0 || babyID <= 0 {
		return nil, nil
	}
	var p Profile
	err := s.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", babyID, userID).
		Take(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// CreateForUser 为指定用户创建新的宝宝档案；单用户最多创建 10 个档案，超限时返回 [*ValidationError]。
func (s *Store) CreateForUser(ctx context.Context, userID int64, in UpsertInput, loc *time.Location) (*Profile, error) {
	if userID <= 0 {
		return nil, ErrNotFound
	}
	now := s.now()
	clean, err := ValidateAndNormalize(in, now, loc)
	if err != nil {
		return nil, err
	}

	var created Profile
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&Profile{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
			return err
		}
		if count >= maxBabiesPerUser {
			return &ValidationError{Message: "每个账号最多可创建 10 个宝宝档案"}
		}

		ts := timeutil.FormatUTC(now)
		defaultClinic := ""
		if clean.DefaultClinicName != nil {
			defaultClinic = *clean.DefaultClinicName
		}
		created = Profile{
			UserID:            userID,
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

// UpdateForUser 在单事务内按 id + user_id 双条件更新归属宝宝档案；不存在或属于他人返回 [ErrNotFound]。
func (s *Store) UpdateForUser(ctx context.Context, userID, babyID int64, in UpsertInput, loc *time.Location) (*Profile, error) {
	if userID <= 0 || babyID <= 0 {
		return nil, ErrNotFound
	}
	now := s.now()
	clean, err := ValidateAndNormalize(in, now, loc)
	if err != nil {
		return nil, err
	}

	var updated Profile
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND user_id = ?", babyID, userID).Take(&updated).Error; err != nil {
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
		if clean.DefaultClinicName != nil {
			updated.DefaultClinicName = *clean.DefaultClinicName
		}
		updated.UpdatedAt = timeutil.FormatUTC(now)

		return tx.Model(&updated).Select(
			"nickname", "birth_date", "gender", "birth_weight_kg", "birth_height_cm", "default_clinic_name", "updated_at",
		).Updates(&updated).Error
	})
	if txErr != nil {
		return nil, txErr
	}
	return &updated, nil
}

// DeleteForUser 硬删除归属指定用户的宝宝档案（经 SQLite ON DELETE CASCADE 级联清理 5 张子表）；
// 目标不存在或不属于当前用户时返回 [ErrNotFound]。
func (s *Store) DeleteForUser(ctx context.Context, userID, babyID int64) error {
	if userID <= 0 || babyID <= 0 {
		return ErrNotFound
	}
	res := s.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", babyID, userID).
		Delete(&Profile{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateDefaultClinic 单独设置或清空指定用户归属宝宝的常去接种门诊名称（允许传空串清空）；
// 校验失败返回 [*ValidationError]，目标不存在或归属不匹配返回 [ErrNotFound]。
func (s *Store) UpdateDefaultClinic(ctx context.Context, userID, babyID int64, rawClinicName string) (string, error) {
	if userID <= 0 || babyID <= 0 {
		return "", ErrNotFound
	}
	clinicName, err := ValidateClinicName(rawClinicName)
	if err != nil {
		return "", err
	}

	nowStr := timeutil.FormatUTC(s.now())
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&Profile{}).
			Where("id = ? AND user_id = ?", babyID, userID).
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

// SyncDefaultClinicTx 在调用方既有 SQLite 事务内原子同步宝宝的常去接种门诊名称：
// 内部经 [ValidateClinicName] 完成裁剪与长度校验，空串直接跳过；
// 显式置顶（explicitPin）时直接覆写；否则仅在允许自动记忆（如非产院常规社区剂次）且档案尚无默认门诊时补写。
func SyncDefaultClinicTx(tx *gorm.DB, babyID int64, clinicName string, explicitPin bool, allowAutoRemember bool, nowStr string) error {
	normClinic, err := ValidateClinicName(clinicName)
	if err != nil {
		return err
	}
	if normClinic == "" {
		return nil
	}
	if explicitPin {
		return tx.Model(&Profile{}).
			Where("id = ?", babyID).
			Updates(map[string]any{
				"default_clinic_name": normClinic,
				"updated_at":          nowStr,
			}).Error
	}
	if !allowAutoRemember {
		return nil
	}
	return tx.Model(&Profile{}).
		Where("id = ? AND default_clinic_name = ''", babyID).
		Updates(map[string]any{
			"default_clinic_name": normClinic,
			"updated_at":          nowStr,
		}).Error
}
