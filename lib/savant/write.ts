import { marked } from 'marked';
import { routedStructured } from '../model-route';
import { selfRecordBlock } from './self-record-block';
import type { SavantPack, HypothesisReading, SavantDepartment, Hypothesis } from './types';
import type { LeadResult } from './lead';

// Savant's department writers (2026-09-26): three structured calls on
// savant_prefs.writer_model over the frozen pack and the finished lead.
// Leg 1 writes the executive summary and the hypotheses page (the fresh
// hypothesis and a reading of every open one). Leg 2 writes the six data
// departments from the pack's rows. Leg 3 writes the peer and market watch
// from the metric tables. Every leg returns markdown; the orchestrator
// renders it and runs the citation gate. The voice rules are the edition
// column's: argue for a general reader, never name the machinery.

export const deDash = (s: string): string => s.replace(/\s*—\s*/g, ', ');

export const VOICE =
  `Write for people doing AI transformation inside large regulated financial-services companies and for the ` +
  `executives who read over their shoulders: plain, concrete, confident, no praise, no throat-clearing, no ` +
  `hedging clouds. Link sources on a natural phrase of the sentence using the EXACT url or href given; never ` +
  `invent a link or a figure. Never write the words claim, bridge-claim, confidence, argument map, logic tree, ` +
  `or a bare position code like 1.2 or B4; a standing position is linked by wrapping the position itself in a ` +
  `link to its exact href. Never state anything about the reader organization that is not in a linked public ` +
  `record. Never use an em dash; use a comma, a colon, or separate sentences.`;

// Departments carry their own titles; a heading the model adds on top
// ("Peer & Market Watch, Week Ending ...") is dropped, as are any headings
// inside (bold lead-ins are the house style).
const md2html = (md: string): string => {
  const clean = deDash(md).trim().replace(/^#{1,6}\s+[^\n]*\n+/, '').replace(/\n#{1,6}\s+([^\n]*)/g, '\n**$1**');
  return marked.parse(clean, { async: false }) as string;
};

// ---------------------------------------------------------------- leg 1

const LEG1_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'array', items: { type: 'string' }, description: 'exactly 5 bullets in markdown, each one sentence with one link' },
    fresh_md: { type: 'string', description: 'one paragraph presenting this week\'s new hypothesis: what it says, why now, what would settle it; markdown with links' },
    readings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' },
          direction: { type: 'string', description: 'strengthened | weakened | unchanged | closed' },
          note_md: { type: 'string', description: 'one paragraph on what this week did to it, with links to the records that moved it' },
          verdict: { type: 'string', description: 'only when direction is closed: the verdict in one sentence; else empty string' },
        },
        required: ['id', 'direction', 'note_md', 'verdict'],
      },
    },
  },
  required: ['summary', 'fresh_md', 'readings'],
};

function fmtHypothesis(h: Hypothesis): string {
  const updates = h.updates.slice(-3).map((u) => `    ${u.week}: ${u.direction}: ${u.note}`).join('\n');
  return `- id ${h.id}: "${h.statement}" (posed ${h.posed_week}, status ${h.status})\n    would settle: ${h.what_would_settle.join('; ')}\n    watch: ${h.watch.join('; ')}${updates ? `\n${updates}` : ''}`;
}

