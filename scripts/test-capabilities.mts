// Capability registry test: every manifest complete (examples, audience, cap,
// known feature slugs), no em dashes, tool manifests match lib/tools, skill
// recipes name only tools that exist, invocation parsing, autocomplete, the
// /help answer and the prompt roster.
// Run: npx -y tsx scripts/test-capabilities.mts
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { CAPABILITIES, helpText, parseInvocation, rosterForPrompt, suggest, capabilitiesFor } from '../lib/capabilities/registry';
import { SKILLS } from '../lib/capabilities/skills';

dotenv.config({ path: '.env.local', quiet: true });
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.error('FAIL', m); } };

// Known slugs: the house label map plus the redo's new slugs.
const formatSrc = readFileSync('lib/format.ts', 'utf8');
const NEW = new Set(['ask_answer', 'ask_decide', 'ask_enhance', 'ask_verify2']);
const fieldReportSlugs = new Set((readFileSync('lib/field-report/research.ts', 'utf8') + readFileSync('lib/field-report/write.ts', 'utf8') + readFileSync('lib/field-report/plan.ts', 'utf8') + readFileSync('lib/field-report/figures.ts', 'utf8') + readFileSync('lib/field-report/run.ts', 'utf8')).match(/field_report_[a-z_]+/g) ?? []);
const known = (f: string) => NEW.has(f) || formatSrc.includes(`${f}:`) || fieldReportSlugs.has(f);

const { TOOLS } = await import('../lib/tools/registry');
const toolNames = new Set(TOOLS.map((t) => t.name));
const PLANNED = new Set(['whats_new', 'search_items', 'timeline', 'company', 'metrics', 'tooling', 'question_map', 'engine_status', 'startups', 'report']);

ok(new Set(CAPABILITIES.map((c) => `${c.kind}:${c.slug}`)).size === CAPABILITIES.length, 'unique slugs per kind');
for (const c of CAPABILITIES) {
  ok(c.audience.length > 0, `${c.slug}: audience`);
  ok(Number.isFinite(c.caps.perRunUsd) && c.caps.perRunUsd >= 0, `${c.slug}: cap`);
  ok(!/—/.test(JSON.stringify(c)), `${c.slug}: no em dash`);
  if (c.kind !== 'tool') ok(c.examples.length > 0 && c.usage.length > 0, `${c.slug}: examples + usage`);
  for (const f of c.features) ok(known(f), `${c.slug}: known feature slug ${f}`);
  if (c.kind === 'tool') ok(toolNames.has(c.slug), `tool manifest ${c.slug} matches lib/tools`);
}
for (const s of SKILLS) {
  for (const t of s.leansOn) ok(toolNames.has(t) || PLANNED.has(t), `/${s.slug} leans on a real or planned tool: ${t}`);
  if (s.slug !== 'help') ok(/em dash/.test(s.instructions) && s.instructions.startsWith(`SKILL /${s.slug}`), `/${s.slug}: recipe header + em dash rule`);
}

const inv = parseInvocation('/brief agentic payments since 2026-10-01', 'admin');
ok(inv?.kind === 'skill' && inv.skill.slug === 'brief' && inv.args === 'agentic payments since 2026-10-01', 'parse /brief');
ok(parseInvocation('/status', 'keyholder')?.kind === 'unknown', 'admin-only skill unknown to keyholders');
ok(parseInvocation('@field-report banks and agents', 'admin')?.kind === 'agent', 'parse @field-report');
ok(parseInvocation('what is /brief', 'admin') === null, 'mid-text slash is not an invocation');
ok(parseInvocation('/nope x', 'admin')?.kind === 'unknown', 'unknown skill');
ok(suggest('/b', 'admin').some((c) => c.slug === 'brief') && suggest('/', 'admin').length === SKILLS.length, 'suggest skills');
ok(suggest('@', 'keyholder').every((c) => c.kind === 'agent'), 'suggest agents');
ok(!capabilitiesFor('keyholder').some((c) => c.slug === 'status' || c.slug === 'search_articles'), 'keyholder catalog excludes admin-only');
const help = helpText('admin');
ok(/\/brief/.test(help) && /@field-report/.test(help) && !/—/.test(help), 'help lists skills and agents');
ok(/suggest it/.test(rosterForPrompt('admin')) && !/\/help/.test(rosterForPrompt('admin')), 'roster');

console.log(fail ? `${fail} failure(s)` : `ok: ${CAPABILITIES.length} capabilities`);
process.exit(fail ? 1 : 0);
