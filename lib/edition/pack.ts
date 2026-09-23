// The daily edition's pack builder (Task 4). Reads across the four collection
// engines (scan, intel, pipeline, research) plus the tooling monitor and
// assembles a guest-safe EditionPack: headlines, urls, outlets, tiers,
// summaries and in-app hrefs only, never review notes, raw text or admin
// columns (the roundup/tooling-report discipline, lib/research/roundup.ts).
//
// PLAIN-NODE LOADABLE: scripts/test-edition-pack.mjs imports windowFor and
// allowlistForEdition directly from this file. Every relative import this
// module needs AT LOAD TIME therefore carries an explicit .ts extension (the
// lib/pipeline/config.ts convention) and resolves to a dependency-light
// module (db.ts, scan/core.ts, edition/cluster.ts — none of which have their
// own relative imports). The one DB-touching read this file does NOT need at
// load time (the Monday tooling-entrants pull, which drags in lib/data/tooling
// -> lib/db with no .ts extension) is dynamically imported inside
// buildEditionPack instead, so it is never resolved by the pure test.

import { q, one } from '../db.ts';
import { lookbackDays } from '../scan/core.ts';
import { clusterStories, coverageLine } from './cluster.ts';
import { fetchHnAiFront } from './hn.ts';
import { fetchMarketStrip } from './markets.ts';
import type { StoryItem, StoryCluster } from './cluster';
import type {
  EditionPack, EditionNumbers, EditionThing, EditionCompanyNote, EditionPaper, EditionTool,
  EditionBlindSpot, EditionSourceRow, EditionFrontItem,
} from './types';
import type { CitationAllowlist } from '../citations';

// Belt-and-braces on the no-em-dash rule, same as lib/research/roundup.ts's
// deDash: the model is instructed never to use one, this is the backstop.
export const deDash = (s: string): string => s.replace(/\s*—\s*/g, ', ');

// ---------------------------------------------------------------- window

// Monday's window reaches back over the weekend (lookbackDays returns 3 on a
// Monday, 1 otherwise), same rule the scan/intel/pipeline engines use for
// their own catch-up. Half-open [from, to) in UTC, matching the rest of the
// codebase's date-range idiom (e.g. lib/data/reports.ts's `< ($2::date + 1)`)
// rather than an inclusive 23:59:59 upper bound.
// The edition's window is "since the last edition": it closes at press time
// (EDITION_PRESS_UTC on the edition's day) and opens at the previous
// weekday's press time, so the 20:30 UTC late feed sweep lands in the next
// morning's paper instead of falling between two calendar days. Monday's
// window reaches back to Friday's press time (lookbackDays = 3). `fromDay`
// is kept for callers that label the window by date.
export const EDITION_PRESS_UTC = '16:45:00';

export function windowFor(day: string): { from: string; to: string; fromDay: string } {
  const to = new Date(`${day}T${EDITION_PRESS_UTC}Z`);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - lookbackDays(day));
  return { from: from.toISOString(), to: to.toISOString(), fromDay: from.toISOString().slice(0, 10) };
}

function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- rows

interface ScanRow {
  id: string; headline: string | null; url: string; source_domain: string | null;
  source_tier: number | null; content_kind: string | null; relevance: number | null;
  published_date: string | null; summary: string | null; entities: string[] | null; tags: string[] | null;
}

interface IntelRow {
  id: string; headline: string | null; url: string; source_domain: string | null;
  source_tier: number | null; content_kind: string | null; significance: number | null;
  published_date: string | null; summary: string | null; entities: string[] | null; dimensions: string[] | null;
}

interface CandidateRow {
  id: string; headline: string | null; url: string; source_domain: string | null;
  published_date: string | null; signal_id: string | null;
}

interface SignalRow {
  id: string; title: string; summary: string | null; published_date: string | null;
  claim_touches: string[]; source_url: string | null;
}

// ---------------------------------------------------------------- pack builder

