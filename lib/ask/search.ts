// The structured record-fetch seam behind the Ask peek panel (and, later, the
// v2 agentic loop's fetch_record tool). Follows the pack-core discipline:
// query access injected (`Q`), type-only imports, deterministic ordering,
// GUEST-SAFE COLUMNS ALWAYS: every payload is public-shaped regardless of the
// viewer (no confidence, no notes, no priors, no dossiers). The one admin
// concession is ROW visibility: draft signals resolve for admins (their
// answers can cite drafts) while staying 404 for everyone else.

export type Q = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

export type PeekKind = 'claim' | 'bridge' | 'stance' | 'question' | 'concept' | 'signal' | 'paper' | 'thread';

interface PeekEvidence {
  direction: string;
  excerpt: string;
  source_title: string | null;
  source_url: string | null;
  outlet: string | null;
}

export interface PeekPayload {
  kind: PeekKind;
  title: string;
  code: string | null;
  subtitle: string | null;
  body: string | null;
  test: string | null;
  brief: { what_happened: string | null; why_it_matters: string | null; whats_contested: string | null } | null;
  counterpoint: string | null;
  significance: string | null;
  lenses: string[] | null;
  published_on: string | null;
  source: { title: string | null; url: string | null; outlet: string | null; published_on: string | null } | null;
  evidence: PeekEvidence[];
  signals: { id: string; title: string; published_on: string | null }[];
  stances: { code: string; title: string }[];
  prerequisites: { slug: string; name: string }[];
  builds_toward: { slug: string; name: string }[];
  // Research records: a paper's structured finding rows; a thread's member papers.
  finding: { label: string; value: string }[];
  members: { id: string; title: string; relation: string | null }[];
  internal: string;
}

const empty = (kind: PeekKind, title: string, internal: string): PeekPayload => ({
  kind, title, code: null, subtitle: null, body: null, test: null, brief: null,
  counterpoint: null, significance: null, lenses: null, published_on: null,
  source: null, evidence: [], signals: [], stances: [], prerequisites: [],
  builds_toward: [], finding: [], members: [], internal,
});

// Public-shaped evidence for one claim/bridge code: excerpt-only, never
// evidence.note, never reliability_prior, published-signal-or-sourced only.
async function evidenceFor(q: Q, targetType: 'claim' | 'bridge_claim', code: string): Promise<PeekEvidence[]> {
  return q<PeekEvidence>(
    `select e.direction::text as direction, e.excerpt,
            src.title as source_title, src.url as source_url, src.outlet
       from evidence e
       join ${targetType === 'claim' ? 'claims' : 'bridge_claims'} t
         on t.id = e.target_id and e.target_type = $2
       left join sources src on src.id = e.source_id
      where t.code = $1 and e.excerpt is not null
        and (e.signal_id is null
             or exists (select 1 from signals g where g.id = e.signal_id and g.is_published))
      order by e.created_at desc, e.id limit 6`,
    [code, targetType]
  );
}

async function signalsTouching(q: Q, code: string): Promise<PeekPayload['signals']> {
  return q<PeekPayload['signals'][number]>(
    `select id::text as id, title, to_char(published_at, 'YYYY-MM-DD') as published_on
       from signals where claim_touches && $1::text[] and is_published = true
      order by published_at desc nulls last, id limit 4`,
    [[code]]
  );
}

