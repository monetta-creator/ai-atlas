// The capability registry: every skill, agent, and tool the bar can reach,
// from their manifests. Generates the composer's `/` and `@` menus, the /help
// answer (no model call), the /capabilities catalog, and the roster line the
// model sees so it can suggest a skill. Import-free (client-safe).
import { SKILLS } from './skills';
import { trigger, type AgentManifest, type Audience, type Capability, type SkillManifest, type ToolManifest } from './types';

export const AGENTS: AgentManifest[] = [
  {
    kind: 'agent', slug: 'field-report', title: 'Field Report',
    oneLiner: 'A labeled, cited research report on a question, with a PDF. Plan first, then it runs in the background.',
    usage: '@field-report <question>',
    examples: ['@field-report how are large banks governing agentic AI', '@field-report open-weight models in regulated firms'],
    audience: ['admin', 'keyholder'],
    features: ['field_report_plan', 'field_report_research', 'field_report_web', 'field_report_write', 'field_report_figures', 'field_report_editor', 'field_report_revise'],
    caps: { perRunUsd: 2 },
    typical: { seconds: 420, usd: 0.66 },
    artifact: { kind: 'page+pdf', hrefPattern: '/field-reports/<id>' },
    launch: 'field_report_toggle',
  },
];

const tool = (slug: string, title: string, oneLiner: string, audience: Audience[]): ToolManifest => ({
  kind: 'tool', slug, title, oneLiner, usage: 'used by the model when a question needs it', examples: [], audience, features: ['ask_answer'], caps: { perRunUsd: 0 },
});

// Tools the model calls on its own. Names must match lib/tools (tested).
export const TOOL_MANIFESTS: ToolManifest[] = [
  tool('search_atlas', 'Search the Atlas', 'Search claims, signals, papers, reports, company items and facts, and history.', ['admin', 'keyholder']),
  tool('fetch_record', 'Open a record', 'Read one record in full: evidence, sources, findings.', ['admin', 'keyholder']),
  tool('search_articles', 'Search source articles', 'Search the retained text of the articles behind signals.', ['admin']),
  tool('whats_new', 'What is new', 'Everything collected since a date, grouped by engine.', ['admin', 'keyholder']),
  tool('search_items', 'Search news items', 'News and company items with date, company, and topic filters.', ['admin', 'keyholder']),
  tool('timeline', 'Timeline', 'Dated history items and signals on a topic.', ['admin', 'keyholder']),
  tool('company', 'Company', 'A tracked company: registry row, facts, items, history.', ['admin', 'keyholder']),
  tool('metrics', 'Metrics', 'Company metric series (filings, call reports, complaints, hiring) as a table.', ['admin', 'keyholder']),
  tool('question_map', 'Question map', 'A map question: stances, claims, edges, evidence balance.', ['admin', 'keyholder']),
  tool('report', 'Reports', 'Sections of the Atlas reports (Savant, Daily Edition, roundup).', ['admin', 'keyholder']),
  tool('tooling', 'Tooling market', 'AI tools and vendors from the Tooling Monitor.', ['admin', 'keyholder']),
  tool('show_view', 'Show a view', 'A table, timeline, or chart the server builds from a query, every row cited.', ['admin', 'keyholder']),
  tool('startups', 'Startups', 'Scout companies in a space, with verdicts.', ['admin']),
  tool('engine_status', 'Engine status', 'Engine runs, failures, and spend.', ['admin']),
];

export const CAPABILITIES: Capability[] = [...SKILLS, ...AGENTS, ...TOOL_MANIFESTS];

export function capabilitiesFor(audience: Audience): Capability[] {
  return CAPABILITIES.filter((c) => c.audience.includes(audience));
}

export function findSkill(slug: string, audience: Audience): SkillManifest | null {
  const s = SKILLS.find((x) => x.slug === slug.toLowerCase());
  return s && s.audience.includes(audience) ? s : null;
}

export function findAgent(slug: string, audience: Audience): AgentManifest | null {
  const a = AGENTS.find((x) => x.slug === slug.toLowerCase());
  return a && a.audience.includes(audience) ? a : null;
}

export type Invocation =
  | { kind: 'skill'; skill: SkillManifest; args: string }
  | { kind: 'agent'; agent: AgentManifest; args: string }
  | { kind: 'unknown'; trigger: string };

// A turn that starts with /name or @name. Plain text returns null.
export function parseInvocation(text: string, audience: Audience): Invocation | null {
  const m = /^\s*([/@])([a-z][a-z0-9-]{0,40})\b\s*([\s\S]*)$/i.exec(text);
  if (!m) return null;
  const [, sigil, name, rest] = m;
  if (sigil === '/') {
    const skill = findSkill(name, audience);
    return skill ? { kind: 'skill', skill, args: rest.trim() } : { kind: 'unknown', trigger: `/${name}` };
  }
  const agent = findAgent(name, audience);
  return agent ? { kind: 'agent', agent, args: rest.trim() } : { kind: 'unknown', trigger: `@${name}` };
}

// Autocomplete entries for a typed prefix ("/" or "@" plus letters).
export function suggest(prefix: string, audience: Audience): Capability[] {
  const m = /^([/@])([a-z0-9-]*)$/i.exec(prefix.trim());
  if (!m) return [];
  const kind = m[1] === '/' ? 'skill' : 'agent';
  const q = m[2].toLowerCase();
  return capabilitiesFor(audience).filter((c) => c.kind === kind && (c.slug.startsWith(q) || c.title.toLowerCase().includes(q)));
}

const cost = (usd: number) => (usd < 0.01 ? 'under 1¢' : usd < 1 ? `about ${Math.round(usd * 100)}¢` : `about $${usd.toFixed(2)}`);

// The /help answer, written from the manifests (no model call).
export function helpText(audience: Audience): string {
  const caps = capabilitiesFor(audience);
  const lines: string[] = ['**Ask anything.** The Atlas reads what the question needs, picks a model (Auto), researches its records, and cites them. You can also call these by name:', ''];
  const skills = caps.filter((c): c is SkillManifest => c.kind === 'skill');
  lines.push('**Skills** (answer in the thread)');
  for (const s of skills) lines.push(`${s.usage}: ${s.oneLiner} e.g. ${s.examples[0]}`);
  const agents = caps.filter((c): c is AgentManifest => c.kind === 'agent');
  if (agents.length) {
    lines.push('', '**Agents** (run in the background, produce a report)');
    for (const a of agents) lines.push(`${a.usage}: ${a.oneLiner}${a.typical ? ` Usually ${Math.round(a.typical.seconds / 60)} min, ${cost(a.typical.usd)}.` : ''}`);
  }
  lines.push('', '**Tools the model uses on its own**');
  for (const t of caps.filter((c) => c.kind === 'tool')) lines.push(`${t.title}: ${t.oneLiner}`);
  lines.push('', 'The full catalog lives at /capabilities.');
  return lines.join('\n');
}

// One roster paragraph for the system prompt, so the model can suggest a skill
// or agent by name (it never launches one itself).
export function rosterForPrompt(audience: Audience): string {
  const caps = capabilitiesFor(audience).filter((c) => c.kind !== 'tool' && c.slug !== 'help');
  return `The reader can call these by name; when one would serve them better than this answer, suggest it in one short line at the end (never launch it yourself): ${caps.map((c) => `${trigger(c)} (${c.oneLiner.replace(/\.$/, '')})`).join('; ')}.`;
}