export async function buildEditionPack(day: string): Promise<EditionPack> {
  const w = windowFor(day);
  const isMonday = new Date(`${day}T00:00:00Z`).getUTCDay() === 1;

  const [scanRows, intelRows, candidateRows, signalRows, factRows, paperRows, coverageRow, countRow] = await Promise.all([
    q<ScanRow>(
      `select si.id, si.headline, si.url, si.source_domain, si.source_tier, si.content_kind,
              si.relevance::float as relevance, to_char(si.published_date, 'YYYY-MM-DD') as published_date,
              si.summary, si.entities, si.tags
         from scan_items si
        where si.created_at >= $1::timestamptz and si.created_at < $2::timestamptz
          and coalesce(si.relevance, 0) >= 0.55
          and (si.source_tier is null or si.source_tier <= 3)
          and coalesce(si.content_kind, '') <> 'marketing'
        order by si.relevance desc nulls last`,
      [w.from, w.to]
    ),
    q<IntelRow>(
      `select ii.id, ii.headline, ii.url, ii.source_domain, ii.source_tier, ii.content_kind,
              ii.significance::float as significance, to_char(ii.published_date, 'YYYY-MM-DD') as published_date,
              ii.summary, ii.entities, ii.dimensions
         from intel_items ii
        where ii.created_at >= $1::timestamptz and ii.created_at < $2::timestamptz
          and coalesce(ii.significance, 0) >= 0.55
          and (ii.source_tier is null or ii.source_tier <= 3)
          and coalesce(ii.content_kind, '') <> 'marketing'
        order by ii.significance desc nulls last`,
      [w.from, w.to]
    ),
    q<CandidateRow>(
      // A draft signal 404s for guests, so link it only once published;
      // otherwise the item falls back to the external url.
      `select sc.id, sc.headline, sc.url, sc.source_domain,
              to_char(sc.published_date, 'YYYY-MM-DD') as published_date,
              case when s.is_published then sc.signal_id end as signal_id
         from signal_candidates sc
         left join signals s on s.id = sc.signal_id
        where sc.triage_status = 'approved'
          and sc.created_at >= $1::timestamptz and sc.created_at < $2::timestamptz`,
      [w.from, w.to]
    ),
    // Window on when a signal went public, not its editorial date: pipeline
    // drafts carry the article's date and are published hours or days later,
    // by a human or the promotion policy. first_published_at (0059) records
    // that moment; the coalesce covers rows from before it existed.
    q<SignalRow>(
      `select s.id, s.title, s.summary, to_char(s.published_at, 'YYYY-MM-DD') as published_date,
              s.claim_touches, src.url as source_url
         from signals s
         left join sources src on src.id = s.source_id
        where s.is_published = true
          and coalesce(s.first_published_at, s.auto_published_at, s.published_at) >= $1::timestamptz
          and coalesce(s.first_published_at, s.auto_published_at, s.published_at) < $2::timestamptz
        order by coalesce(s.first_published_at, s.auto_published_at, s.published_at) desc`,
      [w.from, w.to]
    ),
    q<{ company_slug: string; company_name: string; fact: string; value_text: string | null; url: string | null }>(
      `select f.company_slug, c.name as company_name, f.fact, f.value_text, ii.url
         from intel_facts f
         join intel_companies c on c.slug = f.company_slug
         left join intel_items ii on ii.id = f.item_id
        where f.created_at >= $1::timestamptz and f.created_at < $2::timestamptz
        order by f.company_slug, f.created_at desc`,
      [w.from, w.to]
    ),
    q<{ id: string; title: string; headline_claim: string | null; who_cares: { lens: string; note: string }[] | null }>(
      `select p.id, p.title, p.extraction->>'headline_claim' as headline_claim, p.extraction->'who_cares' as who_cares
         from papers p
        where p.review_status in ('tracked', 'noted')
          and p.created_at >= $1::timestamptz and p.created_at < $2::timestamptz
        order by p.created_at desc
        limit 8`,
      [w.from, w.to]
    ),
    one<{ coverage: { developments: { headline: string; url: string | null; covered: boolean }[] } | null }>(
      `select coverage from pipeline_runs
        where status = 'completed' and coverage is not null
          and triggered_at >= $1::timestamptz and triggered_at < $2::timestamptz
        order by triggered_at desc
        limit 1`,
      [w.from, w.to]
    ),
    one<{ n: number }>(`select count(*)::int as n from generated_reports where kind = 'edition'`),
  ]);

  // ---- story items ------------------------------------------------------

  const scanItems: StoryItem[] = scanRows.map((r) => ({
    id: `scan:${r.id}`, source: 'scan', headline: r.headline ?? r.url, url: r.url,
    domain: r.source_domain ?? domainOf(r.url) ?? '', tier: r.source_tier, contentKind: r.content_kind,
    relevance: r.relevance, publishedDate: r.published_date, summary: r.summary,
    entities: r.entities ?? [], tags: r.tags ?? [], href: null,
  }));
  const intelItems: StoryItem[] = intelRows.map((r) => ({
    id: `intel:${r.id}`, source: 'intel', headline: r.headline ?? r.url, url: r.url,
    domain: r.source_domain ?? domainOf(r.url) ?? '', tier: r.source_tier, contentKind: r.content_kind,
    relevance: r.significance, publishedDate: r.published_date, summary: r.summary,
    entities: r.entities ?? [], tags: r.dimensions ?? [], href: null,
  }));
  const candidateItems: StoryItem[] = candidateRows.map((r) => ({
    id: `pipeline:${r.id}`, source: 'pipeline', headline: r.headline ?? r.url, url: r.url,
    domain: r.source_domain ?? domainOf(r.url) ?? '', tier: null, contentKind: null,
    relevance: 0.7, publishedDate: r.published_date, summary: null, entities: [], tags: [],
    href: r.signal_id ? `/signals/${r.signal_id}` : null,
  }));
  const signalItems: StoryItem[] = signalRows.map((r) => ({
    id: `signal:${r.id}`, source: 'signal', headline: r.title, url: r.source_url ?? `/signals/${r.id}`,
    domain: domainOf(r.source_url) ?? '', tier: null, contentKind: null, relevance: 0.9,
    publishedDate: r.published_date, summary: r.summary, entities: [], tags: [], href: `/signals/${r.id}`,
  }));

  const allItems = [...scanItems, ...intelItems, ...candidateItems, ...signalItems];
  const clustersFull = clusterStories(allItems);
  const clusters = clustersFull.slice(0, 40).map((c) => ({ ...c, items: c.items.slice(0, 12) }));

  // ---- things happen (the ranked tail, 8..30) ---------------------------

  const thingsHappen: EditionThing[] = clustersFull.slice(7, 30).map((c) => ({
    headline: c.lead.headline, url: c.lead.url, domain: c.lead.domain, tier: c.lead.tier, href: c.lead.href,
  }));

  // ---- companies ----------------------------------------------------------

  const byCompany = new Map<string, { name: string; facts: EditionCompanyNote['facts'] }>();
  for (const f of factRows) {
    const entry = byCompany.get(f.company_slug) ?? { name: f.company_name, facts: [] };
    if (entry.facts.length < 4) entry.facts.push({ fact: f.fact, valueText: f.value_text, url: f.url });
    byCompany.set(f.company_slug, entry);
  }
  const companies: EditionCompanyNote[] = [...byCompany.entries()]
    .sort((a, b) => b[1].facts.length - a[1].facts.length)
    .slice(0, 6)
    .map(([companySlug, v]) => ({ companySlug, companyName: v.name, facts: v.facts }));

  // ---- papers -------------------------------------------------------------

  const papers: EditionPaper[] = paperRows.map((p) => ({
    id: p.id, title: p.title, href: `/research/${p.id}`,
    whoCares: p.who_cares && p.who_cares.length ? p.who_cares.map((w) => w.note).join(' ') : null,
    headlineClaim: p.headline_claim,
  }));

  // ---- tools (Mondays only) -----------------------------------------------

  let tools: EditionTool[] = [];
  if (isMonday) {
    // Dynamic import: lib/data/tooling.ts imports '../db' with no .ts
    // extension, which plain Node's ESM resolver cannot follow (verified:
    // extensionless relative specifiers 404 under node's type stripping).
    // A dynamic import is resolved only when this branch actually runs
    // (never under the pure test), so it never breaks that load.
    const { getNewEntrants } = await import('../data/tooling');
    const since = new Date(`${day}T00:00:00Z`);
    since.setUTCDate(since.getUTCDate() - 7);
    const entrants = await getNewEntrants(since.toISOString().slice(0, 10), { admin: false, portal: false }, { limit: 8 });
    tools = entrants.map((p) => ({
      slug: p.slug, name: p.name, vendor: p.vendor ?? p.vendor_domain ?? null,
      oneLiner: p.one_liner ?? null, href: `/tooling/${p.slug}`,
    }));
  }

  // ---- blind spots ----------------------------------------------------

  const blindSpots: EditionBlindSpot[] = (coverageRow?.coverage?.developments ?? [])
    .filter((d) => !d.covered)
    .slice(0, 6)
    .map((d) => ({ headline: d.headline, url: d.url ?? null }));

  // ---- sources rollup ---------------------------------------------------

  const sourceCounts = new Map<string, { tier: number | null; count: number }>();
  for (const it of allItems) {
    if (!it.domain) continue;
    const entry = sourceCounts.get(it.domain) ?? { tier: it.tier, count: 0 };
    entry.count += 1;
    if (entry.tier == null && it.tier != null) entry.tier = it.tier;
    sourceCounts.set(it.domain, entry);
  }
  const sources: EditionSourceRow[] = [...sourceCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 12)
    .map(([domain, v]) => ({ domain, tier: v.tier, count: v.count }));

  // ---- claims touched -----------------------------------------------------

  const codes = new Set<string>();
  for (const s of signalRows) for (const c of s.claim_touches ?? []) codes.add(c);
  let claimsTouched = await resolveClaimHrefs([...codes], signalRows);
  // A quiet day on the Signal Board leaves the column nothing to connect the
  // news to. Fill with standing anchors: the claims and bridges that gained
  // the most evidence in the last 30 days (guest-safe: codes, statements,
  // hrefs, no confidence).
  if (claimsTouched.length < 4) {
    const standing = await q<{ code: string; type: 'claim' | 'bridge_claim'; statement: string; n: number }>(
      `select c.code, 'claim'::text as type, c.statement, count(*)::int as n
         from claims c join evidence e on e.target_type = 'claim' and e.target_id = c.id
        where c.is_frame = false and e.created_at > now() - interval '30 days'
        group by c.code, c.statement
       union all
       select b.code, 'bridge_claim'::text as type, b.statement, count(*)::int as n
         from bridge_claims b join evidence e on e.target_type = 'bridge_claim' and e.target_id = b.id
        where e.created_at > now() - interval '30 days'
        group by b.code, b.statement
        order by n desc, code
        limit 40`
    );
    const have = new Set(claimsTouched.map((c) => c.code));
    const extra = standing
      .filter((r) => !have.has(r.code))
      .slice(0, 8 - claimsTouched.length)
      .map((r) => ({
        code: r.code, statement: r.statement,
        href: r.type === 'bridge_claim' ? `/bridge/${r.code}` : `/claim/${encodeURIComponent(r.code)}`,
        signalHrefs: [] as string[],
      }));
    claimsTouched = [...claimsTouched, ...extra];
  }

  // ---- numbers --------------------------------------------------------

  // Two free strips fetched at build time (no cron, no table): the Hacker
  // News front page filtered to AI, and the market basket. Either may come
  // back empty; the view omits what is missing.
  const [hn, markets] = await Promise.all([fetchHnAiFront(8), fetchMarketStrip()]);

  const outletSet = new Set(allItems.map((it) => it.domain).filter(Boolean));
  const numbers: EditionNumbers = {
    itemsRead: scanRows.length + intelRows.length + candidateRows.length,
    outlets: outletSet.size,
    signalsPublished: signalRows.length,
    papersKept: paperRows.length,
    newTools: isMonday ? tools.length : 0,
    clusters: clusters.length,
  };

  return {
    day,
    windowFrom: w.from,
    windowTo: w.to,
    issueNumber: (countRow?.n ?? 0) + 1,
    numbers,
    clusters,
    thingsHappen,
    companies,
    papers,
    tools,
    blindSpots,
    sources,
    claimsTouched,
    hn,
    markets,
    generatedAt: new Date().toISOString(),
  };
}

