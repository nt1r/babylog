export function BrandMark({ className = 'size-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="20" fill="currentColor" />
      <path
        className="brand-mane"
        d="M36.5 16C31.2 16 28 19.6 29.2 23.4 26.8 25.2 27.2 28.6 30.2 29.8L35 28.2 38 17Z"
      />
      <path
        className="brand-pony"
        d="M36.5 15.5 39 10.8c.7-1.2 2.4-.8 2.8.6l1 4.4c2 .4 4 1.7 5.4 3.8l2.6 4.2c1.6 2.6 0 6.4-3.4 6.8-2.4.3-4.4-.8-5.9-2.1l-.5 5.4 3.6 13.7-4.8.8-3.2-10.2h-10l-3 10.2-4.8-.8 3.4-12.6c-4.5-.2-8-2.8-9-6.4-.7-2.6 1.3-4.8 4-3.8 2.3.9 4 2.8 6.8 2.8h8.4c1.4-3.8 2.6-8.4 4.1-12.1Z"
      />
      <path className="brand-rocker" d="M13 46.5q19 10 38 0" strokeWidth="3.8" strokeLinecap="round" />
      <circle cx="42.8" cy="21.4" r="1.9" fill="currentColor" />
    </svg>
  );
}
