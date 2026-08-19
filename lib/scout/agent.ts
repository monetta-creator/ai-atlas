import { runStructured } from '../dossier';
import * as m from '../mutations';
import { getScoutPrefs, getScoutTasteDigest } from '../data';
import { q } from '../db';
import type { ScoutVerdict } from '../types';

// The scout console's scoring agent: a recommend-only pass over the review
// queue, the research queue-agent pattern applied to acquisition targets. One
// bounded chunk per server action (the console loops); for each company the
// model recommends pursue / watch / pass with a one-line reason, a confidence,
// and five 1-5 rubric scores. Grounding: the editable acquisition rubric
// (scout_prefs.rubric, DEFAULT_RUBRIC when null), the standing steering note,
// the active verticals, and a digest of past human decisions (revealed taste).
// Nothing here writes status: the human tracks or dismisses, per row or in bulk.

const SCOUT_CHUNK = 10;

export const DEFAULT_RUBRIC = [
  'The acquirer is a large enterprise in the middle of an AI transformation, buying AI technology and teams rather than revenue. Score every company 1 to 5 on five dimensions:',
  'ai_depth: is there real, defensible AI technology (models, data advantages, an applied research bench), or a thin wrapper on foundation-model APIs? 5 = deep and hard to replicate.',
  'acquisition_fit: does the tech slot into the active verticals and the transformation goals? 5 = direct fit.',
  'traction: customers, revenue, adoption signals, notable deployments. 5 = strong verified traction.',
  'team: technical bench strength, founder pedigree, research talent. 5 = exceptional.',
  'integration_cost: how cleanly the tech and team would absorb into a large enterprise (stack, compliance, size). 5 = cheap and clean to absorb.',
  'Verdict: pursue = open a file, worth active evaluation now (rare, only the clearly strongest). watch = keep on the radar, re-evaluate on the next funding round or launch. pass = not an acquisition candidate for this thesis (thin wrappers, consumer toys, stale companies, no real tech).',
].join('\n');

const AGENT_SYSTEM_HEAD = [
  'You are the scoring agent for Startup Scout, the acquisition-target funnel of The AI Atlas.',
  'Discovery has already screened these companies for youth (roughly pre-seed through Series B); your job is the next decision, the one the human editor makes for every company: recommend exactly one of pursue, watch, or pass, and score the rubric.',
  'For every company: reason = one short sentence in plain language arguing the verdict for THIS acquirer (for pursue, write it as the "why track" note the editor would keep). confidence = 0-100, how sure you are given the evidence available. Web-sourced facts are thin; score what is stated, do not invent traction or team facts that were not given.',
  'Respect the steering note above everything else when present: it is the editor\'s current priorities.',
  'Learn the editor\'s taste from the decision history: what they tracked (and why) and what they dismissed. Match that revealed preference.',
  'Never use an em dash anywhere; use a comma or a colon instead.',
].join(' ');

function buildSchema(ids: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', enum: ids },
            verdict: { type: 'string', enum: ['pursue', 'watch', 'pass'] },
            // The Anthropic tool validator rejects minimum/maximum on integers;
            // ranges live in descriptions and the writer clamps.
            confidence: { type: 'integer', description: '0 to 100' },
            reason: { type: 'string' },
            scores: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ai_depth: { type: 'integer', description: '1 to 5' },
                acquisition_fit: { type: 'integer', description: '1 to 5' },
                traction: { type: 'integer', description: '1 to 5' },
                team: { type: 'integer', description: '1 to 5' },
                integration_cost: { type: 'integer', description: '1 to 5' },
              },
              required: ['ai_depth', 'acquisition_fit', 'traction', 'team', 'integration_cost'],
            },
          },
          required: ['id', 'verdict', 'confidence', 'reason', 'scores'],
        },
      },
    },
    required: ['decisions'],
  };
}