export async function writeSummaryAndHypotheses(pack: SavantPack, lead: LeadResult, model: string): Promise<{
  summary: string[]; freshHtml: string | null; readings: HypothesisReading[];
}> {
  const openById = new Map(pack.hypotheses.open.map((h) => [h.id, h]));
  const user = [
    `WEEK ENDING ${pack.weekEnd}, issue No. ${pack.issueNumber}.`,
    '',
    `LEAD ANALYSIS: "${lead.title}"`,
    lead.markdown.slice(0, 7000),
    '',
    pack.hypotheses.fresh
      ? `THIS WEEK'S NEW HYPOTHESIS: "${pack.hypotheses.fresh.statement}"\n  would settle: ${pack.hypotheses.fresh.what_would_settle.join('; ')}\n  watch: ${pack.hypotheses.fresh.watch.join('; ')}\n  the lead's reading of it: ${lead.reading}: ${lead.readingNote}`
      : 'THIS WEEK\'S NEW HYPOTHESIS: none recorded.',
    '',
    'OPEN HYPOTHESES FROM EARLIER ISSUES (one reading each, with links to the records that moved it; "unchanged" is a fine answer):',
    pack.hypotheses.open.length ? pack.hypotheses.open.map(fmtHypothesis).join('\n') : '- none',
    '',
    'RECORDS THIS WEEK (title, href or url):',
    ...pack.moved.signals.slice(0, 15).map((s) => `- signal "${s.title}" ${s.href}`),
    ...pack.notebook.connections.slice(0, 12).map((c) => `- ${c.record.kind} "${c.record.title}" ${c.record.href ?? c.record.url} ~ position ${c.target.code} "${c.target.statement}" ${c.target.href}`),
    ...pack.notebook.anomalies.slice(0, 8).map((a) => `- anomaly: ${a.note}`),
    '',
    'Write: the 5-bullet executive summary of the whole issue (lead first, then the one or two most consequential department facts, each bullet one sentence with one link), the paragraph presenting the new hypothesis, and one reading per open hypothesis.',
  ].join('\n');
  const out = await routedStructured<{ summary?: unknown; fresh_md?: unknown; readings?: unknown }>({
    model, system: `You are Savant, writing the front of its weekly report. ${VOICE}`, user,
    toolName: 'submit_front', toolDescription: 'Return the executive summary, the new hypothesis paragraph, and the hypothesis readings.',
    schema: LEG1_SCHEMA, maxTokens: 3000, timeoutMs: 120_000, feature: 'savant_sections', metadata: { week_end: pack.weekEnd, leg: 'front' },
  });
  const summary = (Array.isArray(out.summary) ? out.summary : []).filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 6).map(md2html);
  const freshHtml = typeof out.fresh_md === 'string' && out.fresh_md.trim() && pack.hypotheses.fresh ? md2html(out.fresh_md) : null;
  const readings: HypothesisReading[] = [];
  for (const r of Array.isArray(out.readings) ? (out.readings as Record<string, unknown>[]) : []) {
    const h = openById.get(String(r.id ?? ''));
    if (!h) continue;
    const d = String(r.direction ?? 'unchanged').toLowerCase();
    const direction: HypothesisReading['direction'] = d.includes('strength') ? 'strengthened' : d.includes('weak') ? 'weakened' : d.includes('clos') ? 'closed' : 'unchanged';
    const note = deDash(String(r.note_md ?? '')).trim();
    readings.push({ id: h.id, statement: h.statement, posedWeek: h.posed_week, direction, note, html: md2html(note), verdict: direction === 'closed' && typeof r.verdict === 'string' && r.verdict.trim() ? deDash(r.verdict).trim() : null });
  }
  // Every open hypothesis gets a line even when the model skipped it.
  for (const h of pack.hypotheses.open) {
    if (!readings.find((x) => x.id === h.id)) readings.push({ id: h.id, statement: h.statement, posedWeek: h.posed_week, direction: 'unchanged', note: 'Nothing in this week\'s record bore on it.', html: '<p>Nothing in this week\'s record bore on it.</p>', verdict: null });
  }
  return { summary, freshHtml, readings };
}

// ---------------------------------------------------------------- leg 2

const DEPT_TITLES: Record<SavantDepartment['key'], string> = {
  moved: 'What moved on the map',
  peers: 'Peer and market watch',
  regulation: 'Regulation and policy',
  research: 'Research desk',
  tools: 'Tools and builders',
  missed: 'Missed and blind spots',
  ahead: 'The week ahead',
};

const EMPTY_NOTICE: Record<SavantDepartment['key'], string> = {
  moved: 'No new evidence reached the map this week.',
  peers: 'No peer metrics were available this week.',
  regulation: 'No regulatory development the desk tracks moved this week.',
  research: 'No paper the desk analyzed this week changes a view.',
  tools: 'No new tools, releases or builder reads this week.',
  missed: 'Nothing the desk knows it missed this week.',
  ahead: 'No dated item in the corpus falls in the next thirty days.',
};

