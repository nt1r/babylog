import { Pin, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { QuickChip } from '@/components/ui/choice-controls';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { buildClinicSuggestions } from '@/lib/vaccines';

interface ClinicInputFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly defaultClinicName: string;
  readonly recentClinics: readonly string[];
  readonly autoFilled?: boolean;
  readonly pinAsDefault?: boolean;
  readonly onPinAsDefaultChange?: (checked: boolean) => void;
  readonly onChange: (value: string) => void;
}

/**
 * 复用的接种地点输入框：
 * 支持常去门诊自动回填提示、一键清空、去重后的默认/历史门诊胶囊点选，
 * 以及输入新社区门诊时顺手勾选「设为常去门诊」。
 */
export function ClinicInputField({
  id,
  label,
  value,
  defaultClinicName,
  recentClinics,
  autoFilled = false,
  pinAsDefault = false,
  onPinAsDefaultChange,
  onChange,
}: ClinicInputFieldProps) {
  const suggestions = buildClinicSuggestions(defaultClinicName, recentClinics);
  const trimmedValue = value.trim();
  const trimmedDefault = defaultClinicName.trim();
  const showPinToggle = Boolean(onPinAsDefaultChange && trimmedValue && trimmedValue !== trimmedDefault);
  const pinCheckboxId = `${id}-pin-default`;

  return (
    <Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {autoFilled && trimmedValue ? (
          <span className="text-xs text-primary">
            {trimmedValue === trimmedDefault ? '已自动填入常去门诊' : '已自动填入最近门诊'}
          </span>
        ) : null}
      </div>

      <div className="relative">
        <Input
          id={id}
          value={value}
          maxLength={80}
          placeholder="如 XX 街道社区卫生服务中心"
          className={value ? 'pr-9' : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        {value ? (
          <button
            type="button"
            aria-label="清空接种地点"
            onClick={() => onChange('')}
            className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {suggestions.map((clinic) => {
            const isDefault = Boolean(trimmedDefault && clinic === trimmedDefault);
            return (
              <QuickChip
                key={clinic}
                variant="outline"
                active={value === clinic}
                onClick={() => onChange(clinic)}
                className="gap-1"
              >
                {isDefault ? <Pin className="size-3 shrink-0 text-primary" /> : null}
                <span>{clinic}</span>
                {isDefault ? <span className="text-muted-foreground">· 默认</span> : null}
              </QuickChip>
            );
          })}
        </div>
      ) : null}

      {showPinToggle ? (
        <label
          htmlFor={pinCheckboxId}
          className="inline-flex cursor-pointer items-center gap-2 pt-1 text-xs text-muted-foreground select-none hover:text-foreground"
        >
          <Checkbox
            id={pinCheckboxId}
            checked={pinAsDefault}
            onCheckedChange={(checked) => onPinAsDefaultChange?.(checked)}
          />
          <span>同时设为常去门诊（下次自动带出）</span>
        </label>
      ) : null}
    </Field>
  );
}
