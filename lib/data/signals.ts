import { q, one } from '../db';
import type {
  Direction, ConvictionLabel,
  Signal, SignalTouch, SignalContext, Significance, SignalsPageResult,
  DedupeRecommendation,
  } from '../types';

// ---- Signal Board ----------------------------------------------------------
// The public feed IS the share view: guests/public see published signals only;
// the author also sees drafts. Filters (since/lenses/significance) are accepted at
// the data layer from the start so the future digest job can reuse this read.

interface SignalQuery {
  admin?: boolean;             // the author sees drafts too
  publishedOnly?: boolean;     // force published-only regardless of admin (digests)
  since?: string;              // ISO timestamp — published_at >= since
  until?: string;              // 'YYYY-MM-DD' — published_at < until::date + 1 (inclusive end-day)
  contexts?: SignalContext[];
  significance?: Significance[];
}

export const SIGNAL_COLUMNS = `
  s.id, s.title, s.summary, s.significance,
  s.context::text as context, s.touches,
  s.source_id, s.published_at, s.is_published, s.archived_at, s.origin, s.created_at, s.updated_at,
  src.title as source_title, src.url as source_url`;

export async function getSignals(opts: SignalQuery = {}): Promise<Signal[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const publishedOnly = opts.publishedOnly || !opts.admin;
  if (publishedOnly) where.push('s.is_published = true');
  if (opts.since) {
    params.push(opts.since);
    where.push(`s.published_at >= $${params.length}::timestamptz`);
  }
  if (opts.until) {
    params.push(opts.until);
    // Half-open upper bound: published_at is timestamptz but `until` is a YYYY-MM-DD day,
    // so `< until::date + 1` keeps the whole end day in range (a plain `<= until` would
    // drop everything published after 00:00 on that day).
    where.push(`s.published_at < ($${params.length}::date + 1)`);
  }
  if (opts.contexts && opts.contexts.length) {
    params.push(opts.contexts);
    where.push(`s.context = any($${params.length}::context_t[])`);
  }
  if (opts.significance && opts.significance.length) {
    params.push(opts.significance);
    where.push(`s.significance = any($${params.length}::significance_t[])`);
  }
  const clause = where.length ? `where ${where.join(' and ')}` : '';
  return q<Signal>(
    `select ${SIGNAL_COLUMNS}
       from signals s
       left join sources src on src.id = s.source_id
       ${clause}
      order by s.published_at desc, s.created_at desc`,
    params
  );
}

interface SignalPageQuery {
  admin?: boolean;                                      // server-set; drafts visible only when true
  status?: 'published' | 'unpublished' | 'archived';   // honored only when admin
  contexts?: SignalContext[];
  significance?: Significance[];
  search?: string;
  page?: number;
  pageSize?: number;
}

