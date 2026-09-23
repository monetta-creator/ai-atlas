'use client';

import { useState } from 'react';

// A vendor mark for the catalog: the site's favicon via Google's public
// favicon service (no key, cached at their edge), a GitHub owner avatar for
// repo-hosted projects, and a deterministic monogram tile when neither
// resolves or the image fails to load. Client component only for the
// onError fallback; nothing is stored, nothing is fetched server-side.
export function logoSource(domain: string | null, url: string | null): string | null {
  let host = (domain ?? '').toLowerCase().replace(/^www\./, '');
  let owner: string | null = null;
  if (url) {
    try {
      const u = new URL(url);
      const h = u.hostname.toLowerCase().replace(/^www\./, '');
      if (h === 'github.com') {
        owner = u.pathname.split('/').filter(Boolean)[0] ?? null;
      } else if (!host) {
        host = h;
      }
    } catch {
      // ignore an unparsable url; the domain column still stands
    }
  }
  if (owner) return `https://github.com/${encodeURIComponent(owner)}.png?size=96`;
  if (host && host !== 'github.com') return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  return null;
}

function hue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export default function ProductLogo({
  name, domain, url, size = 28,
}: {
  name: string;
  domain: string | null;
  url: string | null;
  size?: number;
}) {
  const src = logoSource(domain, url);
  const [failed, setFailed] = useState(false);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };

  if (!src || failed) {
    return (
      <span
        className="tl-logo tl-logo--mono"
        style={{ ...style, background: `oklch(0.93 0.05 ${hue(name)})`, color: `oklch(0.42 0.12 ${hue(name)})` }}
        aria-hidden="true"
      >
        {initials}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote favicons, no next/image domain list
    <img
      className="tl-logo"
      style={style}
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
