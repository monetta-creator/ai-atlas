// The daily edition's pack builder (Task 4). Reads across the four collection
// engines (scan, intel, pipeline, research) plus the tooling monitor and
// assembles a guest-safe EditionPack: headlines, urls, outlets, tiers,
// summaries and in-app hrefs only, never review notes, raw text or admin
// columns (the roundup/tooling-report discipline, lib/research/roundup.ts).
//
// The pure helpers (windowFor, allowlistForEdition, the front validators)
// live in ./pure.ts; this module owns the DB reads.

import { q, one } from '../db.ts';
import { clusterStories } from './cluster.ts';
import { isAiStory, cleanBlindSpots } from './desks.ts';
import { fetchHnAiFront } from './hn.ts';
import { fetchMarketStrip } from './markets.ts';
import { windowFor, thingsHappenFor, industryFor, priorFrontFrom, penalizeRepeats } from './pure.ts';
import { rateDomainByRule } from '../scan/source-tiers.ts';
import type { StoryItem } from './cluster';
import type {
  EditionPack, EditionNumbers, EditionPaper, EditionTool, EditionSourceRow,
} from './types';

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

// ---------------------------------------------------------------- story items

// The four collection engines' items in the window, projected to StoryItem
// and returned alongside their raw rows (buildEditionPack still needs the
// row counts for `numbers`, and signalRows for the claims-touched query).
// Split out so a caller that only needs the clustered items (none today, but
// mirrors the tooling engine's read/build split) never re-derives the rows.
export async function loadStoryItems(day: string): Promise<{
  items: StoryItem[];
  scanRows: ScanRow[];
  intelRows: IntelRow[];
  candidateRows: CandidateRow[];
  signalRows: SignalRow[];
}> {
  const w = windowFor(day);

  const [scanRows, intelRows, candidateRows, signalRows] = await Promise.all([
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
    // Window on first_published_at (0059), when the signal went public, not
    // published_at, the editorial date: pipeline drafts carry the article's
    // date and are published hours or days later, by a human or the promotion
    // policy. Every publishing writer stamps it and 0059 backfilled the rest.
    q<SignalRow>(
      `select s.id, s.title, s.summary, to_char(s.published_at, 'YYYY-MM-DD') as published_date,
              s.claim_touches, src.url as source_url
         from signals s
         left join sources src on src.id = s.source_id
        where s.is_published = true
          and s.first_published_at >= $1::timestamptz
          and s.first_published_at < $2::timestamptz
        order by s.first_published_at desc`,
      [w.from, w.to]
    ),
  ]);

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

  // Pipeline candidates and published signals carry no source_tier of their
  // own (the scan/intel engines stamp theirs at collection), so a third of
  // Things happen printed with no tier chip. Rate their domains the same way
  // the engines do: the pure rules first, then the model-rated source_tiers
  // table for the long tail; a domain neither knows stays null.
  const untiered = [...candidateItems, ...signalItems].filter((it) => it.tier == null && it.domain);
  if (untiered.length) {
    const byRule = new Map<string, number | null>();
    for (const it of untiered) if (!byRule.has(it.domain)) byRule.set(it.domain, rateDomainByRule(it.domain)?.tier ?? null);
    const unknown = [...byRule.entries()].filter(([, t]) => t == null).map(([d]) => d);
    if (unknown.length) {
      const rows = await q<{ domain: string; tier: number }>(
        `select domain, tier from source_tiers where domain = any($1)`,
        [unknown]
      );
      for (const r of rows) byRule.set(r.domain, r.tier);
    }
    for (const it of untiered) it.tier = byRule.get(it.domain) ?? null;
  }

  const items = [...scanItems, ...intelItems, ...candidateItems, ...signalItems];
  return { items, scanRows, intelRows, candidateRows, signalRows };
}

// ---------------------------------------------------------------- pack builder

