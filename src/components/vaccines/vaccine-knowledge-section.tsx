import { ChevronDown, Info, ShieldAlert } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { VaccineDose } from '@/lib/vaccines';

interface VaccineKnowledgeSectionProps {
  readonly dose: VaccineDose;
}

/** 疫苗详情抽屉的精简科普与风险区：默认只展示核心预防疾病与风险提示，前后注意事项折叠按需展开。 */
export function VaccineKnowledgeSection({ dose }: VaccineKnowledgeSectionProps) {
  const hasPrecautions = dose.precautions_before.length > 0 || dose.precautions_after.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Info className="size-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">参考说明</h3>
        <Badge variant={dose.category === 'nip' ? 'secondary' : 'health'}>
          {dose.category === 'nip' ? '免费' : '自费'}
        </Badge>
      </div>

      {dose.prevents || dose.dose_tip ? (
        <div className="space-y-1 rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          {dose.prevents ? (
            <p>
              <strong className="text-foreground">预防：</strong>
              {dose.prevents}
            </p>
          ) : null}
          {dose.dose_tip ? <p>{dose.dose_tip}</p> : null}
        </div>
      ) : null}

      <Alert variant="warning" size="compact" role="note">
        <ShieldAlert aria-hidden="true" />
        <span>{dose.risk_warning}</span>
      </Alert>

      {hasPrecautions ? (
        <Collapsible className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-xs">
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg py-0.5 text-left font-medium text-foreground">
            <span>接种前后注意事项（留观 30 分钟等）</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-panel-open/collapsible-trigger:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2.5 space-y-2.5 border-t border-border/60 pt-2.5 text-muted-foreground">
              {dose.precautions_before.length > 0 ? (
                <div className="space-y-1">
                  <p className="font-medium text-foreground">接种前</p>
                  <ul className="list-disc space-y-1 pl-4 leading-relaxed">
                    {dose.precautions_before.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {dose.precautions_after.length > 0 ? (
                <div className="space-y-1">
                  <p className="font-medium text-foreground">接种后</p>
                  <ul className="list-disc space-y-1 pl-4 leading-relaxed">
                    {dose.precautions_after.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <p className="text-xs text-muted-foreground">仅供参考，请以疫苗说明书及接种医生医嘱为准。</p>
    </div>
  );
}
