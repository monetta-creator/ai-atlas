// Entity marks (company and vendor logos), the pure half. The favicon comes
// from Google's public favicon service by domain (no key, cached at their
// edge), a GitHub owner avatar for repo-hosted projects, and a deterministic
// monogram (two initials on a hue hashed from the name) when neither resolves
// or the image fails to load. Nothing is stored for the web path; the PDF
// path bakes a PNG data URI at pack-build time (lib/logo-fetch.ts). Pure so
// scripts/test-intel-deck.mjs can load it.

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
      // ignore an unparsable url; the domain still stands
    }
  }
  if (owner) return `https://github.com/${encodeURIComponent(owner)}.png?size=96`;
  if (host && host !== 'github.com') return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  return null;
}

// The PNG endpoint for the PDF path: same service, explicit size.
export function faviconPngUrl(domain: string | null, size = 64): string | null {
  const host = (domain ?? '').toLowerCase().replace(/^www\./, '');
  if (!host) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
}

export function hue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

// The monogram's colours as oklch strings (web) and as sRGB hex (react-pdf
// cannot parse oklch): a fixed pastel/ink pair per hue.
export function monogram(name: string): { initials: string; bg: string; fg: string; bgHex: string; fgHex: string } {
  const h = hue(name);
  return {
    initials: initials(name),
    bg: `oklch(0.93 0.05 ${h})`,
    fg: `oklch(0.42 0.12 ${h})`,
    bgHex: hslToHex(h, 45, 92),
    fgHex: hslToHex(h, 45, 32),
  };
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100; const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}
