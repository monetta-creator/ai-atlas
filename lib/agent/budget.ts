import { getAgentSpendToday } from '../data/agent';

// The agent's daily model-spend ceiling (the pipeline/scan/intel/research
// budget pattern): AGENT_DAILY_BUDGET_USD (default 0.25, floor 0.05), checked
// before every model-costing remedy and before the brief/chat legs. Past the
// cap the agent reads and writes but stops calling models until the next UTC
// day. What counts as agent spend is defined once, in getAgentSpendToday.
export function agentCapUsd(): number {
  return Math.max(0.05, Number(process.env.AGENT_DAILY_BUDGET_USD || 0.25));
}

export async function checkAgentBudget(): Promise<{ ok: boolean; spentUsd: number; capUsd: number }> {
  const capUsd = agentCapUsd();
  const { usd } = await getAgentSpendToday();
  return { ok: usd < capUsd, spentUsd: usd, capUsd };
}
