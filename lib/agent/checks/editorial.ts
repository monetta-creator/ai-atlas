import { q, one } from '../../db';
import { getMapHealth, getArgumentGapScan, getConceptGapScan } from '../../data';
import { remedyRef } from '../remedies';
import type { AgentCheck, FindingInput, Severity } from '../types';

// Editorial checks: the map's own upkeep (confidence upkeep, one-sided
// evidence, drifted signal touches, stale summaries and gap scans, sources
// with no reliability prior). Every check is pure SQL or a read of an
// existing data helper, never a model call; each catches its own error and
// returns [] so one bad query never takes the others down.

const DAY_MS = 24 * 60 * 60 * 1000;
const daysSince = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / DAY_MS);
};

// ---------------------------------------------------------------- untouched
// A claim/bridge that has kept accumulating evidence since its confidence
// last moved (or has never moved at all) is the single most common way the
// map goes stale: the record grows, the number stops meaning anything.
interface UntouchedRow {
  code: string;
  kind: 'claim' | 'bridge_claim';
  new_count: number;
  never_moved: boolean;
  last_moved: string | null;
}

async function checkUntouched(): Promise<FindingInput[]> {
  try {
    const rows = await q<UntouchedRow>(`
      with targets as (
        select c.id, c.code, 'claim'::text as kind from claims c
         where c.is_frame = false and c.code is not null
         union all
        select b.id, b.code, 'bridge_claim'::text as kind from bridge_claims b
         where b.code is not null
      ),
      moved as (
        select target_type::text as target_type, target_id, max(created_at) as last_moved
          from rationales
         where target_type in ('claim', 'bridge_claim')
         group by target_type, target_id
      )
      select t.code, t.kind,
             count(ev.id) filter (
               where ev.created_at > coalesce(m.last_moved, '-infinity'::timestamptz)
             )::int as new_count,
             (m.last_moved is null) as never_moved,
             to_char(m.last_moved, 'YYYY-MM-DD') as last_moved
        from targets t
        left join evidence ev on ev.target_type = t.kind::node_t and ev.target_id = t.id
        left join moved m on m.target_type = t.kind and m.target_id = t.id
       group by t.code, t.kind, m.last_moved
      having count(ev.id) filter (
               where ev.created_at > coalesce(m.last_moved, '-infinity'::timestamptz)
             ) >= 5
       order by 3 desc
       limit 50
    `);

    const findings: FindingInput[] = [];
    for (const r of rows) {
      const warnAt = r.never_moved ? 8 : 5;
      if (r.new_count < warnAt) continue;
      // A claim that has never left the seed default is a standing editorial
      // debt, not an alarm: warn. High is reserved for a confidence Kevin DID
      // set that the evidence has since outrun by a wide margin.
      const severity: Severity = !r.never_moved && r.new_count >= 12 ? 'high' : 'warn';
      const href = r.kind === 'claim' ? `/claim/${r.code}` : `/bridge/${r.code}`;
      const noun = r.kind === 'claim' ? 'Claim' : 'Bridge-claim';
      const title = r.never_moved
        ? `${noun} ${r.code} has ${r.new_count} evidence rows and has never moved`
        : `${noun} ${r.code} has ${r.new_count} new evidence rows since its last move`;
      const detail = r.never_moved
        ? `${r.new_count} pieces of evidence sit against ${r.code} and its confidence has never left the seed default. Moving the confidence is yours alone.`
        : `${r.new_count} pieces of evidence have arrived since ${r.code}'s confidence last moved on ${r.last_moved}. Moving the confidence is yours alone.`;
      findings.push({
        key: `editorial.untouched:${r.code}`,
        checkKey: 'editorial.untouched',
        subject: r.code,
        severity,
        title,
        detail,
        metric: { code: r.code, kind: r.kind, newCount: r.new_count, neverMoved: r.never_moved, lastMoved: r.last_moved },
        href,
        remedy: null,
      });
      if (findings.length >= 10) break;
    }
    return findings;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- one-sided
async function checkOneSided(): Promise<FindingInput[]> {
  try {
    const health = await getMapHealth(true);
    if (!health.oneSided) return [];
    return [
      {
        key: 'editorial.one_sided',
        checkKey: 'editorial.one_sided',
        subject: null,
        severity: 'info',
        title: `${health.oneSided} claim${health.oneSided === 1 ? '' : 's'} on the map ${health.oneSided === 1 ? 'has' : 'have'} only one-sided evidence`,
        detail: `${health.oneSided} claim${health.oneSided === 1 ? '' : 's'} carry two or more evidence rows all pointing the same direction, with no opposing read on record. A one-sided claim is a candidate for a steelman pass, not necessarily a wrong one.`,
        metric: { oneSided: health.oneSided },
        href: '/map',
        remedy: null,
      },
    ];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- dangling touches
interface SignalTouchRow {
  id: string;
  title: string;
  claim_touches: string[];
}
interface LiveCodeRow {
  code: string;
}

async function checkDanglingTouches(): Promise<FindingInput[]> {
  try {
    const [signals, codes] = await Promise.all([
      q<SignalTouchRow>(
        `select id, title, claim_touches
           from signals
          where is_published = true and array_length(claim_touches, 1) > 0`
      ),
      q<LiveCodeRow>(
        `select code from claims where code is not null
         union
         select code from bridge_claims where code is not null`
      ),
    ]);
    const live = new Set(codes.map((c) => c.code));
    const dangling: { code: string; signalId: string; signalTitle: string }[] = [];
    for (const s of signals) {
      for (const code of s.claim_touches) {
        if (!live.has(code)) dangling.push({ code, signalId: s.id, signalTitle: s.title });
      }
    }
    if (!dangling.length) return [];
    const shown = dangling.slice(0, 5);
    const detail = `${dangling.length} published signal touch${dangling.length === 1 ? '' : 'es'} point at a code with no live claim or bridge-claim: ${shown
      .map((d) => `${d.code} ("${d.signalTitle}")`)
      .join(', ')}${dangling.length > shown.length ? ', and more' : ''}. The claim or bridge behind these was likely renamed or deleted; the signal needs its touches fixed.`;
    return [
      {
        key: 'editorial.dangling_touches',
        checkKey: 'editorial.dangling_touches',
        subject: null,
        severity: 'warn',
        title: `${dangling.length} signal touch${dangling.length === 1 ? '' : 'es'} point at a code that no longer exists`,
        detail,
        metric: { count: dangling.length, items: shown },
        href: `/signals/${shown[0].signalId}`,
        remedy: null,
      },
    ];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- stale question summaries
interface QuestionEvidenceRow {
  id: string;
  slug: string;
  title: string;
  evidence_count: number;
  latest_evidence: string | null;
  latest_summary: string | null;
}

async function checkSummaryStale(): Promise<FindingInput[]> {
  try {
    const rows = await q<QuestionEvidenceRow>(`
      with q_evidence as (
        select s.question_id,
               max(ev.created_at) as latest_evidence,
               count(ev.id)::int as evidence_count
          from evidence ev
          join claims c on c.id = ev.target_id and ev.target_type = 'claim'
          join edges e on e.from_type = 'claim' and e.from_id = c.id and e.to_type = 'stance'
          join stances s on s.id = e.to_id
         group by s.question_id
      ),
      q_summary as (
        select question_id, max(created_at) as latest_summary
          from question_summaries
         group by question_id
      )
      select q.id, q.slug, q.title,
             coalesce(qe.evidence_count, 0) as evidence_count,
             to_char(qe.latest_evidence, 'YYYY-MM-DD') as latest_evidence,
             to_char(qs.latest_summary, 'YYYY-MM-DD') as latest_summary
        from questions q
        left join q_evidence qe on qe.question_id = q.id
        left join q_summary qs on qs.question_id = q.id
    `);

    const findings: FindingInput[] = [];
    for (const r of rows) {
      if (!r.evidence_count) continue;
      const never = !r.latest_summary;
      if (never && r.evidence_count < 10) continue;
      if (!never && r.latest_evidence) {
        // Stale = the newest evidence arrived more than 30 days after the latest summary.
        const summaryMs = new Date(r.latest_summary as string).getTime();
        const evidenceMs = new Date(r.latest_evidence).getTime();
        const gapDays = Math.floor((evidenceMs - summaryMs) / DAY_MS);
        if (gapDays <= 30) continue;
      } else if (!never) {
        continue;
      }
      const title = never
        ? `No state summary for "${r.slug}" (${r.evidence_count} evidence rows)`
        : `Summary for "${r.slug}" predates its newest evidence`;
      const detail = never
        ? `${r.evidence_count} pieces of evidence sit under this question and it has never had a state summary generated. A fresh summary would give the question a current one-pager.`
        : `The newest evidence under this question arrived on ${r.latest_evidence}, well after the last summary was generated on ${r.latest_summary}. The summary no longer reflects the record.`;
      findings.push({
        key: `editorial.summary_stale:${r.slug}`,
        checkKey: 'editorial.summary_stale',
        subject: r.slug,
        severity: 'info',
        title,
        detail,
        metric: { slug: r.slug, evidenceCount: r.evidence_count, latestEvidence: r.latest_evidence, latestSummary: r.latest_summary },
        href: `/q/${r.slug}/summary`,
        remedy: remedyRef('editorial.summarize', `Regenerate the summary for ${r.title}`, { questionId: r.id }),
      });
    }
    return findings;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- sources with no reliability prior
async function checkSourcesNoPrior(): Promise<FindingInput[]> {
  try {
    const row = await one<{ n: number }>(`select count(*)::int as n from sources where reliability_prior is null`);
    const n = row?.n ?? 0;
    if (n <= 10) return [];
    return [
      {
        key: 'editorial.sources_no_prior',
        checkKey: 'editorial.sources_no_prior',
        subject: null,
        severity: 'info',
        title: `${n} sources have no reliability prior set`,
        detail: `${n} sources in the library carry no reliability prior. The prior is author-set, never inferred, so this is a straight backlog: work through the source library and set one for each.`,
        metric: { count: n },
        href: '/sources',
        remedy: null,
      },
    ];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- stale gap scans
async function checkGapScanStale(): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];
  try {
    const scan = await getArgumentGapScan();
    const age = scan ? daysSince(scan.generatedAt) : null;
    if (!scan || age === null || age > 30) {
      findings.push({
        key: 'editorial.gap_scan_stale:argument',
        checkKey: 'editorial.gap_scan_stale',
        subject: 'argument',
        severity: 'info',
        title: scan ? `The argument-map gap scan is ${age} days old` : 'The argument-map gap scan has never run',
        detail: scan
          ? `The last argument-map gap diagnosis ran ${age} days ago, past the 30 day mark. A fresh pass may surface claims or bridges worth adding.`
          : 'No argument-map gap diagnosis has ever run. A first pass would surface claims or bridges the map is missing.',
        metric: { generatedAt: scan?.generatedAt ?? null, ageDays: age },
        href: '/map',
        remedy: remedyRef('gaps.diagnose_argument', 'Diagnose gaps in the argument map'),
      });
    }
  } catch {
    // fall through to the concept half
  }
  try {
    const scan = await getConceptGapScan();
    const age = scan ? daysSince(scan.generatedAt) : null;
    if (!scan || age === null || age > 30) {
      findings.push({
        key: 'editorial.gap_scan_stale:concept',
        checkKey: 'editorial.gap_scan_stale',
        subject: 'concept',
        severity: 'info',
        title: scan ? `The concept gap scan is ${age} days old` : 'The concept gap scan has never run',
        detail: scan
          ? `The last concept-scaffold gap diagnosis ran ${age} days ago, past the 30 day mark. A fresh pass may surface missing prerequisite concepts.`
          : 'No concept-scaffold gap diagnosis has ever run. A first pass would surface concepts the scaffold is missing.',
        metric: { generatedAt: scan?.generatedAt ?? null, ageDays: age },
        href: '/concepts',
        remedy: remedyRef('gaps.diagnose_concept', 'Diagnose gaps in the concept scaffold'),
      });
    }
  } catch {
    // best-effort: the argument half above still stands
  }
  return findings;
}

export const EDITORIAL_CHECKS: AgentCheck[] = [
  { key: 'editorial.untouched', title: 'Claims and bridges with evidence outrunning their confidence', domain: 'editorial', run: checkUntouched },
  { key: 'editorial.one_sided', title: 'Claims with only one-sided evidence', domain: 'editorial', run: checkOneSided },
  { key: 'editorial.dangling_touches', title: 'Published signals touching a dead claim/bridge code', domain: 'editorial', run: checkDanglingTouches },
  { key: 'editorial.summary_stale', title: 'Question state summaries out of date', domain: 'editorial', run: checkSummaryStale },
  { key: 'editorial.sources_no_prior', title: 'Sources with no reliability prior', domain: 'editorial', run: checkSourcesNoPrior },
  { key: 'editorial.gap_scan_stale', title: 'Stale gap-diagnosis scans', domain: 'editorial', run: checkGapScanStale },
];
