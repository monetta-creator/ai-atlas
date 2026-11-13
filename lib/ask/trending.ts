// What is moving in the Atlas right now, for the Ask empty state's tabs
// (2026-11-12). Computed from the records, no model call: each card opens
// its record in the peek (free) or seeds an Ask question.
//
// Guest safety: every tab is public. Signals show titles (never
// touch_details), map questions show evidence direction counts (never
// confidences), papers show arXiv facts (never triage or agent output).
// Company news was tried and left out: intel significance is about the
// company, not AI, and its headlines name tracked companies (keyholder only).
import { q } from '../db';
import type { PeekKind } from './search';

export type TrendingTabKey = 'signals' | 'debates' | 'research';

export interface TrendingCard {
  kind: PeekKind;
  id: string;
  title: string;
  meta: string;
  ask: string;
  badge?: string;
  // Evidence direction split, debates only.
  split?: { sup: number; con: number; other: number };
}

export interface TrendingTab {
  key: TrendingTabKey;
  label: string;
  blurb: string;
  cards: TrendingCard[];
}

const fmtDay = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

async function signals(): Promise<TrendingCard[]> {
  const rows = await q<{ id: string; title: string; day: string | null; touches: number }>(
    `select id::text as id, title, to_char(published_at, 'YYYY-MM-DD') as day,
            coalesce(array_length(claim_touches, 1), 0) as touches
       from signals
      where is_published and archived_at is null and published_at > now() - interval '21 days'
      order by published_at desc, coalesce(array_length(claim_touches, 1), 0) desc
      limit 9`
  );
  return rows.map((r) => ({
    kind: 'signal',
    id: r.id,
    title: r.title,
    meta: [fmtDay(r.day), r.touches ? `bears on ${plural(r.touches, 'claim')}` : ''].filter(Boolean).join(' · '),
    ask: `Why does this matter for a regulated bank: "${clip(r.title, 200)}"?`,
  }));
}

// Map questions ranked by evidence added in the last 14 days; "Rising" when
// that beats the 14 days before by half again (and is not tiny).
async function debates(): Promise<TrendingCard[]> {
  const rows = await q<{ slug: string; title: string; n: number; prev: number; sup: number; con: number }>(
    `with ev as (
       select distinct e.id, e.direction, e.created_at, st.question_id
         from evidence e
         join edges ed on ed.from_type = 'claim' and ed.from_id = e.target_id and ed.to_type = 'stance'
         join stances st on st.id = ed.to_id
        where e.target_type = 'claim' and e.created_at > now() - interval '28 days'
     )
     select qu.slug, qu.title,
            count(distinct ev.id) filter (where ev.created_at > now() - interval '14 days')::int as n,
            count(distinct ev.id) filter (where ev.created_at <= now() - interval '14 days')::int as prev,
            count(distinct ev.id) filter (where ev.created_at > now() - interval '14 days' and ev.direction = 'supports')::int as sup,
            count(distinct ev.id) filter (where ev.created_at > now() - interval '14 days' and ev.direction = 'contradicts')::int as con
       from ev join questions qu on qu.id = ev.question_id
      group by qu.slug, qu.title
     having count(distinct ev.id) filter (where ev.created_at > now() - interval '14 days') > 0
      order by n desc
      limit 8`
  );
  return rows.map((r) => ({
    kind: 'question',
    id: r.slug,
    title: r.title,
    meta: `${plural(r.n, 'new piece', 'new pieces')} of evidence in two weeks`,
    ask: `What moved in the last two weeks on this question, and which way does the new evidence cut: "${r.title}"`,
    badge: r.n >= 5 && r.n >= r.prev * 1.5 ? 'Rising' : undefined,
    split: { sup: r.sup, con: r.con, other: Math.max(0, r.n - r.sup - r.con) },
  }));
}

// Papers the triage kept in the last two weeks, those bearing on the most
// map claims first (the public "Bears on" codes), then most cited. Only
// public arXiv facts show (title, date, citations): the triage and agent
// layers (summaries, recommendations) never reach the card. Human review
// (tracked/noted) has been idle since 2026-09-14, so it cannot carry a tab.
async function research(): Promise<TrendingCard[]> {
  const rows = await q<{ id: string; title: string; day: string | null; cites: number | null; touches: number }>(
    `select id::text as id, title, to_char(published_at, 'YYYY-MM-DD') as day, citation_count as cites,
            coalesce(cardinality(claim_touches), 0) as touches
       from papers
      where triage_status = 'kept' and review_status is distinct from 'dismissed'
        and created_at > now() - interval '14 days'
      order by coalesce(cardinality(claim_touches), 0) desc, coalesce(citation_count, 0) desc,
               author_hindex desc nulls last, published_at desc nulls last
      limit 9`
  );
  return rows.map((r) => ({
    kind: 'paper',
    id: r.id,
    title: r.title,
    meta: ['arXiv', fmtDay(r.day), r.touches ? `bears on ${plural(r.touches, 'claim')}` : '', r.cites ? plural(r.cites, 'citation') : ''].filter(Boolean).join(' · '),
    ask: `What does this paper find, how solid is it, and why does it matter: "${clip(r.title, 200)}"?`,
  }));
}

const safe = async (f: () => Promise<TrendingCard[]>): Promise<TrendingCard[]> => {
  try {
    return await f();
  } catch (e) {
    console.error('[ask trending]', (e as Error).message);
    return [];
  }
};

export async function getAskTrending(): Promise<TrendingTab[]> {
  const [sig, deb, res] = await Promise.all([safe(signals), safe(debates), safe(research)]);
  const tabs: TrendingTab[] = [
    { key: 'debates', label: 'Debates in motion', blurb: 'Map questions gaining the most evidence in the last two weeks.', cards: deb },
    { key: 'signals', label: 'Signals', blurb: 'The latest developments placed on the Argument Map.', cards: sig },
    { key: 'research', label: 'Research', blurb: 'New papers the research desk kept this fortnight, most cited first.', cards: res },
  ];
  return tabs.filter((t) => t.cards.length > 0);
}