// Run-static context (rubric + steering + taste + verticals) rides in the
// SYSTEM block, cache_control'd by runStructured, so chunks 2..N read it from
// cache.
async function buildSystem(): Promise<string> {
  const [prefs, taste, verticals] = await Promise.all([
    getScoutPrefs(),
    getScoutTasteDigest(),
    q<{ slug: string; name: string; description: string | null }>(
      `select slug, name, description from scout_verticals where active order by name`
    ),
  ]);
  const parts: string[] = [AGENT_SYSTEM_HEAD];
  parts.push(`\n\nTHE ACQUISITION RUBRIC:\n${(prefs.rubric?.trim() || DEFAULT_RUBRIC).slice(0, 4000)}`);
  if (prefs.steering?.trim()) {
    parts.push(`\n\nSTEERING NOTE from the editor (their current priorities, follow it):\n${prefs.steering.trim().slice(0, 1500)}`);
  }
  parts.push(
    '\n\nACTIVE VERTICALS (the fit target):',
    ...verticals.map((v) => `- ${v.name}${v.description ? `: ${v.description}` : ''}`),
    '\nDECISION HISTORY (the editor\'s revealed taste):',
    'Tracked:',
    ...taste.tracked.map((t) => `- "${t.name}"${t.note ? ` (why: ${t.note.slice(0, 140)})` : ''}`),
    'Dismissed:',
    ...taste.dismissed.map((n) => `- "${n}"`)
  );
  return parts.join('\n');
}

interface ScoutChunkResult {
  processed: number;
  pursue: number;
  watch: number;
  pass: number;
}

export async function scoreScoutChunk(companyIds: string[]): Promise<ScoutChunkResult> {
  const ids = companyIds.slice(0, SCOUT_CHUNK);
  const companies = await q<{
    id: string; name: string; domain: string | null; vertical: string;
    one_liner: string | null; ai_tech: string | null; founded_year: number | null;
    stage: string; funding_note: string | null; hq: string | null;
  }>(
    `select id::text as id, name, domain, vertical, one_liner, ai_tech,
            founded_year, stage, funding_note, hq
       from companies
      where id = any($1::uuid[]) and status = 'queued'`,
    [ids]
  );
  if (!companies.length) return { processed: 0, pursue: 0, watch: 0, pass: 0 };

  const user = [
    'COMPANIES TO SCORE (recommend exactly one verdict for each id):',
    ...companies.map((c) => [
      `id: ${c.id}`,
      `name: ${c.name}${c.domain ? ` (${c.domain})` : ''}`,
      `vertical: ${c.vertical}`,
      c.one_liner ? `what they do: ${c.one_liner}` : null,
      c.ai_tech ? `AI tech: ${c.ai_tech.slice(0, 500)}` : null,
      c.stage !== 'unknown' ? `stage: ${c.stage}` : null,
      c.founded_year ? `founded: ${c.founded_year}` : null,
      c.funding_note ? `funding: ${c.funding_note}` : null,
      c.hq ? `hq: ${c.hq}` : null,
    ].filter(Boolean).join('\n')),
  ].join('\n\n');

  const out = await runStructured<{
    decisions: {
      id: string; verdict: ScoutVerdict; confidence: number; reason: string;
      scores: { ai_depth: number; acquisition_fit: number; traction: number; team: number; integration_cost: number };
    }[];
  }>({
    system: await buildSystem(),
    user,
    toolName: 'submit_scout_decisions',
    toolDescription: 'Submit one recommended verdict and rubric scores per company id.',
    schema: buildSchema(companies.map((c) => c.id)),
    maxTokens: 2800,
    effort: 'low',
    feature: 'scout_agent',
    timeoutMs: 55_000,
    maxRetries: 0,
  });

  const valid = new Set(companies.map((c) => c.id));
  const rows = (out.decisions ?? [])
    .filter((d) => valid.has(d.id))
    .map((d) => ({
      id: d.id,
      verdict: d.verdict,
      confidence: d.confidence,
      reason: (d.reason ?? '').trim().slice(0, 500),
      scores: d.scores,
    }));
  const processed = await m.setScoutRecommendations(rows);
  return {
    processed,
    pursue: rows.filter((r) => r.verdict === 'pursue').length,
    watch: rows.filter((r) => r.verdict === 'watch').length,
    pass: rows.filter((r) => r.verdict === 'pass').length,
  };
}