// Paginated/searchable feed read for the Signal Board (admin board + guest feed). Built
// param-safely like getCandidateArchive. The published/draft gate is enforced HERE: a
// non-admin caller is forced to published-only regardless of `status`. Separate from
// getSignals (which the digest still uses) so that caller's Signal[] return is untouched.
export async function getSignalsPage(opts: SignalPageQuery): Promise<SignalsPageResult> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (!opts.admin) {
    where.push('s.is_published = true');                 // guest floor — drafts never leak
  } else if (opts.status === 'published') {
    where.push('s.is_published = true');
  } else if (opts.status === 'archived') {
    where.push('s.is_published = false');
    where.push('s.archived_at is not null');             // set-aside drafts
  } else if (opts.status === 'unpublished') {
    where.push('s.is_published = false');
    where.push('s.archived_at is null');                 // ACTIVE drafts only (archived excluded)
  }
  if (opts.contexts && opts.contexts.length) {
    params.push(opts.contexts);
    where.push(`s.context = any($${params.length}::context_t[])`);
  }
  if (opts.significance && opts.significance.length) {
    params.push(opts.significance);
    where.push(`s.significance = any($${params.length}::significance_t[])`);
  }
  if (opts.search) {
    // Escape LIKE metacharacters, then parameterize (mirrors getCandidateArchive).
    const term = `%${opts.search.replace(/[%_\\]/g, (ch) => '\\' + ch)}%`;
    params.push(term);
    where.push(`(s.title ilike $${params.length} or s.summary ilike $${params.length})`);
  }
  const clause = where.length ? `where ${where.join(' and ')}` : '';
  const pageSize = Math.min(Math.max(opts.pageSize ?? 12, 1), 50);
  const page = Math.max(opts.page ?? 1, 1);

  const [rows, totalRow] = await Promise.all([
    q<Signal>(
      `select ${SIGNAL_COLUMNS}
         from signals s
         left join sources src on src.id = s.source_id
         ${clause}
        order by s.published_at desc, s.created_at desc
        limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]
    ),
    one<{ n: number }>(`select count(*)::int as n from signals s ${clause}`, params),
  ]);
  return { rows, total: totalRow?.n ?? 0, page, pageSize };
}

// Enumerate ALL unpublished drafts (the input to the draft-queue dedupe scan): pipeline
// drafts AND manual ones, across every run. The source outlet is joined in for the prompt.
export async function getAllDraftSignals(): Promise<{
  id: string; title: string; summary: string | null; source_domain: string | null;
}[]> {
  return q<{ id: string; title: string; summary: string | null; source_domain: string | null }>(
    `select s.id, s.title, s.summary, src.outlet as source_domain
       from signals s
       left join sources src on src.id = s.source_id
      where s.is_published = false and s.archived_at is null
      order by s.created_at desc`,
    []
  );
}

// Ids of the active drafts (unpublished, not archived) — used to reconcile a persisted dedupe
// scan against reality on read (drafts merged/discarded/published/archived since the scan drop).
export async function getActiveDraftIds(): Promise<string[]> {
  const rows = await q<{ id: string }>(
    `select id from signals where is_published = false and archived_at is null`,
    []
  );
  return rows.map((r) => r.id);
}

// The persisted board-level dedupe scan (singleton), or null if none.
export async function getDedupeScan(): Promise<DedupeRecommendation | null> {
  const row = await one<{ recommendation: DedupeRecommendation }>(
    `select recommendation from dedupe_scan where id = true`
  );
  return row?.recommendation ?? null;
}

// Drop groups whose canonical is gone or that have no surviving duplicate, so a persisted scan
// never shows a draft that was since merged/discarded/published/archived. Pure (no DB).
export function reconcileDedupeScan(
  rec: DedupeRecommendation | null, activeIds: Set<string>
): DedupeRecommendation | null {
  if (!rec) return null;
  const groups = rec.groups
    .map((g) => ({ ...g, duplicates: g.duplicates.filter((m) => activeIds.has(m.signal_id)) }))
    .filter((g) => activeIds.has(g.canonical.signal_id) && g.duplicates.length > 0);
  return groups.length ? { ...rec, groups } : null;
}

// Resolve a signal's touches codes back to the hypotheses they name, preserving
// the author's order and folding in each touch's direction/reason from
// touch_details. A code that no longer resolves is dropped for guests; for the
// admin it surfaces as an `unresolved` marker (the drift guard). conviction_label
// and the model's reason are personal-layer — nulled for guests.
async function resolveTouches(
  codes: string[],
  touchDetails: Record<string, { direction?: Direction; reason?: string }> | null | undefined,
  personal: boolean
): Promise<SignalTouch[]> {
  if (!codes || !codes.length) return [];
  const rows = await q<{
    code: string; statement: string; conviction_label: ConvictionLabel;
  }>(
    `select code, statement, conviction_label from hypotheses where code = any($1)`,
    [codes]
  );
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const details = touchDetails ?? {};
  return codes
    .map((code): SignalTouch | null => {
      const r = byCode.get(code);
      const d = details[code];
      if (!r) {
        // Drift: the code no longer names a live hypothesis. Admins see it
        // flagged so they can fix the signal; guests never see a broken link.
        return personal
          ? {
              code, statement: 'This code no longer resolves to a hypothesis.',
              conviction_label: null, href: '#',
              direction: d?.direction ?? null, reason: null, unresolved: true,
            }
          : null;
      }
      return {
        code: r.code,
        statement: r.statement,
        conviction_label: personal ? r.conviction_label : null,
        href: `/hypothesis/${encodeURIComponent(r.code)}`,
        direction: d?.direction ?? null,
        reason: personal ? (d?.reason ?? null) : null,
      };
    })
    .filter((t): t is SignalTouch => t !== null);
}

export async function getSignal(
  id: string, personal: boolean
): Promise<{ signal: Signal; touches: SignalTouch[] } | null> {
  const signal = await one<Signal>(
    // brief/counterpoint (cached AI analysis, migration 0022) are read here only — kept off
    // SIGNAL_COLUMNS so the feed/digest payloads stay lean. They are public (no personal layer).
    `select ${SIGNAL_COLUMNS}, s.touch_details, s.brief, s.counterpoint
       from signals s
       left join sources src on src.id = s.source_id
      where s.id = $1`,
    [id]
  );
  if (!signal) return null;
  const touches = await resolveTouches(signal.touches, signal.touch_details, personal);
  // touch_details (the model's reasons) is personal-layer — keep it off the wire for guests.
  if (!personal) signal.touch_details = undefined;
  return { signal, touches };
}

// Reverse lookup: every signal whose touches names this code (GIN-backed).
// Drafts are admin-only; guests see published signals.
export async function getSignalsTouchingHypothesis(code: string, personal: boolean): Promise<Signal[]> {
  const where = ['s.touches @> array[$1]::text[]'];
  if (!personal) where.push('s.is_published = true');
  return q<Signal>(
    `select ${SIGNAL_COLUMNS}
       from signals s
       left join sources src on src.id = s.source_id
      where ${where.join(' and ')}
      order by s.published_at desc, s.created_at desc`,
    [code]
  );
}

// "In context": other signals that touch any of the SAME hypothesis codes as
// this one, so a development on the detail page reads as part of an ongoing
// story. GIN array-overlap (`&&`), self excluded, published-only for guests.
export async function getRelatedSignals(
  signalId: string, codes: string[], personal: boolean
): Promise<Signal[]> {
  if (!codes || !codes.length) return [];
  const where = ['s.id <> $1', 's.touches && $2::text[]'];
  if (!personal) where.push('s.is_published = true');
  return q<Signal>(
    `select ${SIGNAL_COLUMNS}
       from signals s
       left join sources src on src.id = s.source_id
      where ${where.join(' and ')}
      order by s.published_at desc, s.created_at desc`,
    [signalId, codes]
  );
}
