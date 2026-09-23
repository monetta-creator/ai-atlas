'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { AgentAction, AgentBrief, AgentFinding, AgentPrefs, AgentPulse, Severity } from '@/lib/agent/types';
import { runBriefNowAction, runChecksNowAction, saveAgentPrefsAction } from '@/lib/actions';
import { SCAN_ENRICH_MODELS } from '@/lib/scan/models';
import FindingCard from '@/components/agent/FindingCard';
import AgentChat from '@/components/agent/AgentChat';

type Tab = 'today' | 'findings' | 'activity' | 'chat';

interface AgentStateResponse {
  findings: AgentFinding[];
  actions: AgentAction[];
  brief: AgentBrief | null;
  prefs: AgentPrefs;
  spend: { usd: number; calls: number };
  emailConfigured: boolean;
}

const CHAT_MODEL_OPTIONS = Array.from(
  new Set([...SCAN_ENRICH_MODELS.map((m) => m.id), 'claude-haiku-4-5', 'claude-sonnet-4-6'])
);

function fmtDay(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC';
}

// The Atlas Agent's tabbed content, shared by the right-side drawer and
// /agent (the console page renders it full-width). Owns its own data: one
// fetch to GET /api/agent/state, re-run on demand (`reload` counter, the
// AskPeek derived-state recipe so a stale response never clobbers a newer
// one). variant only changes outer chrome; the tabs and their behavior are
// identical.
export function AgentPanel({ variant }: { variant: 'drawer' | 'page' }) {
  const [tab, setTab] = useState<Tab>('today');
  const [reload, setReload] = useState(0);
  const [fetched, setFetched] = useState<{ key: number; data: AgentStateResponse } | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [busyChecks, setBusyChecks] = useState(false);
  const [busyBrief, setBusyBrief] = useState(false);

  useEffect(() => {
    let live = true;
    fetch('/api/agent/state', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: AgentStateResponse) => { if (live) setFetched({ key: reload, data }); })
      .catch(() => { /* keep the last known state; the next reload retries */ });
    return () => { live = false; };
  }, [reload]);

  const current = fetched && fetched.key === reload ? fetched.data : null;
  const doReload = () => setReload((r) => r + 1);

  async function runChecksNow() {
    if (busyChecks) return;
    setBusyChecks(true);
    try {
      await runChecksNowAction();
    } finally {
      setBusyChecks(false);
      doReload();
    }
  }

  async function runBriefNow() {
    if (busyBrief) return;
    setBusyBrief(true);
    try {
      await runBriefNowAction();
    } finally {
      setBusyBrief(false);
      doReload();
    }
  }

  const findingsByState = current?.findings.filter((f) => f.state !== 'snoozed') ?? [];
  const bySeverity = (sev: Severity) => findingsByState.filter((f) => f.severity === sev);

  return (
    <div className={variant === 'page' ? 'ag-page-panel' : undefined}>
      <div className="ag-tabs">
        {(['today', 'findings', 'activity', 'chat'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className="lenschip"
            data-on={tab === t ? '' : undefined}
            onClick={() => setTab(t)}
          >
            {t === 'today' ? 'Today' : t === 'findings' ? 'Findings' : t === 'activity' ? 'Activity' : 'Chat'}
          </button>
        ))}
        <button
          type="button"
          className="ag-gear"
          aria-label="Agent preferences"
          aria-pressed={prefsOpen}
          onClick={() => setPrefsOpen((o) => !o)}
        >
          ⚙
        </button>
      </div>

      <div className="ag-body" data-tab={tab}>
        {prefsOpen && current && (
          <PrefsPanel prefs={current.prefs} onSaved={doReload} />
        )}

        {!current && <p className="ag-loading">Loading…</p>}

        {current && tab === 'today' && (
          <TodayTab
            state={current}
            busyChecks={busyChecks}
            busyBrief={busyBrief}
            onRunChecks={runChecksNow}
            onRunBrief={runBriefNow}
            onReload={doReload}
          />
        )}

        {current && tab === 'findings' && (
          <FindingsTab high={bySeverity('high')} warn={bySeverity('warn')} info={bySeverity('info')} onReload={doReload} />
        )}

        {current && tab === 'activity' && <ActivityTab actions={current.actions} />}

        {tab === 'chat' && <AgentChat />}
      </div>
    </div>
  );
}

