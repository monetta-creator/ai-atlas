// The three original Atlas research tools, moved behind the registry contract
// (behavior identical to the deep route's execTool). Parsers and renderers
// stay in lib/ask/deep.ts, which the old route still uses; scope decides the
// admin/portal flags passed to search.
import { q } from '../db';
import {
  citeToken,
  parseFetchRecordInput,
  parseSearchArticlesInput,
  parseSearchAtlasInput,
  renderArticleHits,
  renderRecord,
  renderSearchHits,
  statusArticles,
  statusRead,
  statusSearch,
} from '../ask/deep';
import { fetchRecord, searchArticles, searchAtlas } from '../ask/search';
import type { AtlasTool, ToolContext } from './types';

const SEARCH_KINDS = ['claim', 'bridge', 'stance', 'concept', 'signal', 'paper', 'thread', 'item', 'fact', 'report', 'history'];
const FETCH_KINDS = ['claim', 'bridge', 'stance', 'question', 'concept', 'signal', 'paper', 'thread', 'item', 'fact', 'report', 'history'];

const flags = (ctx: ToolContext) => (ctx.identity.kind === 'admin' ? { admin: true } : { portal: true });

type SearchIn = Exclude<ReturnType<typeof parseSearchAtlasInput>, string>;
type FetchIn = Exclude<ReturnType<typeof parseFetchRecordInput>, string>;

export const searchAtlasTool: AtlasTool<SearchIn> = {
  name: 'search_atlas',
  description:
    'Full-text and semantic search over the Atlas records: claims, bridge claims, stances, concepts, signals, research papers, research threads, the Atlas\'s own editorial reports (Daily Edition, research roundup, Savant), a backfilled history of dated news items from December 2022 through August 2026, and, for tracked companies, company intelligence items and extracted facts. Returns matching records labeled with the exact bracketed IDs to cite.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search terms, plain words. Terms are OR-combined; records matching more of them rank first.' },
      kinds: { type: 'array', items: { type: 'string', enum: SEARCH_KINDS }, description: 'Restrict the search to these record kinds. Omit to search all of them.' },
      limit: { type: 'integer', description: 'Max results per kind, 1 to 8, default 5.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  scopes: ['admin', 'keyholder'],
  parse: parseSearchAtlasInput,
  async run(p, ctx) {
    const t = ctx.tagger;
    const hits = await searchAtlas(q, p.query, {
      kinds: p.kinds, limit: p.limit, ...flags(ctx),
      tagFor: t.tagFor, paperTagFor: t.paperTagFor, itemTagFor: t.itemTagFor,
      factTagFor: t.factTagFor, reportTagFor: t.reportTagFor, historyTagFor: t.historyTagFor,
    });
    ctx.status?.(statusSearch(p.query, hits.length));
    return { text: renderSearchHits(hits) };
  },
};

export const fetchRecordTool: AtlasTool<FetchIn> = {
  name: 'fetch_record',
  description:
    'Fetch one record in full detail: a claim or bridge with its falsifying test, evidence rows, and touching signals; a stance, question, or concept in full; a signal with its brief, counterpoint, and source; a research paper with its structured finding; a research thread; a company intelligence item; an extracted fact; a passage of an Atlas editorial report; or a dated history item. Use the ID exactly as labeled: a claim or bridge code like 2.3 or B1, a stance code like Q1-S1A, a question, concept, or thread slug, or a tag like S3, P4, I3, X31, R7, H3 from earlier results.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: FETCH_KINDS },
      id: { type: 'string', description: 'The record ID: a code, a slug, or a tag.' },
    },
    required: ['kind', 'id'],
    additionalProperties: false,
  },
  scopes: ['admin', 'keyholder'],
  parse: parseFetchRecordInput,
  async run(p, ctx) {
    const t = ctx.tagger;
    let dbId = p.id;
    if (p.kind === 'signal' || p.kind === 'paper' || p.kind === 'item' || p.kind === 'fact') {
      const uuid = t.idFor(p.id);
      if (!uuid) return { text: `Unknown ${p.kind} tag ${p.id}. Use a tag from a result in this conversation.`, isError: true };
      dbId = uuid;
    } else if (p.kind === 'report') {
      // Map value: 'report:<kind>:<scope>:<uuid>:<section>'; fetchRecord wants '<uuid>:<section>'.
      const descriptor = t.idFor(p.id);
      if (!descriptor) return { text: `Unknown report tag ${p.id}. Use a tag from a result in this conversation.`, isError: true };
      const parts = descriptor.split(':');
      dbId = parts.length === 5 ? `${parts[3]}:${parts[4]}` : descriptor;
    } else if (p.kind === 'history') {
      // Map value: '<uuid>|<url>'; fetchRecord wants the uuid.
      const raw = t.idFor(p.id);
      if (!raw) return { text: `Unknown history tag ${p.id}. Use a tag from a result in this conversation.`, isError: true };
      dbId = raw.split('|')[0];
    }
    const payload = await fetchRecord(q, p.kind, dbId, flags(ctx));
    if (!payload) return { text: `No ${p.kind} found with id ${p.id}.`, isError: true };
    ctx.status?.(statusRead(citeToken(p.kind, p.id)));
    return { text: renderRecord(payload, p.id, t.tagFor) };
  },
};

export const searchArticlesTool: AtlasTool<{ query: string }> = {
  name: 'search_articles',
  description:
    'Search the retained full text of the source articles behind published signals. Returns matching excerpts labeled with the signal each article belongs to. Use when the question needs primary-source language beyond the Atlas summaries.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Search terms, plain words.' } },
    required: ['query'],
    additionalProperties: false,
  },
  // Admin only for now: the keyholder path has never read retained article
  // text through a model loop; widen after a guest-safety review.
  scopes: ['admin'],
  parse: parseSearchArticlesInput,
  async run(p, ctx) {
    const hits = await searchArticles(q, p.query, { tagFor: ctx.tagger.tagFor });
    ctx.status?.(statusArticles(p.query, hits.length));
    return { text: renderArticleHits(hits) };
  },
};
