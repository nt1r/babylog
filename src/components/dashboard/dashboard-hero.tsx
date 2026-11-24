import { Link } from '@tanstack/react-router';
import { CalendarDays, ChevronRight, Sparkles } from 'lucide-react';
import { BrandMark } from '@/components/brand/brand-mark';
import { getTimeGreetingMeta, TimeSceneArt } from '@/components/brand/time-scene-art';
import type { BabyProfile } from '@/lib/baby';
import { formatBabyAge } from '@/lib/time';

interface DashboardHeroProps {
  readonly now: Date;
  readonly todayLabel: string;
  readonly baby: BabyProfile | null | undefined;
}

/**
 * 首页顶部绘本风时光问候卡片：
 * 结合随昼夜切换的手绘卡通插画（太阳/夕阳/弯月）与重构后的宝宝成长名片条，
 * 兼顾移动端首屏的亲子温度与信息紧凑度。
 */
export function DashboardHero({ now, todayLabel, baby }: DashboardHeroProps) {
  const { scene, greeting, subtitle } = getTimeGreetingMeta(now);
  const ageInfo = baby ? formatBabyAge(baby.birth_date, now) : null;

  return (
    <section
      aria-label="今日问候与宝宝信息"
      className="relative overflow-hidden rounded-3xl border border-border/75 bg-card p-4 shadow-xs sm:p-5"
    >
      {/* 柔和绘本氛围底光（纯语义变量，亮暗主题自适应） */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-12 -right-10 size-44 rounded-full bg-accent/65 blur-2xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-14 -left-10 size-36 rounded-full bg-feeding-soft/60 blur-2xl"
      />

      <div className="relative flex flex-col gap-3.5 @3xl/main:flex-row @3xl/main:items-center @3xl/main:justify-between @3xl/main:gap-6">
        {/* 上半区：日期 + 问候语 + 时段手绘卡通插画 */}
        <div className="flex items-center justify-between gap-3 @3xl/main:flex-1">
          <div className="min-w-0 space-y-1.5">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/85 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              <CalendarDays className="size-3.5 shrink-0 text-primary" strokeWidth={1.8} />
              <span>{todayLabel}</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">{greeting}</h1>
            <p className="text-xs text-muted-foreground sm:text-[13px]">{subtitle}</p>
          </div>

          <TimeSceneArt scene={scene} className="w-24 sm:w-28 @3xl/main:w-28" />
        </div>

        {/* 宝宝专属名片条：点击直达生长发育档案，移动端全宽贴合、桌面端自然并排 */}
        {baby && ageInfo ? (
          <Link
            to="/growth"
            className="group flex items-center justify-between gap-3 rounded-2xl border border-border/75 bg-background/85 px-3.5 py-2.5 transition-colors outline-none hover:border-primary/45 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring @3xl/main:min-w-72 @3xl/main:shrink-0"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <BrandMark className="size-10 shrink-0 text-primary shadow-2xs" />
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[15px] font-semibold text-foreground">{baby.nickname}</span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/75 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
                <p className="truncate text-xs text-muted-foreground tabular-nums">{ageInfo.ageLabel}</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1 rounded-xl bg-accent/80 px-2.5 py-1.5 text-accent-foreground">
              <Sparkles className="size-3.5 shrink-0 text-primary" strokeWidth={1.8} />
              <span className="text-xs font-semibold tabular-nums">{ageInfo.daysLabel}</span>
            </div>
          </Link>
        ) : null}
      </div>
    </section>
  );
}
