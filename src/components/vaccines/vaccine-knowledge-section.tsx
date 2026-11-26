import { Badge } from '@/components/ui/badge';
import { InfoPopover } from '@/components/ui/info-popover';
import type { VaccineDose } from '@/lib/vaccines';

interface VaccineKnowledgeSectionProps {
  readonly dose: VaccineDose;
  readonly disabled?: boolean;
}

/**
 * 疫苗详情抽屉顶部的紧凑参考信息条：
 * 默认仅展示免费/自费标识与预防疾病一句话摘要，长段风险提示、本剂说明与接种前后注意事项收敛至点击式帮助浮层。
 */
export function VaccineKnowledgeSection({ dose, disabled = false }: VaccineKnowledgeSectionProps) {
  const hasPrecautions = dose.precautions_before.length > 0 || dose.precautions_after.length > 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/75 bg-muted/30 px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
        <Badge variant={dose.category === 'nip' ? 'secondary' : 'health'} className="shrink-0">
          {dose.category === 'nip' ? '免费' : '自费'}
        </Badge>
        <p className="line-clamp-2 min-w-0 leading-relaxed text-muted-foreground">
          {dose.prevents ? (
            <>
              <span className="font-medium text-foreground">预防：</span>
              {dose.prevents}
            </>
          ) : (
            '查看本剂接种提示与通用注意事项'
          )}
        </p>
      </div>

      <InfoPopover
        title={`${dose.vaccine_name} · 注意事项`}
        description={dose.prevents ? `预防：${dose.prevents}${dose.route ? `（${dose.route}）` : ''}` : undefined}
        label="注意事项"
        triggerVariant="pill"
        tone="warning"
        align="end"
        disabled={disabled}
        contentClassName="w-88"
      >
        <div className="space-y-3">
          {dose.dose_tip ? (
            <div className="space-y-1">
              <p className="font-medium text-foreground">本剂说明</p>
              <p>{dose.dose_tip}</p>
            </div>
          ) : null}

          {dose.risk_warning ? (
            <div className="space-y-1">
              <p className="font-medium text-foreground">风险与选型提示</p>
              <p className="rounded-xl border border-warning/25 bg-warning-soft/55 px-3 py-2 text-warning-soft-foreground">
                {dose.risk_warning}
              </p>
            </div>
          ) : null}

          {hasPrecautions ? (
            <div className="space-y-2.5 border-t border-border/60 pt-2.5">
              {dose.precautions_before.length > 0 ? (
                <div className="space-y-1">
                  <p className="font-medium text-foreground">接种前准备</p>
                  <ul className="list-disc space-y-1 pl-4">
                    {dose.precautions_before.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {dose.precautions_after.length > 0 ? (
                <div className="space-y-1">
                  <p className="font-medium text-foreground">接种后护理</p>
                  <ul className="list-disc space-y-1 pl-4">
                    {dose.precautions_after.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          <p className="border-t border-border/60 pt-2 text-xs text-muted-foreground">
            仅供参考，请以疫苗说明书及接种医生医嘱为准。
          </p>
        </div>
      </InfoPopover>
    </div>
  );
}
