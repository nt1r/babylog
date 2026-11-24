import { cn } from '@/lib/utils';

type TimeScenePeriod = 'morning' | 'day' | 'evening' | 'night';

interface TimeGreetingMeta {
  readonly scene: TimeScenePeriod;
  readonly greeting: string;
  readonly subtitle: string;
}

/** 根据本地小时返回对应的问候语、暖心副文案与时段绘本插画类型。 */
export function getTimeGreetingMeta(date: Date): TimeGreetingMeta {
  const hour = date.getHours();
  if (hour < 6) {
    return {
      scene: 'night',
      greeting: '夜深了，辛苦啦',
      subtitle: '轻轻记一笔，你已经很棒了',
    };
  }
  if (hour < 11) {
    return {
      scene: 'morning',
      greeting: '早上好',
      subtitle: '元气满满，和宝宝开启新一天',
    };
  }
  if (hour < 14) {
    return {
      scene: 'day',
      greeting: '中午好',
      subtitle: '阳光暖暖，吃饱喝足好心情',
    };
  }
  if (hour < 18) {
    return {
      scene: 'day',
      greeting: '下午好',
      subtitle: '惬意午后，记录成长小瞬间',
    };
  }
  if (hour < 21) {
    return {
      scene: 'evening',
      greeting: '晚上好',
      subtitle: '傍晚慢慢收尾，准备安心入睡',
    };
  }
  return {
    scene: 'night',
    greeting: '晚上好',
    subtitle: '夜色温柔，祝宝宝一夜好眠',
  };
}

/**
 * 随昼夜时段切换的绘本风卡通小插画（清晨暖阳 / 晴日嫩芽 / 温柔夕阳 / 晚安弯月），
 * 复用全站 `--art-*` 亮暗双色 Token 与手绘线稿风格。
 */
