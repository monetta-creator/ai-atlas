import { q } from '../db';
import { embedModel } from '../embed/client';
import { shapeConnections, shapeEchoes, connectionKey, echoKey } from './connections-core';
import type { RawConnection, RawEcho } from './connections-core';
import type { ConnectionPayload, EchoPayload, NotebookRecordRef } from './types';
import type { NotebookEntry } from '../mutations/savant';

// Savant's connections leg (2026-09-26): the first cross-store link the Atlas
// has had. The collecting stores (scan, intel, papers) share the embeddings
// table with the argument map, so a day's new records can be joined to the
// claims, bridges and stances they sit near by cosine similarity, in plain
// SQL over stored vectors: no model call, no query embedding. About 300
// record chunks × 60 map chunks of exact distances, seconds. Echoes are the
// same join between the day's records and the week's earlier records of a
// different kind (a paper and a signal saying one thing). tooling_events
// and scout companies are not embed kinds, so they do not join here.

interface JoinRow { record_kind: string; record_id: string; target_kind: 'claim' | 'bridge' | 'stance'; target_id: string; sim: number }
interface EchoRow { a_kind: string; a_id: string; b_kind: string; b_id: string; sim: number }

const DAY_RECORD_SQL = `
  select e.kind, e.record_id, e.vec from embeddings e
   where e.model = $1 and (
        (e.kind = 'scan_item' and e.record_id in (select id::text from scan_items
             where created_at >= $2::timestamptz and created_at < $3::timestamptz and coalesce(relevance, 0) >= 0.55))
     or (e.kind = 'intel_item' and e.record_id in (select id::text from intel_items
             where created_at >= $2::timestamptz and created_at < $3::timestamptz))
     or (e.kind = 'intel_fact' and e.record_id in (select id::text from intel_facts
             where created_at >= $2::timestamptz and created_at < $3::timestamptz))
     or (e.kind = 'paper' and e.record_id in (select id::text from papers
             where created_at >= $2::timestamptz and created_at < $3::timestamptz and triage_status = 'kept'))
   )`;

export async function findConnections(from: string, to: string, minSim = 0.5): Promise<RawConnection[]> {
  const rows = await q<JoinRow>(
    `with recs as (${DAY_RECORD_SQL}),
          map as (select kind, record_id, vec from embeddings where model = $1 and kind in ('claim', 'bridge', 'stance'))
     select r.kind as record_kind, r.record_id, m.kind as target_kind, m.record_id as target_id,
            max(1 - (r.vec <=> m.vec))::float as sim
       from recs r cross join map m
      group by 1, 2, 3, 4
     having max(1 - (r.vec <=> m.vec)) >= $4
      order by sim desc
      limit 300`,
    [embedModel(), from, to, minSim]
  );
  return rows.map((r) => ({ recordKind: r.record_kind, recordId: r.record_id, targetKind: r.target_kind, targetId: r.target_id, sim: r.sim }));
}

// The day's records against the week's EARLIER records of another kind.
export async function findEchoes(dayFrom: string, dayTo: string, weekFrom: string, minSim = 0.6): Promise<RawEcho[]> {
  const rows = await q<EchoRow>(
    `with today as (${DAY_RECORD_SQL}),
          earlier as (${DAY_RECORD_SQL.replace('$2::timestamptz', '$5::timestamptz').replace(/\$3::timestamptz/g, '$2::timestamptz')})
     select t.kind as a_kind, t.record_id as a_id, e.kind as b_kind, e.record_id as b_id,
            max(1 - (t.vec <=> e.vec))::float as sim
       from today t cross join earlier e
      where t.kind <> e.kind
      group by 1, 2, 3, 4
     having max(1 - (t.vec <=> e.vec)) >= $4
      order by sim desc
      limit 120`,
    [embedModel(), dayFrom, dayTo, minSim, weekFrom]
  );
  return rows.map((r) => ({ aKind: r.a_kind, aId: r.a_id, bKind: r.b_kind, bId: r.b_id, sim: r.sim }));
}

// ---------------------------------------------------------------- refs

type TargetRef = ConnectionPayload['target'];

export async function resolveTargets(ids: { kind: 'claim' | 'bridge' | 'stance'; id: string }[]): Promise<Map<string, TargetRef>> {
  const out = new Map<string, TargetRef>();
  const by = (k: string) => ids.filter((x) => x.kind === k).map((x) => x.id);
  const claimIds = by('claim'); const bridgeIds = by('bridge'); const stanceIds = by('stance');
  // The map kinds are embedded by CODE (lib/embed/sources.ts: record_id =
  // code for claims, bridges and stances), so the join's target ids are codes.
  if (claimIds.length) {
    const rows = await q<{ code: string; statement: string }>(
      `select code, statement from claims where code = any($1)`, [claimIds]);
    for (const r of rows) out.set(`claim:${r.code}`, { kind: 'claim', code: r.code, statement: r.statement, href: `/claim/${encodeURIComponent(r.code)}` });
  }
  if (bridgeIds.length) {
    const rows = await q<{ code: string; statement: string }>(
      `select code, statement from bridge_claims where code = any($1)`, [bridgeIds]);
    for (const r of rows) out.set(`bridge:${r.code}`, { kind: 'bridge', code: r.code, statement: r.statement, href: `/bridge/${r.code}` });
  }
  if (stanceIds.length) {
    const rows = await q<{ code: string; title: string; slug: string }>(
      `select s.code, s.title, qu.slug from stances s join questions qu on qu.id = s.question_id where s.code = any($1)`, [stanceIds]);
    for (const r of rows) out.set(`stance:${r.code}`, { kind: 'stance', code: r.code, statement: r.title, href: `/q/${r.slug}` });
  }
  return out;
}