export async function buildEditionPack(day: string): Promise<EditionPack> {
  const w = windowFor(day);
  const isMonday = new Date(`${day}T00:00:00Z`).getUTCDay() === 1;

  const [{ items: allItems, scanRows, intelRows, candidateRows, signalRows }, paperRows, coverageRow, countRow, papersKeptRow] =
    await Promise.all([
      loadStoryItems(day),
      // The research engine's analyze step extracts findings from agent-positive
      // kept papers the same day they arrive; a human review_status lands days
      // later, so a same-day tracked/noted predicate read 0 every edition. Read
      // the engine-analyzed papers in the window instead, human-confirmed first,
      // and never one a human dismissed (an explicit "no" recorded with a why).
      q<{ id: string; title: string; headline_claim: string | null; who_cares: { lens: string; note: string }[] | null }>(
        `select p.id, p.title, p.extraction->>'headline_claim' as headline_claim, p.extraction->'who_cares' as who_cares
           from papers p
          where p.triage_status = 'kept' and p.extraction is not null
            and p.review_status <> 'dismissed'
            and p.created_at >= $1::timestamptz and p.created_at < $2::timestamptz
          order by (p.review_status in ('tracked','noted')) desc, p.created_at desc
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
      // The unpaginated twin of the 8-row paperRows query above: `numbers`
      // reports every paper the engine analyzed in the window, not just the
      // 8 the strip has room to list.
      one<{ n: number }>(
        `select count(*)::int as n from papers p
          where p.triage_status = 'kept' and p.extraction is not null
            and p.review_status <> 'dismissed'
            and p.created_at >= $1::timestamptz and p.created_at < $2::timestamptz`,
        [w.from, w.to]
      ),
    ]);

  // ---- clustering + repeat penalty ---------------------------------------

  const clustersRanked = clusterStories(allItems);
  // Dynamic import, resolved every build: lib/data/editions.ts imports '../db'
  // with no .ts extension, which plain Node's ESM resolver cannot follow (the
  // tooling branch below does the same for the same reason).
  const { getRecentEditions } = await import('../data/editions');
  const recentEditions = await getRecentEditions(day, 2);
  const prior = priorFrontFrom(recentEditions);
  const clustersFull = penalizeRepeats(clustersRanked, prior);
  const clusters = clustersFull.slice(0, 40).map((c) => ({ ...c, items: c.items.slice(0, 12) }));

  // ---- things happen + the industry --------------------------------------

  // The ranked tail after the default 7-item front; runDailyEdition rebuilds
  // it against the actual front picks.
  const frontExclude = new Set(clustersFull.slice(0, 7).map((c) => c.id));
  const thingsHappen = thingsHappenFor(clustersFull, frontExclude);
  const industry = industryFor(clustersFull, frontExclude);

  // ---- papers -------------------------------------------------------------

  const papers: EditionPaper[] = paperRows.map((p) => ({
    id: p.id, title: p.title, href: `/research/${p.id}`,
    whoCares: p.who_cares && p.who_cares.length ? p.who_cares.map((w) => w.note).join(' ') : null,
    headlineClaim: p.headline_claim,
  }));

  // ---- tools (Mondays only) -----------------------------------------------

  let tools: EditionTool[] = [];
  if (isMonday) {
    // Dynamic import, resolved only when this branch runs: lib/data/tooling.ts
    // imports '../db' with no .ts extension, which plain Node's ESM resolver
    // cannot follow. Nothing pure loads this module any more (./pure.ts holds
    // that half), so this is now only a cheap lazy load.
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

  const blindSpots = cleanBlindSpots(coverageRow?.coverage?.developments ?? []);

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
  // Counted over clustersFull (every cluster, before the 40-cap slice) so a
  // heavy AI day that pushes non-AI clusters past the cap still reports the
  // true count.
  const aiClusterCount = clustersFull.filter(
    (c) => isAiStory(c.lead) || c.items.some((it) => isAiStory(it))
  ).length;
  const numbers: EditionNumbers = {
    itemsRead: scanRows.length + intelRows.length + candidateRows.length,
    outlets: outletSet.size,
    signalsPublished: signalRows.length,
    papersKept: papersKeptRow?.n ?? paperRows.length,
    newTools: isMonday ? tools.length : 0,
    clusters: aiClusterCount,
  };

  return {
    day,
    windowFrom: w.from,
    windowTo: w.to,
    issueNumber: (countRow?.n ?? 0) + 1,
    numbers,
    clusters,
    thingsHappen,
    industry,
    papers,
    tools,
    blindSpots,
    sources,
    claimsTouched,
    hn,
    markets,
    priorFront: recentEditions.map((e) => ({ day: e.day, headlines: e.narrative.front.map((f) => f.headline) })),
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
