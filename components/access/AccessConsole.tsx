'use client';

import { useState, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  approveAccessRequestAction, declineAccessRequestAction, issuePortalKeyAction,
  renewPortalKeyAction, revokePortalKeyAction, setPortalKeyBudgetAction,
  type KeyIssuedResult,
} from '@/lib/actions/portal';
import type { AccessRequestRow, PortalKeyRow } from '@/lib/data/portal';
import { timeAgo } from '@/lib/format';
import KeyIssuedPanel from './KeyIssuedPanel';

// The access desk's interactive half: pending requests, the issue form and
// the keys table. One piece of state matters, the key just issued, which is
// shown once in KeyIssuedPanel and then dropped. Every write is a server
// action that re-checks the admin session; router.refresh() re-reads the
// server-rendered rows afterwards.

const STATE_COLOR: Record<PortalKeyRow['state'], string> = {
  active: 'var(--supports)', expired: 'var(--heat-2)', revoked: 'var(--faint-ink)',
};

const mono: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11.5 };
const faint: CSSProperties = { color: 'var(--faint-ink)' };

// lib/portal/keys.ts exports the same helper, but it imports node:crypto and
// this is a client component, so the one-liner lives here too.
function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export default function AccessConsole({ requests, keys, defaultDays }: {
  requests: AccessRequestRow[];
  keys: PortalKeyRow[];
  defaultDays: number;
}) {
  const router = useRouter();
  const [issued, setIssued] = useState<KeyIssuedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  function takeOutcome(out: KeyIssuedResult | { error: string }) {
    if ('error' in out) setError(out.error);
    else { setIssued(out); setError(null); }
  }

  const pending = requests.filter((r) => r.status === 'pending');

  return (
    <div className="flex flex-col" style={{ gap: 34 }}>
      {issued && <KeyIssuedPanel issued={issued} onClose={() => setIssued(null)} />}
      {error && <p className="text-sm" style={{ color: 'var(--heat-4)', margin: 0 }}>{error}</p>}

      <section>
        <div className="section-label">Pending requests · {pending.length}</div>
        {pending.length === 0 ? (
          <p className="text-sm" style={{ ...faint, marginTop: 10 }}>No one is waiting.</p>
        ) : (
          <div className="flex flex-col gap-[10px]" style={{ marginTop: 12 }}>
            {pending.map((r) => (
              <div key={r.id} className="plate flex flex-col gap-2" style={{ opacity: busy === r.id ? 0.6 : 1 }}>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{r.name}</span>
                  <a href={`mailto:${r.email}`} className="text-xs hover:underline" style={{ color: 'var(--accent)' }}>{r.email}</a>
                  <span className="text-xs" style={{ ...faint, ...mono, marginLeft: 'auto' }} title={r.created_at}>{timeAgo(r.created_at)}</span>
                </div>
                {r.reason && <p className="text-sm" style={{ color: 'var(--dim)', margin: 0, whiteSpace: 'pre-wrap' }}>{r.reason}</p>}
                {r.user_agent && <span className="text-xs" style={faint} title={r.user_agent}>{r.user_agent.includes('Mobile') ? 'mobile' : 'desktop'}</span>}
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" className="btn btn--primary btn--sm" disabled={busy !== null}
                    onClick={() => void run(r.id, async () => takeOutcome(await approveAccessRequestAction(r.id)))}>
                    Approve, issue a key
                  </button>
                  <button type="button" className="btn btn--quiet btn--sm" disabled={busy !== null}
                    onClick={() => void run(r.id, () => declineAccessRequestAction(r.id))}>
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="section-label">Issue a key</div>
        <IssueKeyForm defaultDays={defaultDays} busy={busy === 'issue'}
          onSubmit={(fd) => void run('issue', async () => takeOutcome(await issuePortalKeyAction(fd)))} />
      </section>

      <section>
        <div className="section-label">Keys · {keys.length}</div>
        {keys.length === 0 ? (
          <p className="text-sm" style={{ ...faint, marginTop: 10 }}>No keys issued yet. The shared team key, if set, still works as the legacy tier.</p>
        ) : (
          <div className="flex flex-col gap-[10px]" style={{ marginTop: 12 }}>
            {keys.map((k) => (
              <KeyRow key={k.id} row={k} busy={busy === k.id} anyBusy={busy !== null} defaultDays={defaultDays} run={run} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function IssueKeyForm({ defaultDays, busy, onSubmit }: { defaultDays: number; busy: boolean; onSubmit: (fd: FormData) => void }) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    onSubmit(new FormData(form));
    form.reset();
  }
  return (
    <form onSubmit={submit} className="plate" style={{ marginTop: 12, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', opacity: busy ? 0.6 : 1 }}>
      <div className="field"><label htmlFor="ik-name">Name</label><input id="ik-name" className="input" name="name" required maxLength={120} placeholder="Who this key is for" /></div>
      <div className="field"><label htmlFor="ik-email">Email (optional)</label><input id="ik-email" className="input" name="email" type="email" maxLength={200} placeholder="Gets the link when email is set up" /></div>
      <div className="field"><label htmlFor="ik-days">Valid for (days)</label><input id="ik-days" className="input" name="days" type="number" min={1} max={3650} defaultValue={defaultDays} /></div>
      <div className="field"><label htmlFor="ik-budget">Daily Ask budget (USD)</label><input id="ik-budget" className="input" name="budget" type="number" step="0.01" min={0} max={100} defaultValue="0.25" /></div>
      <div className="field"><label htmlFor="ik-calls">Daily Ask calls</label><input id="ik-calls" className="input" name="calls" type="number" min={0} max={10000} defaultValue={60} /></div>
      <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="ik-notes">Notes (admin only)</label><input id="ik-notes" className="input" name="notes" maxLength={2000} placeholder="Team, purpose, anything you want to remember" /></div>
      <div style={{ gridColumn: '1 / -1' }}>
        <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Issuing…' : 'Issue key'}</button>
      </div>
    </form>
  );
}

function KeyRow({ row, busy, anyBusy, defaultDays, run }: {
  row: PortalKeyRow; busy: boolean; anyBusy: boolean; defaultDays: number;
  run: (id: string, fn: () => Promise<void>) => Promise<void>;
}) {
  const [budgetOpen, setBudgetOpen] = useState(false);
  const daysLeft = daysUntil(row.expires_at);
  const expiresLabel = row.state === 'active'
    ? `${row.expires_at.slice(0, 10)} · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
    : row.expires_at.slice(0, 10);

  function saveBudget(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void run(row.id, async () => { await setPortalKeyBudgetAction(row.id, fd); setBudgetOpen(false); });
  }

  return (
    <div className="plate flex flex-col gap-2" style={{ opacity: busy ? 0.6 : 1 }}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span style={{ fontWeight: 600, fontSize: 15 }}>{row.name}</span>
        {row.email && <a href={`mailto:${row.email}`} className="text-xs hover:underline" style={{ color: 'var(--accent)' }}>{row.email}</a>}
        <span className="text-xs" style={{ ...mono, color: STATE_COLOR[row.state] }}>{row.state}</span>
        <span className="text-xs" style={{ ...mono, ...faint, marginLeft: 'auto' }}>atlas_{row.key_prefix}_…</span>
      </div>
      <div className="text-xs flex items-center gap-x-4 gap-y-1 flex-wrap" style={{ ...faint, ...mono }}>
        <span>created {row.created_at.slice(0, 10)}</span>
        <span>expires {expiresLabel}</span>
        <span>last used {row.last_used_at ? timeAgo(row.last_used_at) : 'never'}</span>
        <span>today ${row.spend_today_usd.toFixed(3)} of ${row.daily_ask_budget_usd.toFixed(2)} · {row.daily_ask_max_calls} calls</span>
        <span>{row.usage_count} use{row.usage_count === 1 ? '' : 's'}</span>
      </div>
      {row.notes && <p className="text-xs" style={{ color: 'var(--dim)', margin: 0, fontStyle: 'italic' }}>{row.notes}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        {row.state !== 'revoked' && (
          <button type="button" className="btn btn--ghost btn--sm" disabled={anyBusy}
            onClick={() => void run(row.id, async () => { await renewPortalKeyAction(row.id, defaultDays); })}>
            Renew {defaultDays}d
          </button>
        )}
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => setBudgetOpen((o) => !o)}>Budget</button>
        {row.state !== 'revoked' && (
          <button type="button" className="btn btn--quiet btn--sm" style={{ color: 'var(--heat-4)', marginLeft: 'auto' }} disabled={anyBusy}
            onClick={() => { if (window.confirm(`Revoke ${row.name}'s key? Their browser and scripts stop working at once.`)) void run(row.id, () => revokePortalKeyAction(row.id)); }}>
            Revoke
          </button>
        )}
      </div>
      {budgetOpen && (
        <form onSubmit={saveBudget} className="flex items-end gap-2 flex-wrap">
          <div className="field"><label htmlFor={`b-${row.id}`}>Daily budget (USD)</label>
            <input id={`b-${row.id}`} className="input" name="budget" type="number" step="0.01" min={0} max={100} defaultValue={row.daily_ask_budget_usd} style={{ width: 140 }} /></div>
          <div className="field"><label htmlFor={`c-${row.id}`}>Daily calls</label>
            <input id={`c-${row.id}`} className="input" name="calls" type="number" min={0} max={10000} defaultValue={row.daily_ask_max_calls} style={{ width: 120 }} /></div>
          <button type="submit" className="btn btn--ghost btn--sm" disabled={anyBusy}>Save</button>
        </form>
      )}
    </div>
  );
}
