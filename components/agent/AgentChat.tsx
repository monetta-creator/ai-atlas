'use client';

import { useRef, useState } from 'react';
import { boldNodes } from '@/components/ask/answer';
import AskCost from '@/components/ask/AskCost';
import type { AskCostReport } from '@/lib/ask/history';
import type { AgentChatEvent, AgentChatMessage } from '@/lib/agent/types';
import { appendAgentMessage, clearAgentThread, useAgentThread } from '@/components/agent/store';

// The Chat tab: one standing conversation with the operator over
// POST /api/agent/chat (NDJSON), shared by the drawer and the console page.
// Cloned from AskWorkspace's deep-research reader loop and AskComposer's
// autosize/Enter-to-send textarea, trimmed to the agent's smaller event set
// (status/delta/cost/error/done, no citations or datasets).
export default function AgentChat() {
  const messages = useAgentThread();
  const [text, setText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [steps, setSteps] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  async function send() {
    const content = text.trim();
    if (!content || streaming) return;
    setText('');
    const wire: AgentChatMessage[] = [...messages.map((m) => ({ role: m.role, text: m.text })), { role: 'user', text: content }];
    appendAgentMessage({ role: 'user', text: content });

    const ac = new AbortController();
    abortRef.current = ac;
    setStreaming(true);
    setDraft('');
    setSteps([]);

    let acc = '';
    let stepLines: string[] = [];
    let cost: AskCostReport | undefined;
    let errText = '';

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let ev: AgentChatEvent;
      try {
        ev = JSON.parse(line) as AgentChatEvent;
      } catch {
        return; // a torn line; ignorable
      }
      if (ev.type === 'status') {
        stepLines = [...stepLines, ev.text];
        setSteps(stepLines);
      } else if (ev.type === 'delta') {
        acc += ev.text;
        setDraft(acc);
      } else if (ev.type === 'cost') {
        cost = {
          cost_usd: ev.cost_usd,
          input_tokens: ev.input_tokens,
          output_tokens: ev.output_tokens,
          cache_read_tokens: 0,
          searches: 0,
          rounds: ev.rounds,
          model: ev.model,
        };
      } else if (ev.type === 'error') {
        errText = ev.message;
      }
    };

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: wire }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        appendAgentMessage({ role: 'assistant', text: 'Something went wrong. Please try again.' });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          handleLine(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      }
      if (buf.trim()) handleLine(buf);
      if (acc) {
        appendAgentMessage({ role: 'assistant', text: acc, cost });
      } else {
        appendAgentMessage({ role: 'assistant', text: errText || 'The answer came back empty. Please try again.' });
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        if (acc) appendAgentMessage({ role: 'assistant', text: acc, cost });
      } else {
        appendAgentMessage({ role: 'assistant', text: 'Something went wrong. Please try again.' });
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setDraft('');
      setSteps([]);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div className="ag-chat">
      <div className="ag-chat-thread">
        {messages.length === 0 && !streaming && (
          <p className="ag-chat-empty">
            Ask what is failing today, what the last tick did, or tell it to run a proposed fix.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ag-chat-msg ag-chat-msg--${m.role}`}>
            {m.role === 'assistant' ? boldNodes(m.text, `m${i}`) : m.text}
            {m.role === 'assistant' && m.cost && <AskCost cost={m.cost} />}
          </div>
        ))}
        {streaming && (
          <div className="ag-chat-msg ag-chat-msg--assistant">
            {steps.map((s, i) => (
              <div key={i} className="ag-chat-step">{s}</div>
            ))}
            {boldNodes(draft, 'draft')}
          </div>
        )}
      </div>
      <div className="ag-composer">
        <div className="ask-composer-inner">
          <textarea
            className="input"
            rows={1}
            placeholder="Ask the agent"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(160, el.scrollHeight)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {streaming ? (
            <button type="button" className="btn btn--ghost" onClick={stop}>Stop</button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => void send()} disabled={!text.trim()}>
              Send
            </button>
          )}
        </div>
        {messages.length > 0 && (
          <button type="button" className="btn btn--quiet btn--sm" style={{ marginTop: 6 }} onClick={clearAgentThread}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
