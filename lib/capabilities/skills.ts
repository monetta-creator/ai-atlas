// The first skills (redo Phase 4, P4.5): recipes that change HOW an answer
// is produced and finish in the thread. Each recipe rides the turn as a
// mid-conversation system message (Anthropic 5.5 models) or a system turn
// (OpenRouter), after the cached prefix, so the cache stays warm. No em
// dashes anywhere (user-facing and model-facing). `help` never calls a model.
import type { SkillManifest } from './types';

const COMMON = 'Cite every record by its bracketed ID. Never use an em dash.';

export const SKILLS: SkillManifest[] = [
  {
    kind: 'skill', slug: 'brief', title: 'Brief',
    oneLiner: 'What happened on a topic, dated and cited, newest first.',
    usage: '/brief <topic> [since YYYY-MM-DD or "last week"]',
    examples: ['/brief agentic payments', '/brief open-weight models since 2026-10-01'],
    audience: ['admin', 'keyholder'], features: ['ask_answer'], caps: { perRunUsd: 0.1 },
    leansOn: ['whats_new', 'search_items', 'search_atlas', 'timeline'],
    depth: '2',
    instructions: `SKILL /brief. Produce a dated brief on the topic the reader named. Steps: call whats_new (since the date given, else 14 days) and search_atlas or search_items on the topic; fetch the two or three records that carry the most weight. Write: a one-line bottom line, then the developments newest first, each as a bold date and one or two sentences with its citation, then "What it means for a bank" in two or three sentences, then "Unsettled" in one or two sentences. Skip anything off-topic even if it is recent. ${COMMON}`,
  },
  {
    kind: 'skill', slug: 'company', title: 'Company read',
    oneLiner: 'A company read: AI moves, filings, metrics, and a dated timeline.',
    usage: '/company <name or slug>',
    examples: ['/company JPMorgan', '/company bank-of-america'],
    audience: ['admin', 'keyholder'], features: ['ask_answer'], caps: { perRunUsd: 0.1 },
    leansOn: ['company', 'metrics', 'search_items', 'timeline'],
    depth: '3',
    instructions: `SKILL /company. Produce a company read for the company named. Steps: call company for the registry row, facts and items; call metrics for the series that matter (technology spend, efficiency, headcount where tracked); search_items for recent AI news on it. Write sections: **Bottom line** (two sentences), **AI moves** (dated, cited), **Numbers** (only figures that appear in tool results, each with its period and citation; never compute or estimate a figure), **Timeline** (dated lines), **Watch for** (two items). Say plainly where the records are thin. ${COMMON}`,
  },
  {
    kind: 'skill', slug: 'compare', title: 'Compare',
    oneLiner: 'Two or more things laid side by side on the dimensions that matter.',
    usage: '/compare <A> vs <B> [on <dimension>]',
    examples: ['/compare frontier vs open-weight models on cost', '/compare JPMorgan vs Bank of America on AI spend'],
    audience: ['admin', 'keyholder'], features: ['ask_answer'], caps: { perRunUsd: 0.15 },
    leansOn: ['search_atlas', 'company', 'metrics', 'tooling'],
    depth: '3',
    instructions: `SKILL /compare. Compare the things the reader named. Research each side with the same tools so the comparison is fair. Write: a one-line verdict labeled "One reading:" if the records lean, then a comparison as bold dimension headers with one short paragraph per dimension stating each side with citations, then "Where they are the same", then "What would change the comparison". Never put a figure on one side that the records do not give for that side; write "not tracked" instead. ${COMMON}`,
  },
  {
    kind: 'skill', slug: 'timeline', title: 'Timeline',
    oneLiner: 'A dated sequence on a topic, from ChatGPT to now.',
    usage: '/timeline <topic> [from] [to]',
    examples: ['/timeline EU AI Act', '/timeline AI chip export controls 2023-01-01 2026-11-01'],
    audience: ['admin', 'keyholder'], features: ['ask_answer'], caps: { perRunUsd: 0.1 },
    leansOn: ['timeline', 'search_atlas'],
    depth: '2',
    instructions: `SKILL /timeline. Produce a dated sequence on the topic. Call timeline for the range (default from 2022-12-01 to today), then search_atlas for the map claims the sequence bears on. Write one line per event: a bold date, what happened, its citation. Group into phases with a bold phase header when the sequence is long. End with one paragraph on the turning points and which map claim they moved. ${COMMON}`,
  },
  {
    kind: 'skill', slug: 'papers', title: 'Papers',
    oneLiner: 'What the research literature says on a question.',
    usage: '/papers <question>',
    examples: ['/papers does inference-time compute keep paying off', '/papers benchmark contamination'],
    audience: ['admin', 'keyholder'], features: ['ask_answer'], caps: { perRunUsd: 0.1 },
    leansOn: ['search_atlas'],
    depth: '2',
    instructions: `SKILL /papers. Answer from research papers and research threads first: search_atlas with kinds ["paper","thread"], then fetch the strongest papers. Write: the state of the literature in two sentences, then each relevant paper as its finding in plain words, its method in a phrase, and its limits, cited; then where papers disagree; then the map claim they bear on. Paper findings are readings of the literature, not settled evidence: say so where it matters. ${COMMON}`,
  },
  {
    kind: 'skill', slug: 'argue', title: 'Argue',
    oneLiner: 'The strongest case each way on a question or claim, and what would move it.',
    usage: '/argue <question, claim code, or position>',
    examples: ['/argue the capex boom is a bubble', '/argue 5.2'],
    audience: ['admin', 'keyholder'], features: ['ask_answer'], caps: { perRunUsd: 0.15 },
    leansOn: ['question_map', 'search_atlas'],
    depth: '3',
    instructions: `SKILL /argue. Steelman both sides. Call question_map for the question or claim, then fetch the strongest evidence on each side. Write: **The question** (one line, in the map's terms), **Strongest case for** and **Strongest case against** (each the best three records, cited, argued as their holders would argue them), **What would settle it** (the falsifying tests from the claims), and only then **One reading:** with the single record that most limits it. If the reader stated a position, test it, do not adopt it. ${COMMON}`,
  },
  {
    kind: 'skill', slug: 'status', title: 'Status',
    oneLiner: 'How the engines are running: last runs, failures, spend.',
    usage: '/status',
    examples: ['/status'],
    audience: ['admin'], features: ['ask_answer'], caps: { perRunUsd: 0.05 },
    leansOn: ['engine_status'],
    depth: '1',
    instructions: `SKILL /status. Call engine_status once and report: anything failed or stale first (engine, day, what the notes say), then one line per engine that ran normally, then spend today and month to date with the top features. Short, no prose padding. Never use an em dash.`,
  },
  {
    kind: 'skill', slug: 'help', title: 'Help',
    oneLiner: 'Everything the bar can do and how to call it.',
    usage: '/help',
    examples: ['/help'],
    audience: ['admin', 'keyholder'], features: [], caps: { perRunUsd: 0 },
    leansOn: [],
    instructions: '', // answered from the registry without a model call
  },
];