export async function resolveRecords(ids: { kind: string; id: string }[]): Promise<Map<string, NotebookRecordRef>> {
  const out = new Map<string, NotebookRecordRef>();
  const by = (k: string) => ids.filter((x) => x.kind === k).map((x) => x.id);
  const scan = by('scan_item'); const intel = by('intel_item'); const facts = by('intel_fact'); const papers = by('paper'); const signals = by('signal'); const cands = by('candidate');
  if (scan.length) {
    for (const r of await q<{ id: string; headline: string | null; url: string }>(`select id::text as id, headline, url from scan_items where id::text = any($1)`, [scan]))
      out.set(`scan_item:${r.id}`, { kind: 'scan_item', id: r.id, title: r.headline ?? r.url, url: r.url, href: null });
  }
  if (intel.length) {
    for (const r of await q<{ id: string; headline: string | null; url: string; company_slug: string | null }>(`select id::text as id, headline, url, company_slug from intel_items where id::text = any($1)`, [intel]))
      out.set(`intel_item:${r.id}`, { kind: 'intel_item', id: r.id, title: r.headline ?? r.url, url: r.url, href: null, company: r.company_slug });
  }
  if (facts.length) {
    for (const r of await q<{ id: string; fact: string; value_text: string | null; company_slug: string; url: string | null }>(
      `select f.id::text as id, f.fact, f.value_text, f.company_slug, ii.url from intel_facts f left join intel_items ii on ii.id = f.item_id where f.id::text = any($1)`, [facts]))
      out.set(`intel_fact:${r.id}`, { kind: 'intel_fact', id: r.id, title: r.value_text ? `${r.fact}: ${r.value_text}` : r.fact, url: r.url, href: null, company: r.company_slug });
  }
  if (papers.length) {
    for (const r of await q<{ id: string; title: string; url: string | null }>(`select id::text as id, title, url from papers where id::text = any($1)`, [papers]))
      out.set(`paper:${r.id}`, { kind: 'paper', id: r.id, title: r.title, url: r.url, href: `/research/${r.id}` });
  }
  if (signals.length) {
    for (const r of await q<{ id: string; title: string }>(`select id::text as id, title from signals where id::text = any($1)`, [signals]))
      out.set(`signal:${r.id}`, { kind: 'signal', id: r.id, title: r.title, url: null, href: `/signals/${r.id}` });
  }
  if (cands.length) {
    for (const r of await q<{ id: string; headline: string | null; url: string }>(`select id::text as id, headline, url from signal_candidates where id::text = any($1)`, [cands]))
      out.set(`candidate:${r.id}`, { kind: 'candidate', id: r.id, title: r.headline ?? r.url, url: r.url, href: null });
  }
  return out;
}

// ---------------------------------------------------------------- the leg

export async function connectionEntries(day: { from: string; to: string }, weekFrom: string): Promise<{ entries: NotebookEntry[]; stats: { raw: number; kept: number; echoes: number } }> {
  const raw = await findConnections(day.from, day.to);
  const kept = shapeConnections(raw, { minSim: 0.55, perRecord: 2, max: 40 });
  // An echo is only interesting across NATURES: a paper or an extracted fact
  // against a news item. Two news items about the same story are the same
  // story (0.95+ is a duplicate, the scan and intel engines both stored it).
  const NATURE_A = new Set(['paper', 'intel_fact']);
  const rawEchoes = (await findEchoes(day.from, day.to, weekFrom, 0.8)).filter(
    (e) => e.sim < 0.95 && (NATURE_A.has(e.aKind) !== NATURE_A.has(e.bKind))
  );
  const echoes = shapeEchoes(rawEchoes, { minSim: 0.8, max: 12 });

  const targets = await resolveTargets(kept.map((c) => ({ kind: c.targetKind, id: c.targetId })));
  const recordIds = [
    ...kept.map((c) => ({ kind: c.recordKind, id: c.recordId })),
    ...echoes.flatMap((e) => [{ kind: e.aKind, id: e.aId }, { kind: e.bKind, id: e.bId }]),
  ];
  const records = await resolveRecords(recordIds);

  const entries: NotebookEntry[] = [];
  for (const c of kept) {
    const record = records.get(`${c.recordKind}:${c.recordId}`);
    const target = targets.get(`${c.targetKind}:${c.targetId}`);
    if (!record || !target) continue;
    const payload: ConnectionPayload = { record, target, sim: Math.round(c.sim * 1000) / 1000 };
    entries.push({ kind: 'connection', key: connectionKey(c), payload });
  }
  for (const e of echoes) {
    const a = records.get(`${e.aKind}:${e.aId}`);
    const b = records.get(`${e.bKind}:${e.bId}`);
    if (!a || !b) continue;
    const payload: EchoPayload = { a, b, sim: Math.round(e.sim * 1000) / 1000 };
    entries.push({ kind: 'echo', key: echoKey(e), payload });
  }
  return { entries, stats: { raw: raw.length, kept: kept.length, echoes: echoes.length } };
}
