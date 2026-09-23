// Pure helpers for the agent chat's JSON step loop: transcript rendering and
// tolerant step parsing. No lib/db import anywhere in this file's dependency
// chain (prompt.ts is plain strings), so scripts/test-agent-brain.mjs can
// load it directly under plain-Node type stripping.

import { AGENT_PERSONA, STANDING_RULES, chatStepInstructions } from './prompt.ts';

export interface ToolMeta {
  name: string;
  description: string;
  args: string; // human-readable arg spec, e.g. "state?, severity?"
}

export function buildToolCatalog(tools: ToolMeta[]): string {
  return tools.map((t) => `- ${t.name}(${t.args}): ${t.description}`).join('\n');
}

export interface FindingDigestLine {
  key: string;
  severity: string;
  title: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface TranscriptInput {
  steering: string;
  findingsDigest: FindingDigestLine[];
  priorMessages: ChatMessage[];
  toolResultsByStep: { step: number; results: string[] }[];
  toolCatalog: string;
  stepsLeft: number;
  question: string;
}

// System = persona + standing rules + steering + a 12-line findings digest.
// User = "Kevin: ... / Agent: ..." turns, then "TOOL RESULTS (step n)" blocks,
// then the step instructions, then the live question.
export function renderTranscript(input: TranscriptInput): { system: string; user: string } {
  const digest = input.findingsDigest.slice(0, 12).map((f) => `${f.severity} ${f.key}: ${f.title}`);
  const system = [
    AGENT_PERSONA,
    STANDING_RULES,
    input.steering ? `Kevin's standing note:\n${input.steering}` : null,
    digest.length ? `Open findings right now (top ${digest.length}):\n${digest.join('\n')}` : 'No open findings right now.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const parts: string[] = [];
  for (const m of input.priorMessages) {
    parts.push(`${m.role === 'user' ? 'Kevin' : 'Agent'}: ${m.text}`);
  }
  for (const step of input.toolResultsByStep) {
    parts.push(`TOOL RESULTS (step ${step.step})`);
    parts.push(...step.results);
  }
  parts.push(chatStepInstructions(input.toolCatalog, input.stepsLeft));
  parts.push(`Kevin: ${input.question}`);
  return { system, user: parts.join('\n\n') };
}

export interface ParsedStep {
  thought: string;
  calls: { tool: string; args: Record<string, unknown> }[];
  answer: string | null;
}

// Tolerant parsing of the model's step JSON: calls defaults to [], answer is
// null when absent or blank, and at most 4 calls survive (the step loop's own
// per-step cap, enforced here too so a malformed step can't smuggle more).
export function parseStep(raw: unknown): ParsedStep {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const thought = typeof o.thought === 'string' ? o.thought.slice(0, 400) : '';
  const callsIn = Array.isArray(o.calls) ? o.calls : [];
  const calls: ParsedStep['calls'] = [];
  for (const c of callsIn) {
    if (calls.length >= 4) break;
    if (!c || typeof c !== 'object') continue;
    const cc = c as Record<string, unknown>;
    const tool = typeof cc.tool === 'string' ? cc.tool.trim() : '';
    if (!tool) continue;
    const args = cc.args && typeof cc.args === 'object' && !Array.isArray(cc.args) ? (cc.args as Record<string, unknown>) : {};
    calls.push({ tool, args });
  }
  const answer = typeof o.answer === 'string' && o.answer.trim() ? o.answer.trim() : null;
  return { thought, calls, answer };
}
