import { q, one } from '../db';

// The reader organization's public record (mig 0076), for the key-gated
// /savant/record page: the same self_record/self_timeline/public_profile
// data Savant's weekly pack reads (lib/data/savant.ts getSelfCompany), but
// unwindowed and with the full record list a reader can filter. The
// company's name comes from the DB and never appears in code.

export interface SelfRecordProfileSentence {
  text: string;
  hrefs: string[];
}

export interface SelfRecordTimelineEvent {
  id: string;
  date: string;
  category: string;
  headline: string;
  body: string | null;
  hrefs: string[];
}

export interface SelfRecordRow {
  id: string;
  source: string;
  title: string;
  url: string;
  publishedDate: string | null;
  summary: string | null;
  aiRelated: boolean;
}

export interface SelfRecordSourceCount {
  source: string;
  n: number;
}

export interface SelfRecordData {
  company: { slug: string; name: string };
  profile: SelfRecordProfileSentence[];
  timelineByYear: { year: number; events: SelfRecordTimelineEvent[] }[];
  records: SelfRecordRow[];
  countsBySource: SelfRecordSourceCount[];
  totalRecords: number;
}

export async function getSelfRecord(opts: { source?: string; ai?: boolean } = {}): Promise<SelfRecordData | null> {
  const company = await one<{
    slug: string; name: string;
    public_profile: { sentences?: { text: string; record_ids: string[] }[] } | null;
  }>(
    `select slug, name, public_profile from intel_companies where tier = 'self' and active order by slug limit 1`
  );
  if (!company) return null;

  const [timelineRows, countsRows, allRecordUrls] = await Promise.all([
    q<{ id: string; event_date: string; category: string; headline: string; body: string | null; record_ids: string[] }>(
      `select id::text as id, event_date::text as event_date, category, headline, body, record_ids
         from self_timeline where company_slug = $1
        order by event_date asc`,
      [company.slug]
    ),
    q<{ source: string; n: number }>(
      `select source, count(*)::int as n from self_record where company_slug = $1 group by source order by n desc`,
      [company.slug]
    ),
    // Unfiltered, so a profile sentence or timeline event can resolve its
    // links even when the reader has filtered the records table below.
    q<{ id: string; url: string }>(`select id::text as id, url from self_record where company_slug = $1`, [company.slug]),
  ]);

  const urlById = new Map(allRecordUrls.map((r) => [r.id, r.url]));
  const hrefsFor = (ids: string[] | null | undefined): string[] =>
    (ids ?? []).map((id) => urlById.get(id)).filter((u): u is string => Boolean(u));

  const sentences = company.public_profile?.sentences ?? [];
  const profile = sentences.map((s) => ({ text: s.text, hrefs: hrefsFor(s.record_ids) }));

  const byYear = new Map<number, SelfRecordTimelineEvent[]>();
  for (const t of timelineRows) {
    const year = Number(t.event_date.slice(0, 4));
    const list = byYear.get(year) ?? [];
    list.push({ id: t.id, date: t.event_date, category: t.category, headline: t.headline, body: t.body, hrefs: hrefsFor(t.record_ids) });
    byYear.set(year, list);
  }
  const timelineByYear = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, events]) => ({ year, events }));

  const where = ['company_slug = $1'];
  const params: unknown[] = [company.slug];
  if (opts.source) { params.push(opts.source); where.push(`source = $${params.length}`); }
  if (opts.ai) where.push('ai_related = true');

  const recordRows = await q<{ id: string; source: string; title: string; url: string; published_date: string | null; summary: string | null; ai_related: boolean }>(
    `select id::text as id, source, title, url, published_date::text as published_date, summary, ai_related
       from self_record
      where ${where.join(' and ')}
      order by published_date desc nulls last, created_at desc`,
    params
  );

  return {
    company: { slug: company.slug, name: company.name },
    profile,
    timelineByYear,
    records: recordRows.map((r) => ({
      id: r.id, source: r.source, title: r.title, url: r.url,
      publishedDate: r.published_date, summary: r.summary, aiRelated: r.ai_related,
    })),
    countsBySource: countsRows,
    totalRecords: countsRows.reduce((n, c) => n + c.n, 0),
  };
}
