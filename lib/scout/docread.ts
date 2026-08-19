import { runStructured } from '../dossier';
import { one, q } from '../db';
import * as m from '../mutations';
import { getCompanyDocumentText } from '../data';
import { parseStageHint, parseFoundedHint, parseEventKindHint, eventExists } from './core';
import type { CompanyStage } from '../types';

// Document extraction: a steered structured read over a retained document's
// text (browser-extracted, stored in company_documents). Same write discipline
// as the intel sweep: facts fill only null columns, the dossier merges
// monotonically, events dedupe against the timeline. Non-web: one runStructured
// call over text we already hold.

const TEXT_CLIP = 40_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_EVENTS = 6;

const DOC_SYSTEM = [
  'You are the document reader for Startup Scout, an acquisition-target tracker.',
  'You are given the extracted text of a document about a company (a pitch deck, a diligence note, an article) plus any facts already known.',
  'Extract only what the text supports; use empty strings or 0 for anything the document does not state. Read skeptically: decks overstate. Never invent customers, figures, or rounds.',
  'Events are dated developments the document reports (rounds, launches, milestones); date them YYYY-MM-DD, first of the month when only a month is given, and skip anything undatable.',
  'Never use an em dash anywhere; use a comma or a colon instead.',
].join(' ');

const DOC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    one_liner: { type: 'string', description: "One sentence: what the company builds. '' if unstated." },
    ai_tech: { type: 'string', description: "The AI technology itself, 1-3 concrete sentences. '' if unstated." },
    founded_year: { type: 'integer', description: 'Founding year if stated, else 0.' },
    stage_hint: { type: 'string', description: "Funding stage if stated: 'pre-seed', 'seed', 'series a', 'series b', 'later', or ''." },
    funding_note: { type: 'string', description: "Latest round if stated, e.g. 'Series A, $24M, 2026, Index'. '' if unstated." },
    hq: { type: 'string', description: "Headquarters if stated, else ''." },
    summary: { type: 'string', description: 'A 3-5 sentence skeptical read of what the document establishes about the company.' },
    products: { type: 'array', items: { type: 'string' }, description: 'Named products, if any.' },
    customers: { type: 'array', items: { type: 'string' }, description: 'Named customers or design partners, if any.' },
    events: {
      type: 'array',
      description: 'At most 6 dated developments the document reports.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD.' },
          kind_hint: { type: 'string', description: "'funding', 'launch', 'milestone', or 'news'." },
          title: { type: 'string', description: 'One line describing the development.' },
        },
        required: ['date', 'kind_hint', 'title'],
      },
    },
    doc_summary: { type: 'string', description: 'One or two sentences: what this document is and what it covers.' },
  },
  required: ['one_liner', 'ai_tech', 'founded_year', 'stage_hint', 'funding_note', 'hq', 'summary', 'products', 'customers', 'events', 'doc_summary'],
};

interface DocOut {
  one_liner: string; ai_tech: string; founded_year: number; stage_hint: string;
  funding_note: string; hq: string; summary: string; products: string[];
  customers: string[]; events: { date: string; kind_hint: string; title: string }[];
  doc_summary: string;
}

export async function extractFromDocument(
  companyId: string,
  docId: string,
  steering: string | null,
  feature: string   // 'scout_doc' (admin) | 'portal_scout' (keyholder)
): Promise<{ filled: string[]; eventsAdded: number; eventsSkipped: number }> {
  const company = await one<{
    name: string; one_liner: string | null; ai_tech: string | null;
    founded_year: number | null; stage: CompanyStage; funding_note: string | null; hq: string | null;
  }>(
    `select name, one_liner, ai_tech, founded_year, stage, funding_note, hq
       from companies where id = $1`,
    [companyId]
  );
  if (!company) throw new Error('Unknown company.');
  const doc = await getCompanyDocumentText(docId);
  if (!doc || doc.company_id !== companyId) throw new Error('Unknown document.');

  const known = [
    company.one_liner ? `what they do: ${company.one_liner}` : null,
    company.ai_tech ? `AI tech: ${company.ai_tech.slice(0, 400)}` : null,
    company.stage !== 'unknown' ? `stage: ${company.stage}` : null,
    company.founded_year ? `founded: ${company.founded_year}` : null,
    company.funding_note ? `funding: ${company.funding_note}` : null,
    company.hq ? `hq: ${company.hq}` : null,
  ].filter(Boolean);

  const out = await runStructured<DocOut>({
    system: DOC_SYSTEM,
    user: [
      `COMPANY: ${company.name}`,
      known.length ? `ALREADY KNOWN (do not contradict; fill gaps):\n${known.join('\n')}` : null,
      steering ? `EDITOR'S STEERING FOR THIS PASS (their current priorities, follow it):\n${steering}` : null,
      `DOCUMENT TEXT:\n${doc.text.slice(0, TEXT_CLIP)}`,
    ].filter(Boolean).join('\n\n'),
    toolName: 'submit_document_read',
    toolDescription: 'Submit the extracted company facts, events, and document summary.',
    schema: DOC_SCHEMA,
    maxTokens: 1500,
    effort: 'low',
    feature,
    timeoutMs: 55_000,
    maxRetries: 0,
  });

  const filled = await m.fillCompanyFacts(companyId, {
    one_liner: out.one_liner?.trim() || null,
    ai_tech: out.ai_tech?.trim() || null,
    founded_year: parseFoundedHint(String(out.founded_year ?? '')),
    stage: parseStageHint(out.stage_hint ?? ''),
    funding_note: out.funding_note?.trim().slice(0, 200) || null,
    hq: out.hq?.trim().slice(0, 120) || null,
  });
  await m.mergeCompanyDossier(companyId, {
    summary: out.summary?.trim() || null,
    products: (out.products ?? []).map((p) => String(p)),
    customers: (out.customers ?? []).map((c) => String(c)),
    sources: [],
    updated_by: 'document',
  });
  await m.setDocumentSummary(docId, out.doc_summary?.trim().slice(0, 500) || null);

  const existing = await q<{ title: string; url: string | null }>(
    `select title, url from company_events where company_id = $1`,
    [companyId]
  );
  let eventsAdded = 0;
  let eventsSkipped = 0;
  for (const ev of (out.events ?? []).slice(0, MAX_EVENTS)) {
    const title = String(ev.title ?? '').trim();
    if (!title || !DATE_RE.test(String(ev.date ?? ''))) {
      eventsSkipped += 1;
      continue;
    }
    if (eventExists(existing, { title, url: '' })) {
      eventsSkipped += 1;
      continue;
    }
    await m.createCompanyEvent({
      company_id: companyId,
      event_date: ev.date,
      kind: parseEventKindHint(ev.kind_hint ?? ''),
      title,
      url: null,
      // Public on tracked profiles: neutral wording, NO filename (a name like
      // project-falcon-dd.pdf would disclose intent).
      note: 'From an uploaded document.',
    });
    existing.push({ title, url: null });
    eventsAdded += 1;
  }
  return { filled, eventsAdded, eventsSkipped };
}
