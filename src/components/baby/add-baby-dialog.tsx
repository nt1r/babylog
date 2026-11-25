import { format } from 'date-fns';
import { AlertCircle, Baby, ChevronDown, ChevronUp } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { QuickChip } from '@/components/ui/choice-controls';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import {
  BABY_GENDER_LABELS,
  type BabyFormValidationErrors,
  type BabyGender,
  type BabyProfile,
  MAX_BABIES_PER_USER,
  useCreateBabyMutation,
  validateBabyProfileForm,
} from '@/lib/baby';

interface AddBabyDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly currentCount: number;
  readonly onCreated?: (baby: BabyProfile) => void;
}

const GENDER_OPTIONS: ReadonlyArray<BabyGender> = ['male', 'female', 'unknown'];

/** 新增宝宝档案弹窗，供全局宝宝切换器与设置页复用；提交中锁定关闭防误触。 */
export function AddBabyDialog({ open, onOpenChange, currentCount, onCreated }: AddBabyDialogProps) {
  const createBaby = useCreateBabyMutation();
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const [nickname, setNickname] = useState('');
  const [birthDate, setBirthDate] = useState(todayStr);
  const [gender, setGender] = useState<BabyGender>('unknown');
  const [showOptional, setShowOptional] = useState(false);
  const [birthWeight, setBirthWeight] = useState('');
  const [birthHeight, setBirthHeight] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<BabyFormValidationErrors>({});

  useEffect(() => {
    if (!open) return;
    setNickname('');
    setBirthDate(format(new Date(), 'yyyy-MM-dd'));
    setGender('unknown');
    setShowOptional(false);
    setBirthWeight('');
    setBirthHeight('');
    setSubmitError('');
    setFieldErrors({});
  }, [open]);

  const atLimit = currentCount >= MAX_BABIES_PER_USER;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createBaby.isPending || atLimit) return;

    const { payload, errors } = validateBabyProfileForm({
      nickname,
      birthDate,
      gender,
      birthWeight,
      birthHeight,
      todayStr,
    });
    if (!payload) {
      if (errors.birthWeight || errors.birthHeight) {
        setShowOptional(true);
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitError('');
    setFieldErrors({});
    try {
      const created = await createBaby.mutateAsync(payload);
      toast.success(`已添加 ${created.nickname}`, '已自动切换至新宝宝档案。');
      onOpenChange(false);
      onCreated?.(created);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : '添加宝宝失败，请稍后重试。');
    }
  }

  return (
    <Dialog open={open} pending={createBaby.isPending} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <Baby className="size-4.5" strokeWidth={1.8} />
            </span>
            <div>
              <DialogTitle>添加宝宝档案</DialogTitle>
              <DialogDescription>
                当前已创建 {currentCount} / {MAX_BABIES_PER_USER} 个宝宝档案
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {atLimit ? (
          <Alert variant="destructive">
            <AlertCircle className="size-4" aria-hidden="true" />
            <AlertTitle>每个账号最多创建 {MAX_BABIES_PER_USER} 个宝宝档案</AlertTitle>
          </Alert>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <FieldGroup className="gap-3.5">
              <Field invalid={Boolean(fieldErrors.nickname)}>
                <FieldLabel htmlFor="add-baby-nickname">宝宝昵称 / 小名</FieldLabel>
                <Input
                  id="add-baby-nickname"
                  value={nickname}
                  maxLength={32}
                  disabled={createBaby.isPending}
                  placeholder="例如：小汤圆、二宝"
                  aria-invalid={Boolean(fieldErrors.nickname)}
                  onChange={(event) => {
                    setNickname(event.target.value);
                    if (fieldErrors.nickname) setFieldErrors((prev) => ({ ...prev, nickname: undefined }));
                  }}
                />
                <FieldError>{fieldErrors.nickname}</FieldError>
              </Field>

              <Field invalid={Boolean(fieldErrors.birthDate)}>
                <FieldLabel htmlFor="add-baby-birth-date">出生日期</FieldLabel>
                <DatePicker
                  id="add-baby-birth-date"
                  captionLayout="dropdown"
                  max={todayStr}
                  value={birthDate}
                  disabled={createBaby.isPending}
                  invalid={Boolean(fieldErrors.birthDate)}
                  ariaLabel="出生日期"
                  drawerTitle="宝宝出生日期"
                  onChange={(nextDate) => {
                    setBirthDate(nextDate);
                    if (fieldErrors.birthDate) setFieldErrors((prev) => ({ ...prev, birthDate: undefined }));
                  }}
                />
                <FieldError>{fieldErrors.birthDate}</FieldError>
              </Field>

              <div className="space-y-2">
                <p className="text-[13px] font-medium text-foreground">性别</p>
                <div className="flex flex-wrap gap-2">
                  {GENDER_OPTIONS.map((g) => (
                    <QuickChip
                      key={g}
                      variant="outline"
                      active={gender === g}
                      disabled={createBaby.isPending}
                      onClick={() => setGender(g)}
                      className="h-9 px-3.5 text-sm"
                    >
                      {BABY_GENDER_LABELS[g]}
                    </QuickChip>
                  ))}
                </div>
              </div>

              <div>
                <button
                  type="button"
                  disabled={createBaby.isPending}
                  onClick={() => setShowOptional((v) => !v)}
                  className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                  {showOptional ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  补充出生体重与身高（可选）
                </button>

                {showOptional ? (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Field invalid={Boolean(fieldErrors.birthWeight)}>
                      <FieldLabel htmlFor="add-baby-weight">出生体重（kg）</FieldLabel>
                      <Input
                        id="add-baby-weight"
                        type="number"
                        step="0.01"
                        min="0.3"
                        max="15"
                        inputMode="decimal"
                        placeholder="如 3.35"
                        disabled={createBaby.isPending}
                        className="tabular-nums"
                        aria-invalid={Boolean(fieldErrors.birthWeight)}
                        value={birthWeight}
                        onChange={(event) => {
                          setBirthWeight(event.target.value);
                          if (fieldErrors.birthWeight) {
                            setFieldErrors((prev) => ({ ...prev, birthWeight: undefined }));
                          }
                        }}
                      />
                      <FieldError>{fieldErrors.birthWeight}</FieldError>
                    </Field>
                    <Field invalid={Boolean(fieldErrors.birthHeight)}>
                      <FieldLabel htmlFor="add-baby-height">出生身高（cm）</FieldLabel>
                      <Input
                        id="add-baby-height"
                        type="number"
                        step="0.1"
                        min="20"
                        max="100"
                        inputMode="decimal"
                        placeholder="如 50.0"
                        disabled={createBaby.isPending}
                        className="tabular-nums"
                        aria-invalid={Boolean(fieldErrors.birthHeight)}
                        value={birthHeight}
                        onChange={(event) => {
                          setBirthHeight(event.target.value);
                          if (fieldErrors.birthHeight) {
                            setFieldErrors((prev) => ({ ...prev, birthHeight: undefined }));
                          }
                        }}
                      />
                      <FieldError>{fieldErrors.birthHeight}</FieldError>
                    </Field>
                  </div>
                ) : null}
              </div>
            </FieldGroup>

            {submitError ? (
              <Alert variant="destructive">
                <AlertCircle className="size-4" aria-hidden="true" />
                <AlertTitle>{submitError}</AlertTitle>
              </Alert>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                disabled={createBaby.isPending}
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={createBaby.isPending}>
                {createBaby.isPending ? <Spinner className="size-4" aria-hidden="true" role="presentation" /> : null}
                {createBaby.isPending ? '正在创建…' : '确认添加'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