export function TimeSceneArt({ scene, className }: { readonly scene: TimeScenePeriod; readonly className?: string }) {
  return (
    <svg viewBox="0 0 120 104" fill="none" aria-hidden="true" className={cn('block shrink-0 select-none', className)}>
      {/* 柔和有机绘本底块 */}
      <path className="art-meadow" d="M21 36C31 12 69 7 92 22c19 12 24 41 12 60-12 19-54 22-76 9C10 80 11 58 21 36Z" />

      {scene === 'morning' ? (
        <g className="art-float">
          <g className="art-line" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            {/* 柔和太阳光线 */}
            <path d="M66 14v7M66 73v5M38 45h-6M98 45h-6M46 25l-4-4M86 25l4-4M86 65l4 4" />
            {/* 微笑小太阳 */}
            <circle className="art-sun" cx="66" cy="45" r="19" />
            <path d="M58.5 43q2.5-3 5 0" strokeWidth="2.1" />
            <path d="M68.5 43q2.5-3 5 0" strokeWidth="2.1" />
            <path d="M62.5 50q3.5 3.2 7 0" strokeWidth="2.1" />
          </g>
          <ellipse className="art-blush" cx="56" cy="48.5" rx="3.2" ry="1.9" />
          <ellipse className="art-blush" cx="76" cy="48.5" rx="3.2" ry="1.9" />

          {/* 左下蓬松奶油云朵 */}
          <path
            className="art-cream art-line"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M26 78h34a10 10 0 0 0 1-19.9A13 13 0 0 0 36 55a11 11 0 0 0-10 23Z"
          />

          {/* 右下薄荷小嫩叶 */}
          <path
            className="art-leaf art-line"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M91 80c0-9 5-16 13-18 0 9-5 15-13 18Z"
          />
          <g className="art-sparkles" strokeWidth="2.2" strokeLinecap="round">
            <path d="M24 27v8m-4-4h8M100 26v6m-3-3h6" />
            <circle cx="96" cy="70" r="2" fill="currentColor" stroke="none" />
          </g>
        </g>
      ) : null}

      {scene === 'day' ? (
        <g className="art-float">
          <g className="art-line" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M58 12v7M58 69v6M30 41h-7M92 41h-6M38 22l-4.5-4.5M78 22l4.5-4.5M38 61l-4.5 4.5M78 61l4.5 4.5" />
            <circle className="art-sun" cx="58" cy="41" r="18" />
            <circle className="art-ink-fill" cx="52.5" cy="39.5" r="1.8" stroke="none" />
            <circle className="art-ink-fill" cx="63.5" cy="39.5" r="1.8" stroke="none" />
            <path d="M54.5 45.5q3.5 3.4 7 0" strokeWidth="2.1" />
          </g>
          <ellipse className="art-blush" cx="48.5" cy="44" rx="3" ry="1.8" />
          <ellipse className="art-blush" cx="67.5" cy="44" rx="3" ry="1.8" />

          {/* 左下云朵 */}
          <path
            className="art-cream art-line"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 79h33a9.5 9.5 0 0 0 1-18.9A12.5 12.5 0 0 0 31 57a10.5 10.5 0 0 0-10 22Z"
          />
          {/* 右侧小云 */}
          <path
            className="art-cream art-line"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M80 62h19a6.5 6.5 0 0 0 .5-13A8.5 8.5 0 0 0 83 47a7 7 0 0 0-3 15Z"
          />
          {/* 双片薄荷嫩芽 */}
          <g className="art-line" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path className="art-leaf" d="M77 83c0-10 5-17 14-19 0 10-5 16-14 19Z" />
            <path className="art-leaf" d="M77 84c-8-2-13-7-13-14 8 2 12 7 13 14Z" />
            <path d="M77 88v-11" />
          </g>
          <g className="art-sparkles" strokeWidth="2.2" strokeLinecap="round">
            <path d="M98 22v7m-3.5-3.5h7" />
            <circle cx="24" cy="34" r="2.2" fill="currentColor" stroke="none" />
          </g>
        </g>
      ) : null}

      {scene === 'evening' ? (
        <g className="art-float">
          <g className="art-line" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            {/* 傍晚暖阳半落云间 */}
            <path d="M58 16v6M36 25l4 4M80 25l-4 4" />
            <circle className="art-peach" cx="58" cy="48" r="20" />
            <path d="M50.5 46q2.5 2.5 5 0" strokeWidth="2.1" />
            <path d="M60.5 46q2.5 2.5 5 0" strokeWidth="2.1" />
            <path d="M55 52.5q3 2.5 6 0" strokeWidth="2.1" />
          </g>
          <ellipse className="art-blush" cx="48" cy="50.5" rx="3.2" ry="1.8" />
          <ellipse className="art-blush" cx="68" cy="50.5" rx="3.2" ry="1.8" />

          {/* 晚霞云层 */}
          <path
            className="art-cream art-line"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M20 82h66a10 10 0 0 0 1-19.9A13.5 13.5 0 0 0 63 58a12 12 0 0 0-21 4.5A10 10 0 0 0 20 82Z"
          />

          {/* 夜幕初升的第一颗小星星 */}
          <path
            className="art-star art-line"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m92 22 2.4 5.4 6 .7-4.6 4 1.3 5.9-5.1-3-5.1 3 1.2-5.9-4.5-4 6-.7Z"
          />
          <g className="art-sparkles" strokeWidth="2.2" strokeLinecap="round">
            <path d="M26 30v7m-3.5-3.5h7" />
            <circle cx="101" cy="48" r="2.2" fill="currentColor" stroke="none" />
          </g>
        </g>
      ) : null}

      {scene === 'night' ? (
        <g className="art-float">
          {/* 微笑弯月 */}
          <g className="art-line" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path className="art-sun" d="M68 20a23 23 0 1 0 17 38.5A18.5 18.5 0 0 1 68 20Z" />
            <path d="M46 44q3 3 6.5 0" strokeWidth="2.1" />
            <path d="M51 52q3 2.5 6 0" strokeWidth="2.1" />
          </g>
          <ellipse className="art-blush-soft" cx="46" cy="49" rx="3" ry="1.8" />

          {/* 挂起的小金星 */}
          <g className="art-line" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M89 17v11" />
            <path className="art-star" d="m89 28 2.2 4.8 5.3.6-4 3.5 1.1 5.2-4.6-2.7-4.6 2.7 1.1-5.2-4-3.5 5.3-.6Z" />
          </g>

          {/* 奶油睡枕云朵 */}
          <path
            className="art-cream art-line"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M27 83h54a9.5 9.5 0 0 0 .8-18.9A12.5 12.5 0 0 0 58 61a11 11 0 0 0-20 4.5A9.5 9.5 0 0 0 27 83Z"
          />

          {/* 柔和飘浮 Zzz 与星点 */}
          <g className="art-sleep" strokeLinecap="round" strokeLinejoin="round">
            <path d="M74 49h7l-7 7.5h7" strokeWidth="2" />
            <path d="M84 39h8.5l-8.5 9h8.5" strokeWidth="2.2" />
          </g>
          <g className="art-sparkles" strokeWidth="2.1" strokeLinecap="round">
            <path d="M23 32v7m-3.5-3.5h7" />
            <circle cx="99" cy="61" r="2" fill="currentColor" stroke="none" />
          </g>
        </g>
      ) : null}
    </svg>
  );
}