// Resolve claim/bridge-claim codes touched by this window's signals into
// their statements + hrefs, with the signal hrefs that carry each code (the
// resolvePeriodTouches idiom in lib/data/reports.ts, without the admin
// confidence_label — the pack is guest-safe by construction).
async function resolveClaimHrefs(
  codes: string[],
  signalRows: SignalRow[]
): Promise<EditionPack['claimsTouched']> {
  if (!codes.length) return [];
  const rows = await q<{ code: string; type: 'claim' | 'bridge_claim'; statement: string }>(
    `select code, 'claim'::text as type, statement from claims where code = any($1)
     union all
     select code, 'bridge_claim'::text as type, statement from bridge_claims where code = any($1)`,
    [codes]
  );
  const byCode = new Map(rows.map((r) => [r.code, r]));
  return codes
    .map((code) => {
      const r = byCode.get(code);
      if (!r) return null;
      const href = r.type === 'bridge_claim' ? `/bridge/${r.code}` : `/claim/${encodeURIComponent(r.code)}`;
      const signalHrefs = signalRows.filter((s) => (s.claim_touches ?? []).includes(code)).map((s) => `/signals/${s.id}`);
      return { code: r.code, statement: r.statement, href, signalHrefs };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

// ---------------------------------------------------------------- citation gate

// Every url/href the front + column legs may cite: every story item's
// external url, every signal/paper/tool/claim in-app href. Pure, DB-free —
// safe for scripts/test-edition-pack.mjs.
export function allowlistForEdition(pack: EditionPack): CitationAllowlist {
  const hrefs = new Set<string>();
  const tagByHref = new Map<string, string>();
  for (const c of pack.clusters) {
    for (const it of c.items) {
      hrefs.add(it.url);
      if (it.href) hrefs.add(it.href);
    }
  }
  for (const t of pack.thingsHappen) {
    hrefs.add(t.url);
    if (t.href) hrefs.add(t.href);
  }
  for (const p of pack.papers) hrefs.add(p.href);
  for (const t of pack.tools) hrefs.add(t.href);
  for (const c of pack.claimsTouched) {
    hrefs.add(c.href);
    for (const h of c.signalHrefs) hrefs.add(h);
    tagByHref.set(c.href, c.code);
  }
  for (const co of pack.companies) for (const f of co.facts) if (f.url) hrefs.add(f.url);
  for (const b of pack.blindSpots) if (b.url) hrefs.add(b.url);
  return { hrefs, tagByHref };
}

// ---------------------------------------------------------------- front validation

// What the model's submit_front tool returns, before validation: every field
// is untrusted input (the tool schema only guarantees the shape, not that
// clusterId names a real cluster or that goDeeperHref is one of its urls).
export interface RawFrontItem {
  clusterId?: unknown;
  headline?: unknown;
  why?: unknown;
  numbers?: unknown;
  goDeeperHref?: unknown;
}

export function goDeeperLabel(href: string): string {
  if (href.startsWith('/signals/')) return 'Read the signal';
  if (href.startsWith('/research/')) return 'Read the paper';
  if (href.startsWith('/tooling/')) return 'Read the product page';
  return 'Read the source';
}

// The deterministic backstop between the model's front-item picks and the
// rendered page (lib/edition/generate.ts's generateFront calls this after
// the model call; scripts/test-edition-pack.mjs exercises it directly, no
// model or DB involved). Drops items naming a cluster outside `clusters`,
// substitutes a goDeeperHref that is not one of that cluster's own item
// urls/hrefs with the cluster's lead href, and clamps the result to `n`.
export function validateFrontItems(
  clusters: StoryCluster[], raw: RawFrontItem[], n: number
): EditionFrontItem[] {
  const byId = new Map(clusters.map((c) => [c.id, c]));
  const out: EditionFrontItem[] = [];
  for (const it of raw) {
    const c = byId.get(typeof it.clusterId === 'string' ? it.clusterId : '');
    if (!c) continue;
    const allow = new Set<string>();
    for (const item of c.items) {
      allow.add(item.url);
      if (item.href) allow.add(item.href);
    }
    const leadHref = c.lead.href ?? c.lead.url;
    let href = typeof it.goDeeperHref === 'string' ? it.goDeeperHref : '';
    if (!allow.has(href)) href = leadHref;
    const numbersRaw = typeof it.numbers === 'string' ? deDash(it.numbers).trim() : '';
    out.push({
      clusterId: c.id,
      headline: deDash(typeof it.headline === 'string' && it.headline ? it.headline : c.lead.headline).trim(),
      why: deDash(typeof it.why === 'string' ? it.why : '').trim(),
      numbers: numbersRaw || null,
      goDeeperHref: href,
      goDeeperLabel: goDeeperLabel(href),
      coverage: coverageLine(c),
    });
    if (out.length >= n) break;
  }
  return out;
}

// The no-budget / no-model fallback (lib/edition/run.ts): the top n clusters
// by score, headline = lead headline, why = the lead's summary first
// sentence (or empty), numbers always null (never invented without a model).
export function deterministicFront(pack: EditionPack, n: number): EditionFrontItem[] {
  return pack.clusters.slice(0, Math.max(0, n)).map((c) => {
    const href = c.lead.href ?? c.lead.url;
    const firstSentence = c.lead.summary ? c.lead.summary.split(/(?<=[.!?])\s/)[0] : '';
    return {
      clusterId: c.id,
      headline: c.lead.headline,
      why: firstSentence,
      numbers: null,
      goDeeperHref: href,
      goDeeperLabel: goDeeperLabel(href),
      coverage: coverageLine(c),
    };
  });
}