const LEG2_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    moved_md: { type: 'string' }, regulation_md: { type: 'string' }, research_md: { type: 'string' },
    tools_md: { type: 'string' }, missed_md: { type: 'string' }, ahead_md: { type: 'string' },
  },
  required: ['moved_md', 'regulation_md', 'research_md', 'tools_md', 'missed_md', 'ahead_md'],
};

function line(title: string, href: string | null, extra?: string): string {
  return `- "${title}"${href ? ` ${href}` : ''}${extra ? ` (${extra})` : ''}`;
}

export async function writeDepartments(pack: SavantPack, model: string): Promise<SavantDepartment[]> {
  const m = pack.moved;
  const user = [
    `WEEK ENDING ${pack.weekEnd}. Write six short departments in markdown (80 to 220 words each, one or two paragraphs, links on natural phrases using the EXACT hrefs/urls below). A department whose data says "none" returns an empty string.`,
    '',
    `WHAT MOVED: evidence rows this week: ${m.evidenceByDirection.supports} supports, ${m.evidenceByDirection.contradicts} contradicts, ${m.evidenceByDirection.neutral} neutral; by lens ${Object.entries(m.evidenceByLens).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}; signals published by lens ${Object.entries(m.signalsByLens).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
    'Positions that gained the most evidence (code, statement, href, evidence/supports/contradicts):',
    ...(m.topClaims.length ? m.topClaims.map((c) => `- ${c.code} "${c.statement}" ${c.href} (${c.evidence} rows: ${c.supports} for, ${c.contradicts} against)`) : ['- none']),
    'Notable signals:',
    ...m.signals.slice(0, 10).map((s) => line(s.title, s.href, s.lens ?? undefined)),
    '',
    'REGULATION AND POLICY (title, href/url, date):',
    ...(pack.regulation.length ? pack.regulation.map((r) => line(r.title, r.href ?? r.url, r.date ?? undefined)) : ['- none']),
    '',
    'RESEARCH (title, href, the finding, marks):',
    ...(pack.research.length ? pack.research.map((p) => `- "${p.title}" ${p.href}: ${p.finding ?? p.whoCares ?? ''} [${p.weight?.kicker ?? ''}]`) : ['- none']),
    '',
    'TOOLS: new entrants (name, href, one-liner):',
    ...(pack.tools.entrants.length ? pack.tools.entrants.map((t) => `- ${t.name} ${t.href}: ${t.oneLiner ?? ''}`) : ['- none']),
    'vendor releases (product, title, url):',
    ...(pack.tools.releases.length ? pack.tools.releases.map((r) => `- ${r.productName}: "${r.title}" ${r.url ?? r.productHref} (${r.kind}, ${r.date})`) : ['- none']),
    'builder reads (title, url, why):',
    ...(pack.tools.reads.length ? pack.tools.reads.map((r) => `- "${r.title}" ${r.url ?? r.hnUrl}: ${r.line ?? ''}`) : ['- none']),
    '',
    'MISSED AND BLIND SPOTS:',
    ...(pack.notebook.misses.length ? pack.notebook.misses.map((x) => `- ${x.headline}${x.url ? ` ${x.url}` : ''}: ${x.detail}`) : ['- none']),
    '',
    'THE WEEK AHEAD (date, what, url/href):',
    ...(pack.ahead.length ? pack.ahead.map((a) => `- ${a.date}: ${a.what} ${a.href ?? a.url ?? ''}`) : ['- none']),
  ].join('\n');
  const out = await routedStructured<Record<string, unknown>>({
    model, system: `You are Savant, writing the departments of its weekly report. ${VOICE}`, user,
    toolName: 'submit_departments', toolDescription: 'Return the six departments as markdown strings.',
    schema: LEG2_SCHEMA, maxTokens: 4000, timeoutMs: 150_000, feature: 'savant_sections', metadata: { week_end: pack.weekEnd, leg: 'departments' },
  });
  const dept = (key: SavantDepartment['key'], md: unknown): SavantDepartment => {
    const text = typeof md === 'string' ? deDash(md).trim() : '';
    return text
      ? { key, title: DEPT_TITLES[key], html: md2html(text), empty: false }
      : { key, title: DEPT_TITLES[key], html: `<p class="sv-empty">${EMPTY_NOTICE[key]}</p>`, empty: true };
  };
  return [
    dept('moved', out.moved_md), dept('regulation', out.regulation_md), dept('research', out.research_md),
    dept('tools', out.tools_md), dept('missed', out.missed_md), dept('ahead', out.ahead_md),
  ];
}

// ---------------------------------------------------------------- leg 3

const LEG3_SCHEMA = { type: 'object', additionalProperties: false, properties: { peers_md: { type: 'string' } }, required: ['peers_md'] };

function fmtCell(latest: number | null, unit: string): string {
  if (latest == null) return 'n/a';
  switch (unit) {
    case 'usd_thousands': return `$${(latest * 1000 / 1e9).toFixed(1)}B`;
    case 'usd': return `$${(latest / 1e9).toFixed(1)}B`;
    case 'percent': return `${latest.toFixed(2)}%`;
    case 'per_share': return latest.toFixed(2);
    default: return Math.round(latest).toLocaleString('en-US');
  }
}

export async function writePeers(pack: SavantPack, model: string): Promise<SavantDepartment> {
  const rows = [...(pack.peers.self ? [pack.peers.self] : []), ...pack.peers.tiers.flatMap((t) => t.rows)];
  if (!rows.length) return { key: 'peers', title: DEPT_TITLES.peers, html: `<p class="sv-empty">${EMPTY_NOTICE.peers}</p>`, empty: true };
  const table = rows.map((r) => {
    const cells = r.metrics.filter((c) => c.latest != null).map((c) => `${c.label} ${fmtCell(c.latest, c.unit)}${c.pct != null ? ` (${c.pct >= 0 ? '+' : ''}${(c.pct * 100).toFixed(1)}% vs prior period)` : ''} [${c.source}: ${c.sourceUrl ?? 'n/a'}]`);
    return `- ${r.isSelf ? 'READER ORGANIZATION: ' : ''}${r.name} (${r.tier}): ${cells.join('; ') || 'no metrics'}; AI-related items this week ${r.aiItems} vs trailing ${r.aiItemsTrailing}/week; facts extracted ${r.facts}; CFPB complaints ${r.cfpb.latest ?? 'n/a'} in ${r.cfpb.period ?? 'n/a'} vs ${r.cfpb.prev ?? 'n/a'} prior month [${r.cfpb.sourceUrl ?? ''}]; open AI/ML roles ${r.hiring.aiMl ?? 'n/a'}${r.filings.length ? `; filings this week: ${r.filings.map((f) => `"${f.title}" ${f.url}`).join(', ')}` : ''}`;
  });
  const user = [
    `WEEK ENDING ${pack.weekEnd}. Write the peer and market watch, 200 to 400 words in two or three paragraphs, from the table below (and the reader organization's public record, if given) and nothing else.`,
    pack.self ? `The reader organization is ${pack.self.name} (public description: ${pack.self.public_blurb ?? 'none given'}). Compare it to its tiers where the numbers allow; where it lacks a series, say so in a clause and move on.` : 'No reader organization is set; compare the tiers to each other.',
    pack.self ? selfRecordBlock(pack.self) : '',
    'Lead with what changed, not with the level. Every figure you write must appear in the table; link each source series the first time you use it (the bracketed url after each cell). Do not editorialize about any company\'s intentions; describe what the public numbers show.',
    '',
    'TABLE:',
    ...table,
  ].filter(Boolean).join('\n');
  const out = await routedStructured<{ peers_md?: unknown }>({
    model, system: `You are Savant, writing the peer and market watch of its weekly report. ${VOICE}`, user,
    toolName: 'submit_peers', toolDescription: 'Return the peer and market watch as markdown.',
    schema: LEG3_SCHEMA, maxTokens: 2000, timeoutMs: 120_000, feature: 'savant_sections', metadata: { week_end: pack.weekEnd, leg: 'peers' },
  });
  const text = typeof out.peers_md === 'string' ? deDash(out.peers_md).trim() : '';
  return text
    ? { key: 'peers', title: DEPT_TITLES.peers, html: md2html(text), empty: false }
    : { key: 'peers', title: DEPT_TITLES.peers, html: `<p class="sv-empty">${EMPTY_NOTICE.peers}</p>`, empty: true };
}

export { DEPT_TITLES, md2html };
