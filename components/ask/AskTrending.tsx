'use client';

import { useState } from 'react';
import type { PeekKind } from '@/lib/ask/search';
import type { TrendingTab } from '@/lib/ask/trending';

// The Ask empty state's "what is moving" tabs (2026-11-12). Data comes from
// lib/ask/trending.ts (records only, no model call). A card opens its record
// in the peek; "Ask" seeds a question about it as the first turn.
export default function AskTrending({
  tabs, onOpen, onAsk, footer,
}: {
  tabs: TrendingTab[];
  onOpen: (kind: PeekKind, id: string) => void;
  onAsk: (question: string) => void;
  footer?: React.ReactNode;
}) {
  const [key, setKey] = useState(tabs[0]?.key);
  if (tabs.length === 0) return footer ? <div className="ask-trend">{footer}</div> : null;
  const tab = tabs.find((t) => t.key === key) ?? tabs[0];

  return (
    <section className="ask-trend" aria-label="Moving in the Atlas">
      <div className="ask-trend-head">
        <div className="ask-trend-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={t.key === tab.key}
              className="ask-trend-tab"
              onClick={() => setKey(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {footer}
      </div>
      <p className="ask-trend-blurb">{tab.blurb}</p>
      <ul className="ask-trend-grid" role="tabpanel">
        {tab.cards.map((c) => {
          const total = c.split ? c.split.sup + c.split.con + c.split.other : 0;
          return (
            <li key={`${c.kind}:${c.id}`} className="ask-trend-card">
              <button type="button" className="ask-trend-open" onClick={() => onOpen(c.kind, c.id)}>
                {c.badge && <span className="ask-trend-badge">{c.badge}</span>}
                <span className="ask-trend-title">{c.title}</span>
                {c.split && total > 0 && (
                  <span className="ask-trend-split" aria-label={`${c.split.sup} supporting, ${c.split.con} contradicting, ${c.split.other} neutral`}>
                    <span data-dir="sup" style={{ flexGrow: c.split.sup }} />
                    <span data-dir="other" style={{ flexGrow: c.split.other }} />
                    <span data-dir="con" style={{ flexGrow: c.split.con }} />
                  </span>
                )}
                <span className="ask-trend-meta">
                  {c.meta}
                  {c.split && total > 0 ? ` · ${c.split.sup} for, ${c.split.con} against` : ''}
                </span>
              </button>
              <button type="button" className="ask-trend-ask" onClick={() => onAsk(c.ask)} title={c.ask}>
                Ask
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
