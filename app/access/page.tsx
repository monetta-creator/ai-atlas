import { adminGate } from '@/lib/admin-gate';
import { getNavCounts } from '@/lib/data';
import {
  listAccessRequests, listPortalKeys, listPortalUsage, getKeyUsageSummary, getPortalUsageByDay,
} from '@/lib/data/portal';
import { parseDomainList } from '@/lib/portal/keys';
import { emailConfigured } from '@/lib/email/resend';
import { timeAgo } from '@/lib/format';
import PageTop from '@/components/PageTop';
import AccessConsole from '@/components/access/AccessConsole';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Access · The AI Atlas' };

// The access desk (admin): pending requests from the public form, the issue
// form, every key with its state and today's spend, and the usage log. The
// full key is shown once, in the console, right after issuance; the rows
// below carry only the prefix.
export default async function AccessPage() {
  const gate = await adminGate('/access', 'Access');
  if (gate) return gate;
  const countsP = getNavCounts().catch(() => null);
  const admin = true as const;

  const [requests, keys, usage, usageSummary, usageByDay, counts] = await Promise.all([
    listAccessRequests(),
    listPortalKeys(),
    listPortalUsage({ limit: 50 }),
    getKeyUsageSummary(30),
    getPortalUsageByDay(30),
    countsP,
  ]);

  const defaultDaysRaw = Number(process.env.PORTAL_KEY_DEFAULT_DAYS);
  const defaultDays = Number.isFinite(defaultDaysRaw) && defaultDaysRaw > 0 ? Math.floor(defaultDaysRaw) : 90;
  const notifyTo = process.env.PORTAL_NOTIFY_TO || process.env.AGENT_EMAIL_TO || '';
  const domains = parseDomainList(process.env.PORTAL_REQUEST_EMAIL_DOMAINS);
  const decided = requests.filter((r) => r.status !== 'pending').slice(0, 20);

  const mono = { fontFamily: 'var(--font-mono)', fontSize: 11.5 } as const;

  return (
    <>
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <PageTop pathname="/access" label="Access" viewer={{ admin, portal: admin }} counts={counts}>
          email {emailConfigured() ? 'configured' : 'not configured'}
          {' · '}notify address {notifyTo ? 'set' : 'unset'}
          {' · '}request domains {domains.length ? domains.join(', ') : 'any well-formed address'}
          {' · '}default validity {defaultDays} days
        </PageTop>

        <AccessConsole requests={requests} keys={keys} defaultDays={defaultDays} />

        <div style={{ marginTop: 34 }}>
          <div className="section-label">Usage, last 30 days</div>
          {usageSummary.keys.every((k) => k.pulls + k.schemaReads + k.askTurns + k.nlQueries + k.viewsSaved + k.deckViews === 0) ? (
            <p className="text-sm" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>No key activity in the last 30 days.</p>
          ) : (
            <>
              <div style={{ marginTop: 12, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ ...mono, color: 'var(--faint-ink)', textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px' }}>key</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>pulls</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>schema</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>ask</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>nl</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>views</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>deck</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>spend</th>
                      <th style={{ padding: '6px 8px' }}>last used</th>
                      <th style={{ padding: '6px 8px' }}>top datasets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageSummary.keys.map((k) => (
                      <tr key={k.keyId} style={{ borderTop: '1px solid var(--line)' }}>
                        <td style={{ padding: '6px 8px' }}>{k.name}</td>
                        <td style={{ padding: '6px 8px', ...mono, textAlign: 'right' }}>{k.pulls}</td>
                        <td style={{ padding: '6px 8px', ...mono, textAlign: 'right' }}>{k.schemaReads}</td>
                        <td style={{ padding: '6px 8px', ...mono, textAlign: 'right' }}>{k.askTurns}</td>
                        <td style={{ padding: '6px 8px', ...mono, textAlign: 'right' }}>{k.nlQueries}</td>
                        <td style={{ padding: '6px 8px', ...mono, textAlign: 'right' }}>{k.viewsSaved}</td>
                        <td style={{ padding: '6px 8px', ...mono, textAlign: 'right' }}>{k.deckViews}</td>
                        <td style={{ padding: '6px 8px', ...mono, textAlign: 'right' }}>${k.spendUsd.toFixed(3)}</td>
                        <td style={{ padding: '6px 8px', ...mono, color: 'var(--faint-ink)', whiteSpace: 'nowrap' }}>{k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'never'}</td>
                        <td style={{ padding: '6px 8px', ...mono, color: 'var(--faint-ink)' }}>
                          {k.topDatasets.length ? k.topDatasets.map((d) => `${d.slug} (${d.n})`).join(', ') : '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 18, maxHeight: 260, overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', ...mono }}>
                  <thead>
                    <tr style={{ color: 'var(--faint-ink)', textAlign: 'left' }}>
                      <th style={{ padding: '4px 8px' }}>day</th>
                      <th style={{ padding: '4px 8px', textAlign: 'right' }}>pulls</th>
                      <th style={{ padding: '4px 8px', textAlign: 'right' }}>ask turns</th>
                      <th style={{ padding: '4px 8px', textAlign: 'right' }}>spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageByDay.map((d) => (
                      <tr key={d.day} style={{ borderTop: '1px solid var(--line)', color: 'var(--dim)' }}>
                        <td style={{ padding: '3px 8px' }}>{d.day}</td>
                        <td style={{ padding: '3px 8px', textAlign: 'right' }}>{d.pulls}</td>
                        <td style={{ padding: '3px 8px', textAlign: 'right' }}>{d.askTurns}</td>
                        <td style={{ padding: '3px 8px', textAlign: 'right' }}>${d.spendUsd.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div style={{ marginTop: 34 }}>
          <div className="section-label">Recent usage · last {usage.length}</div>
          {usage.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>Nothing logged yet.</p>
          ) : (
            <div style={{ marginTop: 12, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ ...mono, color: 'var(--faint-ink)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px' }}>when</th>
                    <th style={{ padding: '6px 8px' }}>who</th>
                    <th style={{ padding: '6px 8px' }}>kind</th>
                    <th style={{ padding: '6px 8px' }}>dataset</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>rows</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>bytes</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>status</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((u) => (
                    <tr key={u.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <td style={{ padding: '6px 8px', ...mono, color: 'var(--faint-ink)', whiteSpace: 'nowrap' }} title={u.created_at}>{u.created_at.slice(0, 16).replace('T', ' ')}</td>
                      <td style={{ padding: '6px 8px' }}>{u.key_name ?? (u.identity === 'legacy' ? 'shared team key' : u.identity)}</td>
                      <td style={{ padding: '6px 8px', ...mono }}>{u.kind}</td>
                      <td style={{ padding: '6px 8px', ...mono }}>{u.dataset_slug ?? '–'}</td>
                      <td style={{ padding: '6px 8px', ...mono, textAlign: 'right' }}>{u.rows ?? '–'}</td>
                      <td style={{ padding: '6px 8px', ...mono, textAlign: 'right' }}>{u.bytes ?? '–'}</td>
                      <td style={{ padding: '6px 8px', ...mono, textAlign: 'right' }}>{u.status ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {decided.length > 0 && (
          <div style={{ marginTop: 34 }}>
            <div className="section-label">Decided requests · last {decided.length}</div>
            <div className="flex flex-col gap-1" style={{ marginTop: 10 }}>
              {decided.map((r) => (
                <div key={r.id} className="text-xs flex items-baseline gap-2 flex-wrap" style={{ color: 'var(--faint-ink)' }}>
                  <span style={{ color: 'var(--dim)' }}>{r.name}</span>
                  <span>{r.email}</span>
                  <span style={{ ...mono, color: r.status === 'approved' ? 'var(--supports)' : 'var(--faint-ink)' }}>{r.status}</span>
                  <span style={mono}>{r.decided_at ? timeAgo(r.decided_at) : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
