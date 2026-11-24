import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

interface ClinicInputFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly recentClinics: readonly string[];
  readonly onChange: (value: string) => void;
}

/** 复用的接种地点输入框：附带最近常用社区医院一键点选胶囊，减少重复录入。 */
export function ClinicInputField({ id, label, value, recentClinics, onChange }: ClinicInputFieldProps) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        maxLength={80}
        placeholder="如 XX 街道社区卫生服务中心"
        onChange={(e) => onChange(e.target.value)}
      />
      {recentClinics.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {recentClinics.map((clinic) => (
            <button
              key={clinic}
              type="button"
              onClick={() => onChange(clinic)}
              className="cursor-pointer rounded-full border border-border/80 bg-secondary/70 px-2.5 py-0.5 text-xs text-secondary-foreground transition-colors hover:border-primary/50"
            >
              {clinic}
            </button>
          ))}
        </div>
      ) : null}
    </Field>
  );
}
