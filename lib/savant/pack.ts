import { q, one } from '../db';
import { loadEditionPapers, loadBuilders } from '../edition/pack';
import type { EditionBuilderRead, EditionTool } from '../edition/types';
import { getNotebook, getOpenHypotheses, getSelfCompany } from '../data/savant';
import { countSavantIssues, getSavantIssue } from '../data/savant-issues';
import { buildPeers } from './peers';
import { upcomingFromCorpus } from './calendar';
import { issueWindow } from './week';
import type {
  AnomalyPayload, ConnectionPayload, EchoPayload, MissPayload, NotePayload, PlanPayload,
  SavantBrief, SavantMoved, SavantPack, MovedClaim,
} from './types';

// Savant's issue pack (2026-09-26): the frozen data half of a Friday issue.
// Key-gated content (it names tracked companies), still built with the
// edition's discipline: headlines, urls, hrefs, counts and public metrics,
// never review notes, raw text, rigor priors, agent stamps or admin free
// text. The notebook rows are the week's research; the rest is the week's
// record read once more, per department.

const LENSES = ['market', 'labor', 'geopolitics', 'regulatory', 'capability', 'society'];

function domainOf(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

// Every evidence read here excludes rows carried by a backfill-origin signal
// (the left join lets source-anchored evidence with no signal_id through
// unaffected): those drafts are a separate batch a human reviews on purpose,
// and their evidence would otherwise flood a week's "what moved" with
// years-old moves the day the backlog gets a publish pass.
async function loadMoved(w: { from: string; to: string }): Promise<SavantMoved> {
  const [dir, lens, claims, signals] = await Promise.all([
    q<{ direction: string; n: number }>(
      `select e.direction::text as direction, count(*)::int as n from evidence e
         left join signals s on s.id = e.signal_id
        where e.created_at >= $1::timestamptz and e.created_at < $2::timestamptz
          and coalesce(s.origin::text, '') <> 'backfill'
        group by 1`,
      [w.from, w.to]
    ),
    q<{ lens: string | null; n: number }>(
      `select e.lens::text as lens, count(*)::int as n from evidence e
         left join signals s on s.id = e.signal_id
        where e.created_at >= $1::timestamptz and e.created_at < $2::timestamptz
          and coalesce(s.origin::text, '') <> 'backfill'
        group by 1`,
      [w.from, w.to]
    ),
    q<MovedClaim>(
      `select t.code, t.statement, t.href, count(*)::int as evidence,
              count(*) filter (where e.direction = 'supports')::int as supports,
              count(*) filter (where e.direction = 'contradicts')::int as contradicts
         from evidence e
         left join signals s on s.id = e.signal_id
         join lateral (
           select c.code, c.statement, '/claim/' || c.code as href from claims c where e.target_type = 'claim' and c.id = e.target_id
           union all
           select b.code, b.statement, '/bridge/' || b.code as href from bridge_claims b where e.target_type = 'bridge_claim' and b.id = e.target_id
         ) t on true
        where e.created_at >= $1::timestamptz and e.created_at < $2::timestamptz
          and coalesce(s.origin::text, '') <> 'backfill'
        group by t.code, t.statement, t.href
        order by evidence desc, t.code
        limit 10`,
      [w.from, w.to]
    ),
    q<{ id: string; title: string; lenses: string[]; significance: string; published_date: string | null; url: string | null }>(
      `select s.id::text as id, s.title, s.lenses::text[] as lenses, s.significance::text as significance,
              to_char(s.first_published_at, 'YYYY-MM-DD') as published_date, src.url
         from signals s left join sources src on src.id = s.source_id
        where s.is_published and s.origin <> 'backfill'
          and s.first_published_at >= $1::timestamptz and s.first_published_at < $2::timestamptz
        order by (s.significance = 'high') desc, s.first_published_at desc
        limit 30`,
      [w.from, w.to]
    ),
  ]);
  const evidenceByDirection = { supports: 0, contradicts: 0, neutral: 0 };
  for (const d of dir) if (d.direction in evidenceByDirection) evidenceByDirection[d.direction as keyof typeof evidenceByDirection] = d.n;
  const evidenceByLens: Record<string, number> = {};
  for (const l of lens) evidenceByLens[l.lens ?? 'unassigned'] = l.n;
  const signalsByLens: Record<string, number> = Object.fromEntries(LENSES.map((l) => [l, 0]));
  for (const s of signals) for (const l of s.lenses ?? []) signalsByLens[l] = (signalsByLens[l] ?? 0) + 1;
  return {
    evidenceByDirection,
    evidenceByLens,
    signalsByLens,
    topClaims: claims,
    signals: signals.map((s) => ({
      title: s.title, url: s.url, href: `/signals/${s.id}`, domain: domainOf(s.url), date: s.published_date,
      lens: s.lenses?.[0] ?? null, kind: 'signal' as const,
    })),
  };
}

async function loadRegulation(w: { from: string; to: string }): Promise<SavantBrief[]> {
  const [sig, scan] = await Promise.all([
    q<{ id: string; title: string; published_date: string | null; url: string | null }>(
      `select s.id::text as id, s.title, to_char(s.first_published_at, 'YYYY-MM-DD') as published_date, src.url
         from signals s left join sources src on src.id = s.source_id
        where s.is_published and s.origin <> 'backfill' and 'regulatory' = any(s.lenses)
          and s.first_published_at >= $1::timestamptz and s.first_published_at < $2::timestamptz
        order by (s.significance = 'high') desc, s.first_published_at desc limit 8`,
      [w.from, w.to]
    ),
    q<{ id: string; headline: string | null; url: string; source_domain: string | null; published_date: string | null }>(
      `select si.id::text as id, si.headline, si.url, si.source_domain, to_char(si.published_date, 'YYYY-MM-DD') as published_date
         from scan_items si join scan_topics t on t.slug = si.topic_slug
        where t.taxonomy_code like '2.%' and coalesce(si.relevance, 0) >= 0.6
          and (si.source_tier is null or si.source_tier <= 2)
          and si.created_at >= $1::timestamptz and si.created_at < $2::timestamptz
        order by si.relevance desc nulls last limit 10`,
      [w.from, w.to]
    ),
  ]);
  const out: SavantBrief[] = [
    ...sig.map((s) => ({ title: s.title, url: s.url, href: `/signals/${s.id}`, domain: domainOf(s.url), date: s.published_date, lens: 'regulatory', kind: 'signal' as const })),
    ...scan.map((s) => ({ title: s.headline ?? s.url, url: s.url, href: null, domain: s.source_domain ?? domainOf(s.url), date: s.published_date, kind: 'scan_item' as const })),
  ];
  const seen = new Set<string>();
  return out.filter((b) => { const k = (b.url ?? b.href ?? b.title).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
}

async function loadToolsAndReads(w: { from: string; to: string }): Promise<SavantPack['tools']> {
  const { getNewEntrants } = await import('../data/tooling');
  const entrants = await getNewEntrants(w.from.slice(0, 10), { admin: false, portal: true }, { untilISO: w.to.slice(0, 10), limit: 8 });
  const tools: EditionTool[] = entrants.map((p) => ({
    slug: p.slug, name: p.name, vendor: p.vendor ?? p.vendor_domain ?? null, oneLiner: p.one_liner ?? null, href: `/tooling/${p.slug}`,
  }));
  const b = await loadBuilders(w, [], []);
  // The week's editions already judged the builder reads; take the union.
  const rows = await q<{ reads: EditionBuilderRead[] | null }>(
    `select pack->'builders'->'reads' as reads from generated_reports
      where kind = 'edition' and scope_to > $1::date and scope_to <= $2::date order by scope_to desc`,
    [w.from.slice(0, 10), w.to.slice(0, 10)]
  );
  const seen = new Set<string>();
  const reads: EditionBuilderRead[] = [];
  for (const r of rows) for (const read of r.reads ?? []) {
    const k = read.url ?? read.hnUrl;
    if (seen.has(k)) continue;
    seen.add(k);
    reads.push(read);
    if (reads.length >= 10) break;
  }
  return { entrants: tools, releases: b.releases, reads };
}

export async function buildSavantPack(weekEnd: string): Promise<SavantPack> {
  const w = issueWindow(weekEnd);
  const [notebook, openHyps, self, existing, count, moved, peers, regulation, research, researchKept, tools, ahead, counts, sources, mapHrefs] =
    await Promise.all([
      getNotebook(weekEnd),
      getOpenHypotheses(),
      getSelfCompany(),
      getSavantIssue(weekEnd),
      countSavantIssues(),
      loadMoved(w),
      buildPeers(w),
      loadRegulation(w),
      loadEditionPapers(w, 8),
      one<{ n: number }>(
        `select count(*)::int as n from papers p
          where p.triage_status = 'kept' and p.extraction is not null and p.review_status <> 'dismissed'
            and p.origin <> 'backfill'
            and p.created_at >= $1::timestamptz and p.created_at < $2::timestamptz`,
        [w.from, w.to]
      ),
      loadToolsAndReads(w),
      upcomingFromCorpus(w, weekEnd, 30),
      one<{ items: number; outlets: number; papers: number; evidence: number; companies: number }>(
        `select
           (select count(*) from scan_items where created_at >= $1::timestamptz and created_at < $2::timestamptz)
         + (select count(*) from intel_items where created_at >= $1::timestamptz and created_at < $2::timestamptz)
         + (select count(*) from signal_candidates where created_at >= $1::timestamptz and created_at < $2::timestamptz and triage_status = 'approved') as items,
           (select count(distinct d) from (
              select source_domain as d from scan_items where created_at >= $1::timestamptz and created_at < $2::timestamptz and source_domain is not null
              union select source_domain from intel_items where created_at >= $1::timestamptz and created_at < $2::timestamptz and source_domain is not null) x) as outlets,
           (select count(*) from papers where created_at >= $1::timestamptz and created_at < $2::timestamptz and triage_status = 'kept' and origin <> 'backfill') as papers,
           (select count(*) from evidence e left join signals s on s.id = e.signal_id
             where e.created_at >= $1::timestamptz and e.created_at < $2::timestamptz and coalesce(s.origin::text, '') <> 'backfill') as evidence,
           (select count(distinct company_slug) from intel_items where created_at >= $1::timestamptz and created_at < $2::timestamptz) as companies`,
        [w.from, w.to]
      ),
      q<{ domain: string; count: number }>(
        `select d as domain, count(*)::int as count from (
           select source_domain as d from scan_items where created_at >= $1::timestamptz and created_at < $2::timestamptz and coalesce(relevance, 0) >= 0.55
           union all select source_domain from intel_items where created_at >= $1::timestamptz and created_at < $2::timestamptz
         ) x where d is not null group by d order by count desc limit 16`,
        [w.from, w.to]
      ),
      q<{ href: string; code: string; statement: string }>(
        `select '/claim/' || code as href, code, statement from claims where is_frame = false
         union all select '/bridge/' || code as href, code, statement from bridge_claims
         union all select '/q/' || qu.slug as href, st.code, st.title as statement from stances st join questions qu on qu.id = st.question_id
         order by 2`
      ),
    ]);

  const byKind = <P,>(kind: string): P[] => notebook.filter((r) => r.kind === kind).map((r) => r.payload as P);
  const plan = byKind<PlanPayload>('plan')[0] ?? null;
  const notes = notebook.filter((r) => r.kind === 'note').map((r) => ({ day: r.day, text: (r.payload as NotePayload).text }));
  const connections = byKind<ConnectionPayload>('connection').sort((a, b) => b.sim - a.sim);
  const echoes = byKind<EchoPayload>('echo');
  const anomalies = byKind<AnomalyPayload>('anomaly');
  // A miss is a week-level fact; the same topic on several days prints once.
  const missSeen = new Set<string>();
  const misses = byKind<MissPayload>('miss').filter((m) => { const k = `${m.kind}:${m.headline}`; if (missSeen.has(k)) return false; missSeen.add(k); return true; });

  const fresh = openHyps.find((h) => h.posed_week === weekEnd) ?? null;
  const open = openHyps.filter((h) => h.posed_week !== weekEnd);

  return {
    weekEnd,
    windowFrom: w.from,
    windowTo: w.to,
    issueNumber: existing ? (existing.pack.issueNumber ?? count) : count + 1,
    self,
    plan,
    hypotheses: { fresh, open },
    notebook: { notes, connections, echoes, anomalies, misses },
    moved,
    peers,
    regulation,
    research,
    researchKept: researchKept?.n ?? research.length,
    tools,
    ahead,
    numbers: {
      itemsRead: Number(counts?.items ?? 0),
      outlets: Number(counts?.outlets ?? 0),
      signals: moved.signals.length,
      papers: Number(counts?.papers ?? 0),
      evidence: Number(counts?.evidence ?? 0),
      connections: connections.length,
      anomalies: anomalies.length,
      companies: Number(counts?.companies ?? 0),
    },
    sources,
    mapHrefs,
    generatedAt: new Date().toISOString(),
  };
}
