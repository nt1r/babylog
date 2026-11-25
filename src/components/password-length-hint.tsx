import { CheckCircle2 } from 'lucide-react';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/auth';

interface PasswordLengthHintProps {
  readonly value: string;
}

/** 新密码输入时的轻量实时长度反馈，减少用户输完提交后才发现不足 12 位的试错感。 */
export function PasswordLengthHint({ value }: PasswordLengthHintProps) {
  if (!value) return null;
  const len = Array.from(value).length;
  if (len > PASSWORD_MAX_LENGTH) {
    return <p className="text-xs text-destructive tabular-nums">密码不能超过 {PASSWORD_MAX_LENGTH} 位</p>;
  }
  if (len < PASSWORD_MIN_LENGTH) {
    return (
      <p className="text-xs text-muted-foreground tabular-nums">
        已输入 {len} 位，还差 {PASSWORD_MIN_LENGTH - len} 位
      </p>
    );
  }
  return (
    <p className="inline-flex items-center gap-1 text-xs text-primary tabular-nums">
      <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
      <span>密码长度符合要求（{len} 位）</span>
    </p>
  );
}
