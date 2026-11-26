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
 * 通用记录列表页卡片框架：
 * 桌面端展示完整标题与主操作按钮；移动端顶部栏已展示当前页标题且底部栏提供快捷录入，
 * 因此卡片头在移动端仅保留 sr-only 语义标题（并隐藏其中的可聚焦按钮），保证整页唯一 h1 且首屏直达列表。
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
    <Card className={cn('relative gap-4', className)}>
      {/* 仅在小于 md 视口应用 sr-only，避免 md:not-sr-only 的 padding:0 覆盖 CardHeader 默认内边距 */}
      <CardHeader className={cn('max-md:sr-only md:border-b md:pb-(--card-spacing)', !description && 'items-center')}>
        <div className="flex flex-wrap items-center gap-2.5">
          {badge ? <span className="hidden md:inline-flex">{badge}</span> : null}
          <h1 className="text-lg leading-snug font-semibold">{title}</h1>
        </div>
        {description ? <CardDescription className="hidden md:block">{description}</CardDescription> : null}
        {headerAction ? (
          <CardAction className={cn('hidden md:block', !description && 'self-center')}>{headerAction}</CardAction>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {filters || actions ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 max-w-full">{filters}</div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}

        {children}
      </CardContent>
    </Card>
  );
}
