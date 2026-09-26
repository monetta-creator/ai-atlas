// What builders are reading, the pure half (2026-09-26). PLAIN-NODE LOADABLE:
// only type imports. The model leg (./builders.ts, server) judges Hacker News
// front-page candidates for an AI builders pod inside a large regulated
// company; this module owns the tags, the cheap chips, the catalog matcher,
// the validator that is the type boundary for the cheap models' JSON, and
// the no-model fallback (today's strip: top 8 by points).

import type { EditionBuilderRead, EditionHnItem } from './types';

export type BuilderTag = 'tooling' | 'patterns' | 'agents' | 'evals' | 'security' | 'infra' | 'field';

export const BUILDER_TAGS: readonly BuilderTag[] = ['tooling', 'patterns', 'agents', 'evals', 'security', 'infra', 'field'];

export const BUILDER_TAG_LABELS: Record<BuilderTag, string> = {
  tooling: 'Tooling & models',
  patterns: 'Patterns & postmortems',
  agents: 'Agents',
  evals: 'Evals & benchmarks',
  security: 'Security & governance',
  infra: 'Infra & cost',
  field: 'Field notes',
};

export function isBuilderTag(v: unknown): v is BuilderTag {
  return typeof v === 'string' && (BUILDER_TAGS as readonly string[]).includes(v);
}

const deDash = (s: string): string => s.replace(/\s*—\s*/g, ', ');

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

const REPO_HOSTS = new Set(['github.com', 'gitlab.com', 'huggingface.co']);

export function chipsFor(hit: Pick<EditionHnItem, 'title' | 'url' | 'points' | 'comments'>): { showHn: boolean; repo: boolean; debate: boolean } {
  const host = hostOf(hit.url);
  return {
    showHn: /^show hn\b/i.test(hit.title.trim()),
    repo: host != null && REPO_HOSTS.has(host),
    debate: hit.comments >= 20 && hit.comments >= 0.6 * hit.points,
  };
}

export interface CatalogRow {
  slug: string;
  name: string;
  vendorDomain: string | null;
  urlHost: string | null;
  urlPath?: string | null;   // the product url's pathname, lowercased; the owner/repo on a platform host
}

// Hosts many products share: a story there says nothing about WHICH product
// (the first dry run matched a Claude Code memory tool to a GitHub Copilot
// row because both live on github.com). On these, match owner/repo instead.
const PLATFORM_HOSTS = new Set(['github.com', 'gitlab.com', 'huggingface.co', 'medium.com', 'substack.com', 'npmjs.com', 'pypi.org']);

function ownerRepo(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const parts = pathname.toLowerCase().split('/').filter(Boolean);
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
}

// A story names a cataloged product when its url host is the product's own
// domain (never a shared platform host; on those, the owner/repo path must
// match), or its title contains the product name as a whole word (4+ chars,
// so "Jev" or "Bun" never match; the longest name wins when several do).
export function catalogHrefFor(hit: Pick<EditionHnItem, 'title' | 'url'>, products: CatalogRow[]): string | null {
  const host = hostOf(hit.url);
  if (host && PLATFORM_HOSTS.has(host)) {
    let storyPath: string | null = null;
    try { storyPath = ownerRepo(new URL(hit.url!).pathname); } catch { storyPath = null; }
    if (storyPath) {
      const byRepo = products.find((p) => {
        const uh = p.urlHost?.replace(/^www\./, '').toLowerCase();
        return uh === host && ownerRepo(p.urlPath) === storyPath;
      });
      if (byRepo) return `/tooling/${byRepo.slug}`;
    }
  } else if (host) {
    const byHost = products.find((p) => {
      const vd = p.vendorDomain?.replace(/^www\./, '').toLowerCase();
      const uh = p.urlHost?.replace(/^www\./, '').toLowerCase();
      return (vd && vd === host && !PLATFORM_HOSTS.has(vd)) || (uh && uh === host && !PLATFORM_HOSTS.has(uh));
    });
    if (byHost) return `/tooling/${byHost.slug}`;
  }
  const title = hit.title.toLowerCase();
  let best: CatalogRow | null = null;
  for (const p of products) {
    const name = p.name.trim();
    if (name.length < 4) continue;
    const re = new RegExp(`(^|[^a-z0-9])${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
    if (re.test(title) && (!best || name.length > best.name.length)) best = p;
  }
  return best ? `/tooling/${best.slug}` : null;
}

function toRead(hit: EditionHnItem, tag: BuilderTag, line: string | null, products: CatalogRow[]): EditionBuilderRead {
  const chips = chipsFor(hit);
  return {
    title: deDash(hit.title),
    url: hit.url,
    hnUrl: hit.hnUrl,
    points: hit.points,
    comments: hit.comments,
    tag,
    line,
    ...chips,
    catalogHref: catalogHrefFor(hit, products),
  };
}

export interface RawJudgment { index?: unknown; keep?: unknown; tag?: unknown; line?: unknown }

// The type boundary for the model's JSON: the OpenRouter path writes the
// schema into the prompt and coerces nothing, and qwen/GLM emit "3" for 3
// and "true" for true now and then. Anything that does not resolve to a
// kept, in-range hit is dropped; an unknown tag files under `field`.
export function validateBuilderJudgments(
  hits: EditionHnItem[],
  raw: unknown,
  products: CatalogRow[] = [],
  cap = 10
): EditionBuilderRead[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)
      ? ((raw as { items: unknown[] }).items)
      : [];
  const seen = new Set<number>();
  const out: EditionBuilderRead[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const j = item as RawJudgment;
    const idx = Number(j.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= hits.length || seen.has(idx)) continue;
    const keep = j.keep === true || j.keep === 'true';
    if (!keep) continue;
    const tagRaw = typeof j.tag === 'string' ? j.tag.trim().toLowerCase() : '';
    const tag: BuilderTag = isBuilderTag(tagRaw) ? tagRaw : 'field';
    const lineRaw = typeof j.line === 'string' ? deDash(j.line).replace(/\s+/g, ' ').trim() : '';
    const line = lineRaw ? (lineRaw.length > 140 ? `${lineRaw.slice(0, 137).trimEnd()}...` : lineRaw) : null;
    seen.add(idx);
    out.push(toRead(hits[idx], tag, line, products));
    if (out.length >= cap) break;
  }
  return out;
}

// The no-model strip: the top 8 by points, no line, filed as field notes.
export function fallbackReads(hits: EditionHnItem[], products: CatalogRow[] = [], limit = 8): EditionBuilderRead[] {
  return [...hits]
    .sort((a, b) => b.points - a.points)
    .slice(0, limit)
    .map((h) => toRead(h, 'field', null, products));
}

export interface BuilderGroup { tag: BuilderTag; label: string; items: EditionBuilderRead[] }

export function groupReadsByTag(reads: EditionBuilderRead[]): BuilderGroup[] {
  return BUILDER_TAGS
    .map((tag) => ({ tag, label: BUILDER_TAG_LABELS[tag], items: reads.filter((r) => r.tag === tag) }))
    .filter((g) => g.items.length > 0);
}
