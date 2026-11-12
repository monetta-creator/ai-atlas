'use client';

import { formatTurnCost } from '@/lib/llm/models';
import type { EnhanceCardData } from '@/components/ask/store';

// The Enhance card: one collapsed line (model, web, records, cost), expandable
// to the cleaned question, the reason, the plan, clarifying questions, records
// and any budget note. "Edit and rerun" loads the cleaned question back into
// the composer.
export default function EnhanceCard({ card, onEdit }: { card: EnhanceCardData; onEdit?: (question: string) => void }) {
  const d = card.decision;
  const line = ['Enhanced', d.label, `web ${d.web ? 'on' : 'off'}`, `${card.records.length} record${card.records.length === 1 ? '' : 's'}`, formatTurnCost(d.estUsd)].join(' · ');
  return (
    <details className="ask-enh">
      <summary>{line}</summary>
      <div className="ask-enh-body">
        <p className="ask-enh-q">{card.question}</p>
        <p className="ask-enh-meta">{d.reason}</p>
        {card.plan.length > 0 && (
          <>
            <p className="ask-enh-h">Plan</p>
            <ol>{card.plan.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </>
        )}
        {card.clarify.length > 0 && (
          <>
            <p className="ask-enh-h">Worth clarifying</p>
            <ul>{card.clarify.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </>
        )}
        {card.records.length > 0 && (
          <>
            <p className="ask-enh-h">Records it found</p>
            <ul>{card.records.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </>
        )}
        {d.budgetMessage && <p className="ask-enh-meta">{d.budgetMessage}</p>}
        {onEdit && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => onEdit(card.question)}>
            Edit and rerun
          </button>
        )}
      </div>
    </details>
  );
}
