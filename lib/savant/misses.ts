import { q, one } from '../db';
import { cleanBlindSpots } from '../edition/desks';
import type { MissPayload } from './types';
import type { NotebookEntry } from '../mutations/savant';

// Savant's misses leg: what the desk knows it did not cover. The pipeline's
// coverage check (advisory, per run) supplies the independently derived
// developments it missed, cleaned of GDELT junk titles; scan topics with
// real volume this week but no approved candidate are the desk's own blind
// spots; questions with no new evidence this week round it out.

export async function missEntries(weekFrom: string, dayTo: string, isFriday: boolean): Promise<{ entries: NotebookEntry[]; stats: { coverage: number; quietTopics: number; quietQuestions: number } }> {
  const entries: NotebookEntry[] = [];

  const cov = await one<{ coverage: { developments: { headline: string; url: string | null; covered: boolean }[] } | null }>(
    `select coverage from pipeline_runs
      where status = 'completed' and coverage is not null
        and triggered_at >= $1::timestamptz and triggered_at < $2::timestamptz
      order by triggered_at desc limit 1`,
    [weekFrom, dayTo]
  );
  const coverage = cleanBlindSpots(cov?.coverage?.developments ?? [], 8);
  for (const b of coverage) {
    const p: MissPayload = { kind: 'coverage', headline: b.headline, url: b.url, detail: 'Reported elsewhere this week; no tracked item covers it.' };
    entries.push({ kind: 'miss', key: `coverage:${(b.url ?? b.headline).slice(0, 200)}`, payload: p });
  }

  let quietTopics = 0;
  let quietQuestions = 0;
  if (isFriday) {
    const topics = await q<{ slug: string; name: string; items: number; approved: number }>(
      `select t.slug, t.name,
              (select count(*) from scan_items si where si.topic_slug = t.slug and si.created_at >= $1::timestamptz and si.created_at < $2::timestamptz and coalesce(si.relevance, 0) >= 0.55)::int as items,
              (select count(*) from signal_candidates sc where sc.triage_status = 'approved' and sc.created_at >= $1::timestamptz and sc.created_at < $2::timestamptz
                  and exists (select 1 from scan_items si2 where si2.topic_slug = t.slug and si2.url = sc.url))::int as approved
         from scan_topics t where t.active
        order by items desc`,
      [weekFrom, dayTo]
    );
    // The pipeline picks by lens, not by scan topic, so most topics never
    // yield a candidate; only heavy silence is a miss worth printing.
    for (const t of topics.filter((x) => x.items >= 30 && x.approved === 0).slice(0, 5)) {
      {
        quietTopics += 1;
        const p: MissPayload = { kind: 'volume_no_signal', headline: t.name, url: null, detail: `${t.items} relevant items this week and no approved candidate from any of them.` };
        entries.push({ kind: 'miss', key: `volume_no_signal:${t.slug}`, payload: p });
      }
    }
    const questions = await q<{ slug: string; title: string; n: number }>(
      `select qu.slug, qu.title,
              (select count(*) from evidence e join claims c on c.id = e.target_id and e.target_type = 'claim'
                 join edges ed on ed.from_type = 'claim' and ed.from_id = c.id and ed.to_type = 'stance'
                 join stances st on st.id = ed.to_id and st.question_id = qu.id
                where e.created_at >= $1::timestamptz and e.created_at < $2::timestamptz)::int as n
         from questions qu order by qu.sort_order`,
      [weekFrom, dayTo]
    );
    for (const r of questions) {
      if (r.n === 0) {
        quietQuestions += 1;
        const p: MissPayload = { kind: 'question_quiet', headline: r.title, url: `/q/${r.slug}`, detail: 'No new evidence reached this question this week.' };
        entries.push({ kind: 'miss', key: `question_quiet:${r.slug}`, payload: p });
      }
    }
  }
  return { entries, stats: { coverage: coverage.length, quietTopics, quietQuestions } };
}