function TodayTab({
  state, busyChecks, busyBrief, onRunChecks, onRunBrief, onReload,
}: {
  state: AgentStateResponse;
  busyChecks: boolean;
  busyBrief: boolean;
  onRunChecks: () => void;
  onRunBrief: () => void;
  onReload: () => void;
}) {
  const memo = state.brief?.memo ?? null;
  return (
    <div className="ag-today">
      <div className="ag-actions">
        <button type="button" className="btn btn--quiet btn--sm" onClick={onRunChecks} disabled={busyChecks}>
          {busyChecks ? 'Running checks…' : 'Run checks now'}
        </button>
        <button type="button" className="btn btn--quiet btn--sm" onClick={onRunBrief} disabled={busyBrief}>
          {busyBrief ? 'Writing brief…' : 'Run brief now'}
        </button>
      </div>

      {!memo && <p className="ag-empty">No brief yet. Run checks, then run the brief.</p>}

      {memo && (
        <>
          <h2 className="ag-headline">{memo.headline}</h2>
          <p className="ag-brief-meta">
            {fmtDay(state.brief!.day)}
            {state.brief!.emailed_at ? ` · emailed ${fmtTime(state.brief!.emailed_at)}` : ' · not emailed'}
          </p>

          {memo.sections.map((s) => (
            <div key={s.title} className="ag-section">
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}

          {memo.proposals.length > 0 && (
            <div className="ag-section">
              <h3>Needs your tap</h3>
              <div className="ag-actions" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                {memo.proposals.map((p) => {
                  const finding = state.findings.find((f) => f.key === p.findingKey);
                  return (
                    <div key={p.findingKey} className="ag-proposal">
                      <span>{finding?.title ?? p.text}</span>
                      {finding && <FindingCard finding={finding} onReload={onReload} />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {memo.willDo.length > 0 && (
            <div className="ag-section">
              <h3>Will do on the next tick</h3>
              <ul>
                {memo.willDo.map((w) => <li key={w.findingKey}>{w.text}</li>)}
              </ul>
            </div>
          )}
        </>
      )}

      {!state.emailConfigured && (
        <p className="ag-quiet-note">Email brief off: set RESEND_API_KEY and AGENT_EMAIL_TO.</p>
      )}
    </div>
  );
}

function FindingsTab({
  high, warn, info, onReload,
}: { high: AgentFinding[]; warn: AgentFinding[]; info: AgentFinding[]; onReload: () => void }) {
  if (!high.length && !warn.length && !info.length) {
    return <p className="ag-empty">Nothing open. The next hourly tick will file anything new.</p>;
  }
  return (
    <div className="ag-findings">
      {high.length > 0 && (
        <div className="ag-group">
          <h3>High · {high.length}</h3>
          {high.map((f) => <FindingCard key={f.id} finding={f} onReload={onReload} />)}
        </div>
      )}
      {warn.length > 0 && (
        <div className="ag-group">
          <h3>Warn · {warn.length}</h3>
          {warn.map((f) => <FindingCard key={f.id} finding={f} onReload={onReload} />)}
        </div>
      )}
      {info.length > 0 && (
        <div className="ag-group">
          <h3>Info · {info.length}</h3>
          {info.map((f) => <FindingCard key={f.id} finding={f} onReload={onReload} />)}
        </div>
      )}
    </div>
  );
}

function ActivityTab({ actions }: { actions: AgentAction[] }) {
  if (!actions.length) return <p className="ag-empty">No actions logged yet.</p>;
  return (
    <div className="ag-activity">
      {actions.map((a) => (
        <div key={a.id} className="ag-activity-row" data-ok={a.ok ? '' : undefined}>
          <span className="ag-activity-time">{fmtTime(a.created_at)}</span>
          <span className="ag-activity-actor">{a.actor === 'agent' ? 'agent' : a.actor === 'kevin' ? 'you' : 'you, via chat'}</span>
          <span className="ag-activity-remedy">{a.remedy_key}</span>
          <span className="ag-activity-result">
            {a.ok ? (typeof a.result === 'object' && a.result && 'summary' in a.result ? String((a.result as { summary?: unknown }).summary ?? '') : 'ok') : (a.error ?? 'failed')}
          </span>
          {a.cost_usd > 0 && <span className="ag-activity-cost">${a.cost_usd.toFixed(4)}</span>}
        </div>
      ))}
    </div>
  );
}

// Chat model / brief model / steering / email / toggles. Local state
// initialized from the loaded prefs (the ToolingPrefsForm pattern): no sync
// effect, a dirty flag gates the Save button, and a save just calls the
// server action then asks the parent to reload.
function PrefsPanel({ prefs, onSaved }: { prefs: AgentPrefs; onSaved: () => void }) {
  const [chatModel, setChatModel] = useState(prefs.chat_model);
  const [briefModel, setBriefModel] = useState(prefs.brief_model);
  const [steering, setSteering] = useState(prefs.steering ?? '');
  const [emailTo, setEmailTo] = useState(prefs.email_to ?? '');
  const [enabled, setEnabled] = useState(prefs.enabled);
  const [autoEnabled, setAutoEnabled] = useState(prefs.auto_enabled);
  const [saving, setSaving] = useState(false);

  const dirty =
    chatModel !== prefs.chat_model ||
    briefModel !== prefs.brief_model ||
    steering !== (prefs.steering ?? '') ||
    emailTo !== (prefs.email_to ?? '') ||
    enabled !== prefs.enabled ||
    autoEnabled !== prefs.auto_enabled;

  async function save() {
    setSaving(true);
    try {
      await saveAgentPrefsAction({
        chat_model: chatModel,
        brief_model: briefModel,
        steering: steering.trim(),
        email_to: emailTo.trim() || null,
        enabled,
        auto_enabled: autoEnabled,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ag-prefs">
      <label className="ag-prefs-check">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Hourly checks and the daily brief run on cron
      </label>
      <label className="ag-prefs-check">
        <input type="checkbox" checked={autoEnabled} onChange={(e) => setAutoEnabled(e.target.checked)} />
        Auto remedies run on their own tier
      </label>
      <div className="field">
        <label htmlFor="ag-chat-model">Chat model</label>
        <select id="ag-chat-model" className="input" value={chatModel} onChange={(e) => setChatModel(e.target.value)}>
          {CHAT_MODEL_OPTIONS.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="ag-brief-model">Brief model</label>
        <select id="ag-brief-model" className="input" value={briefModel} onChange={(e) => setBriefModel(e.target.value)}>
          {CHAT_MODEL_OPTIONS.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="ag-email">Brief email</label>
        <input id="ag-email" className="input" type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="you@example.com" />
      </div>
      <div className="field">
        <label htmlFor="ag-steering">Steering note</label>
        <textarea
          id="ag-steering"
          className="input"
          rows={3}
          maxLength={2000}
          value={steering}
          onChange={(e) => setSteering(e.target.value)}
          placeholder="Anything standing you want the agent to weigh in on."
        />
      </div>
      {dirty && (
        <button type="button" className="btn btn--primary btn--sm" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
      )}
    </div>
  );
}

// The right-side drawer chrome: backdrop, Escape/backdrop close, and the
// panel above rendered inside. Cloned from PaperReader's .pv-* shell.
export default function AgentDrawer({
  open, onClose, pulse,
}: { open: boolean; onClose: () => void; pulse: AgentPulse | null }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="ag-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="ag-drawer" role="dialog" aria-modal="true" aria-label="Atlas Agent">
        <div className="ag-head">
          <div className="ag-head-title">
            <span className="ag-head-name">Atlas Agent</span>
            <span className="ag-head-status">
              {pulse?.briefHeadline ?? 'No brief yet'}
            </span>
          </div>
          <Link href="/agent" className="btn btn--quiet btn--sm" onClick={onClose}>
            Full page
          </Link>
          <button type="button" ref={closeRef} className="btn btn--quiet btn--sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <AgentPanel variant="drawer" />
      </div>
    </>
  );
}
