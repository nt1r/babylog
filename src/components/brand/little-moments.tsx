import { cn } from '@/lib/utils';

export function LittleMoments({ className }: { className?: string }) {
  return (
    <svg
      className={cn('block h-auto w-full max-w-[400px]', className)}
      viewBox="68 32 362 290"
      fill="none"
      aria-hidden="true"
    >
      <path
        className="art-meadow"
        d="M99 103C149 28 288 28 365 93c66 56 77 150 18 183-67 37-247 29-294-19-39-39-27-99 10-154Z"
      />
      <ellipse className="art-ground" cx="249" cy="302" rx="166" ry="13" />
      <g className="art-line" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M128 221V92a53 53 0 0 1 106 0" />
        <path d="M184 43v37m50 12v6" />
        <path className="art-sun" d="M193 79a15 15 0 1 1-18-18 15 15 0 0 0 18 18Z" />
        <path className="art-star" d="m234 95 3.8 8.5 9.5 1-7.5 6.5 2 9.5-7.8-4.7-8.2 4.7 1.8-9.5-6.8-6.5 9.4-1Z" />
        <path className="art-wood" d="m173 267-13 34m164-34 13 34" />
        <path className="art-basket" d="M133 206h231l-19 54a30 30 0 0 1-28 20H181a30 30 0 0 1-28-20Z" />
        <path
          className="basket-weave"
          d="m169 230 11 33m15-33 7 34m19-34 2 34m23-34v34m26-34-3 34m28-34-7 34m31-34-11 33"
        />
        <ellipse className="art-blanket" cx="249" cy="206" rx="118" ry="26" />
        <path className="art-mane" d="M318 181c16-6 31 2 29 17-2 11-15 13-24 8" />
        <path d="M326 189c7-1 13 3 13 9" strokeWidth="2" />
        <path className="art-swaddle" d="M214 192c5-48 92-52 109-6l7 24c-36 15-83 18-116 7Z" />
        <path className="swaddle-fold" d="M230 179c22 1 45 14 57 38m-18-41c-7 11-15 19-24 25" />
        <path className="art-mane" d="M224 148c16-2 27 8 25 22 8 4 10 15 3 23-8 6-20 4-26-2Z" />
        <path className="art-pony" d="M174 152c-5-13-4-25 4-29 8-3 14 7 15 19" />
        <path className="art-pony" d="M212 146c5-14 14-24 21-19 7 4 4 16-4 26" />
        <path className="art-ear-inner" d="M179 145c-2-7-2-14 2-16 4-1 7 4 8 11Z" stroke="none" />
        <path className="art-ear-inner" d="M217 143c2-7 8-14 12-11 3 2 1 8-4 13Z" stroke="none" />
        <path
          className="art-pony"
          d="M167 166c2-18 19-30 41-29 22 1 35 16 33 37-2 22-19 35-44 34-12 0-24-2-32-7-10-6-13-17-7-25 2-3 6-6 9-10Z"
        />
        <path
          className="art-muzzle"
          d="M156 179c5-6 18-7 28-2 10 5 13 15 7 23-6 7-20 8-30 3-9-5-11-16-5-24Z"
          stroke="none"
        />
        <path d="M167 166c-3 4-7 7-9 10-6 8-3 19 7 25 8 5 20 7 32 7 25 1 42-12 44-34" fill="none" />
        <path className="art-mane" d="M190 138c6-13 21-14 29-4-6 2-9 7-8 13-7-4-13 0-16 6-5-4-7-9-5-15Z" />
        <path d="M179 166q5 5.5 11 1" />
        <path d="M206 169q5.5 6 11.5 0" />
        <ellipse className="art-blush-soft" cx="174" cy="175" rx="4.5" ry="2.6" stroke="none" />
        <ellipse className="art-blush" cx="218" cy="180" rx="6.5" ry="3.8" stroke="none" />
        <circle className="art-nostril" cx="166" cy="184" r="1.4" stroke="none" />
        <circle className="art-nostril" cx="177" cy="186" r="1.4" stroke="none" />
        <path d="M166 193q6.5 4.5 12.5-.5" strokeWidth="2.4" />
        <path className="art-pony" d="M222 199c9-3 20-1 22 7 1 6-5 10-13 10-9 0-14-4-14-10 0-3 2-5 5-7Z" />
        <path className="art-hoof" d="M233 198c6 0 11 3 11 8 0 5-4 9-10 9-2-5-3-11-1-17Z" />
        <path className="art-rim" d="M132 207q117 49 234-1v12q-116 49-234 0Z" />
        <path className="art-leaf" d="M380 281c-2-22 4-42 19-53 2 22-5 37-19 53Z" />
        <path className="art-leaf" d="M380 290c-18-6-28-19-28-36 19 6 27 19 28 36Z" />
        <path d="M380 302v-31" />
      </g>
      <g className="art-sparkles" strokeWidth="2.5" strokeLinecap="round">
        <path d="M327 83v15m-7-7h14M96 177v12m-6-6h12M358 157v12m-6-6h12" />
        <circle cx="294" cy="64" r="3" fill="currentColor" stroke="none" />
        <circle cx="95" cy="245" r="3" fill="currentColor" stroke="none" />
      </g>
      <g className="art-sleep" strokeLinecap="round" strokeLinejoin="round">
        <path d="M261 135h9l-9 10h9" strokeWidth="2.2" />
        <path d="M277 115h12l-12 13h12" strokeWidth="2.6" />
      </g>
    </svg>
  );
}