export async function fetchRecord(
  q: Q,
  kind: PeekKind,
  id: string,
  opts: { admin?: boolean } = {}
): Promise<PeekPayload | null> {
  if (kind === 'claim') {
    const rows = await q<{ code: string; statement: string; test: string | null; domain: string | null; is_frame: boolean }>(
      `select code, statement, test, domain::text as domain, is_frame
         from claims where code = $1`,
      [id]
    );
    const r = rows[0];
    if (!r) return null;
    const p = empty('claim', r.statement, `/claim/${encodeURIComponent(r.code)}`);
    p.code = r.code;
    p.subtitle = r.is_frame ? 'Organizing frame' : r.domain ? `Claim · ${r.domain}` : 'Claim';
    p.test = r.test;
    if (!r.is_frame) {
      p.evidence = await evidenceFor(q, 'claim', r.code);
      p.signals = await signalsTouching(q, r.code);
    }
    return p;
  }

  if (kind === 'bridge') {
    const rows = await q<{ code: string; statement: string; test: string | null; domain_from: string; domain_to: string }>(
      `select code, statement, test, domain_from::text as domain_from, domain_to::text as domain_to
         from bridge_claims where code = $1`,
      [id]
    );
    const r = rows[0];
    if (!r) return null;
    const p = empty('bridge', r.statement, `/bridge/${r.code}`);
    p.code = r.code;
    p.subtitle = `Bridge claim · ${r.domain_from} to ${r.domain_to}`;
    p.test = r.test;
    p.evidence = await evidenceFor(q, 'bridge_claim', r.code);
    p.signals = await signalsTouching(q, r.code);
    return p;
  }

  if (kind === 'stance') {
    const rows = await q<{ code: string; title: string; summary: string | null; test: string; q_slug: string; q_title: string }>(
      `select s.code, s.title, s.summary, s.test, qn.slug as q_slug, qn.title as q_title
         from stances s join questions qn on qn.id = s.question_id
        where s.code = $1`,
      [id]
    );
    const r = rows[0];
    if (!r) return null;
    const p = empty('stance', r.title, `/q/${r.q_slug}#${encodeURIComponent(r.code)}`);
    p.code = r.code;
    p.subtitle = `Stance under: ${r.q_title}`;
    p.body = r.summary;
    p.test = r.test;
    return p;
  }

  if (kind === 'question') {
    const rows = await q<{ slug: string; title: string; summary: string | null }>(
      `select slug, title, summary from questions where slug = $1`,
      [id]
    );
    const r = rows[0];
    if (!r) return null;
    const p = empty('question', r.title, `/q/${r.slug}`);
    p.subtitle = 'Open question';
    p.body = r.summary;
    p.stances = await q<{ code: string; title: string }>(
      `select s.code, s.title from stances s join questions qn on qn.id = s.question_id
        where qn.slug = $1 and s.code is not null order by s.code`,
      [id]
    );
    return p;
  }

  if (kind === 'concept') {
    const rows = await q<{ id: string; slug: string; name: string; short_definition: string; explanation: string | null; status: string }>(
      `select id::text as id, slug, name, short_definition, explanation, status::text as status
         from concepts where slug = $1`,
      [id]
    );
    const r = rows[0];
    if (!r) return null;
    const p = empty('concept', r.name, `/concepts/${r.slug}`);
    p.subtitle = `Concept · ${r.status}`;
    p.body = [r.short_definition, r.explanation].filter(Boolean).join('\n\n');
    p.prerequisites = await q<{ slug: string; name: string }>(
      `select c.slug, c.name from concept_edges ce join concepts c on c.id = ce.prerequisite_id
        where ce.concept_id = $1::uuid and ce.status = 'confirmed' order by c.name`,
      [r.id]
    );
    p.builds_toward = await q<{ slug: string; name: string }>(
      `select c.slug, c.name from concept_edges ce join concepts c on c.id = ce.concept_id
        where ce.prerequisite_id = $1::uuid and ce.status = 'confirmed' order by c.name`,
      [r.id]
    );
    return p;
  }

  if (kind === 'paper') {
    const rows = await q<{
      id: string; title: string; arxiv_id: string | null; url: string; abstract: string | null;
      published_on: string | null; headline: string | null; the_test: string | null; effect: string | null;
      limitations: string | null; counterpoint: string | null; econ: string | null; summary: string | null;
    }>(
      `select id::text as id, title, arxiv_id, url, abstract,
              to_char(published_at, 'YYYY-MM-DD') as published_on,
              extraction->>'headline_claim' as headline,
              extraction->>'the_test' as the_test,
              extraction->>'effect_size' as effect,
              extraction->>'limitations' as limitations,
              extraction->>'counterpoint' as counterpoint,
              extraction->>'econ_implication' as econ,
              triage_summary as summary
         from papers where id = $1::uuid and triage_status = 'kept'`,
      [id]
    );
    const r = rows[0];
    if (!r) return null;
    const p = empty('paper', r.title, `/research/${r.id}`);
    p.subtitle = `Paper · ${r.arxiv_id ?? 'manual'}${r.published_on ? ` · ${r.published_on}` : ''}`;
    p.published_on = r.published_on;
    p.finding = [
      { label: 'Headline claim', value: r.headline },
      { label: 'The test', value: r.the_test },
      { label: 'Effect size & scope', value: r.effect },
      { label: 'Limitations', value: r.limitations },
      { label: 'Counterpoint', value: r.counterpoint },
      { label: 'Economy implication', value: r.econ },
    ].filter((f): f is { label: string; value: string } => !!f.value);
    p.body = p.finding.length ? null : (r.summary ?? (r.abstract ? `${r.abstract.slice(0, 900)}` : null));
    p.source = { title: r.arxiv_id ? `arXiv ${r.arxiv_id}` : 'Original paper', url: r.url, outlet: null, published_on: r.published_on };
    return p;
  }

  if (kind === 'thread') {
    const rows = await q<{ id: string; slug: string; title: string; question: string; synthesis: string | null; status: string }>(
      `select id::text as id, slug, title, question, synthesis, status::text as status
         from research_threads where slug = $1`,
      [id]
    );
    const r = rows[0];
    if (!r) return null;
    const p = empty('thread', r.title, `/research/threads/${r.slug}`);
    p.subtitle = `Research thread · ${r.status}`;
    const synth = r.synthesis ? r.synthesis.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    p.body = [r.question, synth ? `${synth.slice(0, 900)}${synth.length > 900 ? ' ...' : ''}` : null]
      .filter(Boolean).join('\n\n');
    p.members = await q<{ id: string; title: string; relation: string | null }>(
      `select p.id::text as id, p.title, tp.relation::text as relation
         from thread_papers tp join papers p on p.id = tp.paper_id
        where tp.thread_id = $1::uuid and tp.status = 'confirmed'
        order by p.published_at desc nulls last, p.id limit 10`,
      [r.id]
    );
    return p;
  }

  // signal: row visibility is admin-widened (drafts resolve for admins only);
  // the columns stay public-shaped either way.
  const rows = await q<{
    id: string; title: string; summary: string | null; significance: string;
    lenses: string[]; published_on: string | null;
    what_happened: string | null; why_it_matters: string | null; whats_contested: string | null;
    counterpoint: string | null;
    source_title: string | null; source_url: string | null; outlet: string | null; source_published: string | null;
  }>(
    `select s.id::text as id, s.title, s.summary, s.significance::text as significance,
            s.lenses::text[] as lenses,
            to_char(s.published_at, 'YYYY-MM-DD') as published_on,
            s.brief->>'what_happened'   as what_happened,
            s.brief->>'why_it_matters'  as why_it_matters,
            s.brief->>'whats_contested' as whats_contested,
            s.counterpoint->>'the_other_read' as counterpoint,
            src.title as source_title, src.url as source_url, src.outlet,
            to_char(src.published_at, 'YYYY-MM-DD') as source_published
       from signals s left join sources src on src.id = s.source_id
      where s.id = $1::uuid and (s.is_published = true or $2::boolean)`,
    [id, opts.admin === true]
  );
  const r = rows[0];
  if (!r) return null;
  const p = empty('signal', r.title, `/signals/${r.id}`);
  p.subtitle = `Signal · ${r.significance}`;
  p.body = r.summary;
  p.brief =
    r.what_happened || r.why_it_matters || r.whats_contested
      ? { what_happened: r.what_happened, why_it_matters: r.why_it_matters, whats_contested: r.whats_contested }
      : null;
  p.counterpoint = r.counterpoint;
  p.significance = r.significance;
  p.lenses = r.lenses;
  p.published_on = r.published_on;
  p.source = r.source_title || r.source_url
    ? { title: r.source_title, url: r.source_url, outlet: r.outlet, published_on: r.source_published }
    : null;
  return p;
}

