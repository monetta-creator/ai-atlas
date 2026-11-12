// Live smoke: the bounded loop with the real tool registry on one cheap model
// per provider. Prints answer head, rounds, tool calls, usage, cost, wall.
// Spends about a cent. Run: npx -y tsx scripts/smoke-ask-loop.mts [model ...]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });

const { runLoop, toApiUsage } = await import('../lib/ask/loop');
const { anthropicAdapter } = await import('../lib/llm/anthropic');
const { openrouterAdapter } = await import('../lib/llm/openrouter-adapter');
const { getModel } = await import('../lib/llm/models');
const { anthropicTools, runTool } = await import('../lib/tools/registry');
const { webSearchTool } = await import('../lib/tools/web');
const { createTagger } = await import('../lib/ask/deep');
const { priceUsage, recordApiCall } = await import('../lib/cost');

const models = process.argv.slice(2).length ? process.argv.slice(2) : ['claude-haiku-5-5', 'deepseek/deepseek-v4.1-flash'];
const question = 'Which big US banks said they are seeing unauthorized AI agents in customer accounts? Cite the records.';
const identity = { kind: 'admin' as const };

for (const id of models) {
  const m = getModel(id)!;
  const adapter = m.provider === 'anthropic' ? anthropicAdapter() : openrouterAdapter();
  const tagger = createTagger({}, 0);
  const tools = anthropicTools(identity).map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema }));
  if (m.provider === 'openrouter') tools.push({ name: webSearchTool.name, description: webSearchTool.description, inputSchema: webSearchTool.inputSchema });
  const statuses: string[] = [];
  const t0 = Date.now();
  let retracts = 0;
  const r = await runLoop({
    adapter, model: id,
    system: 'You answer questions about AI developments for a practitioner at a regulated financial institution. Research with the Atlas tools first, then answer briefly, citing records with their bracketed IDs exactly as labeled. Never use an em dash.',
    messages: [{ role: 'user', content: question }],
    tools, serverWebSearch: false,
    exec: async (c) => (c.name === 'web_search' ? webSearchTool.run(webSearchTool.parse(c.input) as { query: string }, { identity, tagger }) : runTool(c.name, c.input, { identity, tagger, status: (s) => statuses.push(s) })),
    emit: (e) => { if (e.type === 'retract') retracts++; },
    finalInstruction: 'Research is over. Write the final answer now from what you gathered.',
    deadlineAt: Date.now() + 120_000,
    caps: { maxRounds: 4 },
    maxTokens: 3000,
    onCall: async (u, wallMs) => { await recordApiCall({ feature: 'ask_answer', model: id, usage: toApiUsage(u, m.provider), wallMs, metadata: { smoke: true } }); },
  });
  const cost = await priceUsage(id, toApiUsage(r.usage, m.provider));
  console.log(`\n== ${id}: ${((Date.now() - t0) / 1000).toFixed(1)}s, rounds ${r.rounds}, model calls ${r.modelCalls}, tool calls ${r.toolCalls}, retracts ${retracts}, forced ${r.forced}, stop ${r.stop}`);
  console.log(`   usage ${JSON.stringify(r.usage)} cost ${JSON.stringify(cost)}`);
  console.log(`   statuses: ${statuses.slice(0, 4).join(' | ')}`);
  console.log(`   answer: ${r.answer.slice(0, 500).replace(/\n/g, ' ')}`);
}
process.exit(0);
