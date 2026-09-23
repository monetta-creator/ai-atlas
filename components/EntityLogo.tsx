'use client';

import { useState } from 'react';
import { logoSource, monogram } from '@/lib/logo';

// An entity mark (company or vendor): favicon by domain via Google's public
// favicon service, a GitHub owner avatar for repo-hosted projects, and the
// deterministic monogram tile when neither resolves or the image fails.
// Client component only for the onError fallback; nothing is stored and
// nothing is fetched server-side on this path (the PDF path bakes its own
// PNG, lib/logo-fetch.ts). Styled by the .tl-logo classes in tooling.css.
export default function EntityLogo({
  name, domain, url = null, size = 28, className = '',
}: {
  name: string;
  domain: string | null;
  url?: string | null;
  size?: number;
  className?: string;
}) {
  const src = logoSource(domain, url);
  const [failed, setFailed] = useState(false);
  const mono = monogram(name);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };

  if (!src || failed) {
    return (
      <span
        className={`tl-logo tl-logo--mono ${className}`.trim()}
        style={{ ...style, background: mono.bg, color: mono.fg }}
        aria-hidden="true"
      >
        {mono.initials}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote favicons, no next/image domain list
    <img
      className={`tl-logo ${className}`.trim()}
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
