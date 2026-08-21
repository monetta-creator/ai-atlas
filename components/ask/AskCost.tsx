'use client';

import type { AskCostReport } from '@/lib/ask/history';

// The per-turn cost line under an answer: what this turn cost in dollars and
// tokens, with a one-paragraph expandable explainer (the educational half).
// Numbers come from the server's frozen-rate pricing (lib/cost.ts), shipped on
// the stream as a sentinel line (quick routes) or an NDJSON cost event (the
// research chat). Never an em dash in any of this copy.

function fmtTokens(n: number): string {
  if (n >= 100_000) return `${Math.round(n / 1000)}k`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtUsd(v: number): string {
  if (v <= 0) return '$0.00';
  if (v < 0.0001) return '<$0.0001';
  return `$${v.toFixed(v < 0.1 ? 4 : 2)}`;
}

export default function AskCost({ cost }: { cost: AskCostReport }) {
  const bits: string[] = [
    fmtUsd(cost.cost_usd),
    `${fmtTokens(cost.input_tokens)} in / ${fmtTokens(cost.output_tokens)} out`,
  ];
  if (cost.searches > 0) bits.push(`${cost.searches} web search${cost.searches === 1 ? '' : 'es'}`);
  if (cost.rounds > 1) bits.push(`${cost.rounds} model calls`);

  const cachedShare =
    cost.input_tokens > 0 ? Math.round((cost.cache_read_tokens / cost.input_tokens) * 100) : 0;

  return (
    <details className="ask-cost">
      <summary>
        <span className="ask-cost-line">this answer: {bits.join(' · ')}</span>
      </summary>
      <p className="ask-cost-note">
        A token is roughly three quarters of a word. This turn sent{' '}
        {fmtTokens(cost.input_tokens)} input tokens to {cost.model || 'the model'} (the question,
        the conversation, and the retrieved records{cost.rounds > 1 ? ', across each research call' : ''})
        and generated {fmtTokens(cost.output_tokens)} output tokens.
        {cachedShare > 0 && ` About ${cachedShare}% of the input was re-read from cache at a reduced rate.`}
        {cost.searches > 0 && ` Each web search adds a flat charge on top of the tokens.`}{' '}
        The dollar figure uses the per-million-token rates frozen at call time on the Atlas rate card.
      </p>
    </details>
  );
}