// ------------------------------------------------------------- deep search
// Structured search for the deep-research loop (/api/ask/deep). Same injected
// Q and guest-safe column discipline as fetchRecord; `admin` widens only
// signal ROW visibility (drafts). Signals are identified by their
// conversation-scoped tag (minted via tagFor), never by uuid, so every result
// is citable exactly as rendered.

export interface AtlasSearchHit {
  kind: PeekKind;
  id: string; // claim/bridge/stance code, concept slug, or signal TAG
  snippet: string;
}

export interface ArticleHit {
  signalTag: string | null;
  title: string;
  outlet: string | null;
  excerpt: string;
}

// websearch_to_tsquery ANDs terms; OR-combine so natural phrasing retrieves
// (ts_rank still puts multi-term matches first). Same trick as lib/ask/retrieve.
const ORQ = "replace(websearch_to_tsquery('english', $1)::text, '&', '|')::tsquery";

const snip = (s: string | null | undefined, n = 200): string => {
  const t = (s ?? '').trim().replace(/\s+/g, ' ');
  return t.length > n ? `${t.slice(0, n)} ...` : t;
};

export async function searchAtlas(
  q: Q,
  query: string,
  opts: {
    kinds: PeekKind[]; limit: number; admin?: boolean;
    tagFor: (id: string) => string;
    // Papers mint P-tags on the shared counter; without a minter the paper
    // kind is skipped (callers that predate the research corpus).
    paperTagFor?: (id: string) => string;
  }
): Promise<AtlasSearchHit[]> {
  const want = new Set(opts.kinds);
  const lim = Math.min(8, Math.max(1, Math.floor(opts.limit) || 5));
  const hits: AtlasSearchHit[] = [];

  if (want.has('claim')) {
    const rows = await q<{ code: string; statement: string; is_frame: boolean }>(
      `select code, statement, is_frame from claims
        where code is not null and search_tsv @@ ${ORQ}
        order by ts_rank(search_tsv, ${ORQ}) desc, code limit ${lim}`,
      [query]
    );
    for (const r of rows) {
      hits.push({ kind: 'claim', id: r.code, snippet: `${r.is_frame ? '(frame) ' : ''}${snip(r.statement)}` });
    }
  }

  if (want.has('bridge')) {
    const rows = await q<{ code: string; statement: string; domain_from: string; domain_to: string }>(
      `select code, statement, domain_from::text as domain_from, domain_to::text as domain_to
         from bridge_claims
        where code is not null and search_tsv @@ ${ORQ}
        order by ts_rank(search_tsv, ${ORQ}) desc, code limit ${lim}`,
      [query]
    );
    for (const r of rows) {
      hits.push({ kind: 'bridge', id: r.code, snippet: `${snip(r.statement)} (${r.domain_from} -> ${r.domain_to})` });
    }
  }

  if (want.has('stance')) {
    const rows = await q<{ code: string; title: string; q_slug: string }>(
      `select s.code, s.title, qn.slug as q_slug
         from stances s join questions qn on qn.id = s.question_id
        where s.code is not null and s.search_tsv @@ ${ORQ}
        order by ts_rank(s.search_tsv, ${ORQ}) desc, s.code limit ${lim}`,
      [query]
    );
    for (const r of rows) {
      hits.push({ kind: 'stance', id: r.code, snippet: `${snip(r.title)} (under Q ${r.q_slug})` });
    }
  }

  if (want.has('concept')) {
    const rows = await q<{ slug: string; name: string; short_definition: string; status: string }>(
      `select slug, name, short_definition, status::text as status from concepts
        where search_tsv @@ ${ORQ}
        order by ts_rank(search_tsv, ${ORQ}) desc, slug limit ${lim}`,
      [query]
    );
    for (const r of rows) {
      hits.push({ kind: 'concept', id: r.slug, snippet: `${r.name} (${r.status}): ${snip(r.short_definition)}` });
    }
  }

  if (want.has('thread')) {
    const rows = await q<{ slug: string; title: string; question: string; status: string }>(
      `select slug, title, question, status::text as status from research_threads
        where search_tsv @@ ${ORQ}
        order by ts_rank(search_tsv, ${ORQ}) desc, slug limit ${lim}`,
      [query]
    );
    for (const r of rows) {
      hits.push({ kind: 'thread', id: r.slug, snippet: `${r.title} (${r.status}): ${snip(r.question)}` });
    }
  }

  if (want.has('paper') && opts.paperTagFor) {
    const ptag = opts.paperTagFor;
    const rows = await q<{ id: string; title: string; arxiv_id: string | null; headline: string | null; summary: string | null; claim_touches: string[] }>(
      `select id::text as id, title, arxiv_id,
              extraction->>'headline_claim' as headline, triage_summary as summary, claim_touches
         from papers
        where triage_status = 'kept' and review_status <> 'dismissed' and search_tsv @@ ${ORQ}
        order by (review_status in ('tracked', 'noted')) desc, ts_rank(search_tsv, ${ORQ}) desc, id
        limit ${lim}`,
      [query]
    );
    for (const r of rows) {
      const touches = r.claim_touches.length ? ` (touches ${r.claim_touches.join(', ')})` : '';
      hits.push({
        kind: 'paper',
        id: ptag(r.id),
        snippet: `"${snip(r.title, 120)}"${r.arxiv_id ? ` (arXiv ${r.arxiv_id})` : ''}: ${snip(r.headline ?? r.summary, 220)}${touches}`,
      });
    }
  }

  if (want.has('signal')) {
    const rows = await q<{ id: string; title: string; summary: string | null; claim_touches: string[]; is_published: boolean }>(
      `select id::text as id, title, summary, claim_touches, is_published from signals
        where search_tsv @@ ${ORQ} ${opts.admin ? '' : 'and is_published = true'}
        order by ts_rank(search_tsv, ${ORQ}) desc, id limit ${lim}`,
      [query]
    );
    for (const r of rows) {
      const touches = r.claim_touches.length ? ` (touches ${r.claim_touches.join(', ')})` : '';
      hits.push({
        kind: 'signal',
        id: opts.tagFor(r.id),
        snippet: `"${r.title}"${r.is_published ? '' : ' (draft)'} ${snip(r.summary, 220)}${touches}`,
      });
    }
  }

  return hits;
}

