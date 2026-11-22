import type { ReactNode } from 'react';
import { Card, CardAction, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface ListPageCardProps {
  readonly title: string;
  readonly description?: string;
  readonly badge?: ReactNode;
  readonly headerAction?: ReactNode;
  readonly filters?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * 通用记录列表页卡片框架：包含页面主标题（h1）、筛选栏、操作区与内容主体。
 */
export function ListPageCard({
  title,
  description,
  badge,
  headerAction,
  filters,
  actions,
  className,
  children,
}: ListPageCardProps) {
  return (
    <Card className={cn('gap-4', className)}>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center gap-2.5">
          {badge}
          <h1 className="text-lg leading-snug font-semibold">{title}</h1>
        </div>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {headerAction ? <CardAction>{headerAction}</CardAction> : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {filters || actions ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">{filters}</div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}

        {children}
      </CardContent>
    </Card>
  );
}
