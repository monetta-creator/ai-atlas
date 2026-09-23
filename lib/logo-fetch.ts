import { faviconPngUrl } from './logo';

// Server-side favicon fetch for PDFs (the deck's company slides). Fetched
// ONCE at pack-build time and stored on the pack as a data URI, so the PDF
// route itself makes no network calls and renders the same bytes as the web
// stage. Small, bounded, best effort: a miss becomes null and the renderer
// draws the monogram instead.
const MAX_BYTES = 12 * 1024;
const TIMEOUT_MS = 4_000;

export async function fetchLogoDataUri(domain: string | null): Promise<string | null> {
  const url = faviconPngUrl(domain, 64);
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'image/png,image/*' } });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;
    // Google answers PNG; guard on magic bytes rather than the declared type.
    const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    if (!png && !type.includes('png')) return null;
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Bounded concurrency over many domains; order preserved.
export async function fetchLogoDataUris(domains: (string | null)[], concurrency = 6): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(domains.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < domains.length) {
      const i = next++;
      out[i] = await fetchLogoDataUri(domains[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, domains.length) }, worker));
  return out;
}