// Article-text search over the 0029 tsvectors, deep-research grade: longer
// excerpts than the retrieval leg, still surfaced ONLY through a published
// signal or a publicly cited source. ts_headline marks hits with ** so the
// fragments read as emphasis, not markup.
export async function searchArticles(
  q: Q,
  query: string,
  opts: { tagFor: (id: string) => string; limit?: number }
): Promise<ArticleHit[]> {
  const HL = `'StartSel=**, StopSel=**, MaxFragments=3, MaxWords=40, MinWords=8'`;
  const lim = Math.min(5, Math.max(1, opts.limit ?? 3));
  const out: ArticleHit[] = [];

  const srcRows = await q<{ id: string; title: string; outlet: string | null; excerpt: string; sig_id: string | null }>(
    `select s.id::text as id, s.title, s.outlet,
            ts_headline('english', left(coalesce(s.raw_text, ''), 200000), ${ORQ}, ${HL}) as excerpt,
            sig.id::text as sig_id
       from sources s
       left join lateral (
         select g.id from signals g
          where g.source_id = s.id and g.is_published = true
          order by g.published_at desc nulls last, g.id limit 1
       ) sig on true
      where s.search_tsv @@ ${ORQ} and s.raw_text is not null
        and (sig.id is not null or exists (select 1 from evidence e where e.source_id = s.id))
      order by ts_rank(s.search_tsv, ${ORQ}) desc, s.id limit ${lim}`,
    [query]
  );
  for (const r of srcRows) {
    out.push({
      signalTag: r.sig_id ? opts.tagFor(r.sig_id) : null,
      title: r.title,
      outlet: r.outlet,
      excerpt: snip(r.excerpt, 450),
    });
  }

  const candRows = await q<{ sig_id: string; sig_title: string; excerpt: string }>(
    `select g.id::text as sig_id, g.title as sig_title,
            ts_headline('english', left(coalesce(sc.raw_content, ''), 200000), ${ORQ}, ${HL}) as excerpt
       from signal_candidates sc
       join signals g on g.id = sc.signal_id and g.is_published = true
      where sc.search_tsv @@ ${ORQ}
      order by ts_rank(sc.search_tsv, ${ORQ}) desc, sc.id limit ${lim}`,
    [query]
  );
  for (const r of candRows) {
    out.push({ signalTag: opts.tagFor(r.sig_id), title: r.sig_title, outlet: null, excerpt: snip(r.excerpt, 450) });
  }

  return out;
}
