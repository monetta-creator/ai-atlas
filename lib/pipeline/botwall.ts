// Pure, import-free so it's loadable by both the Next.js bundler and a plain-Node test
// script (lib/pipeline/web.ts pulls in ../cost -> ./db.ts, which plain-Node type
// stripping can't resolve through the extensionless import chain).

// Cloudflare/anti-bot verification stub pages ("Verifying you are human...",
// "...security of your connection...") come back from the jina reader fallback as
// plain text short enough and wall-shaped enough to slip past MIN_READABLE_CHARS.
const BOT_WALL_RE =
  /(verify(ing)? (you are|that you are)|security of your connection|checking your browser|are you a human|enable javascript and cookies|cloudflare|just a moment|attention required|access denied|please complete the security check)/i;

// Length gate matters: a real article that merely mentions Cloudflare must not be
// flagged, hence the 1200-char cap paired with only scanning the first ~600 chars.
export function looksLikeBotWall(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length >= 1200) return false;
  return BOT_WALL_RE.test(trimmed.slice(0, 600));
}
