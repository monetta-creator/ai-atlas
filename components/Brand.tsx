import Link from 'next/link';

// The wordmark + Beta pill, shared by the real Header and the route-loading
// fallback so navigation renders pixel-identical chrome (no pop-in).
export default function Brand() {
  return (
    <div className="brand">
      <Link href="/" className="mark">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="10" cy="10" r="8" />
          <circle cx="10" cy="10" r="3.4" />
          <path d="M10 1.5v4M10 14.5v4M1.5 10h4M14.5 10h4" strokeLinecap="round" />
        </svg>
        The AI Atlas
      </Link>
      <span className="brand-beta">Beta</span>
    </div>
  );
}
