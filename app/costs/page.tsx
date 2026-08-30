import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import { getCostDashboard, getMonthlyBill, FIXED_MONTHLY } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import { cronLabel } from '@/lib/scan/handoff';
import vercelConfig from '@/vercel.json';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import CostsDashboard from '@/components/CostsDashboard';
import SpendForecast from '@/components/SpendForecast';
import WorkspaceTabs, { ANALYTICS_TABS } from '@/components/WorkspaceTabs';

// Admin-only AI cost console. force-dynamic (reads cookies + DB); no maxDuration needed —
// the only server action it hosts (addRateCardAction) is a quick DB insert, not an AI call.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI costs · The AI Atlas' };

// Fixed platform subscriptions, NOT read off any bill: this is the config, edit it here
// when a subscription changes. Paired at render time with the metered spend rolled up by
// getMonthlyBill (lib/data/costs.ts) into one "running cost of the whole system" headline.
const panel = { background: 'var(--surface)', borderColor: 'var(--line)' } as const;
const usd2 = (n: number): string => `$${n.toFixed(2)}`;

// Maps a cron path prefix to the subsystem it drives, mirroring the /api/cron/* trio wired
// in vercel.json. null for any cron this page doesn't (yet) attribute spend to.
function cronSubsystemName(path: string): string | null {
  if (path.startsWith('/api/cron/scan')) return 'External Scan';
  if (path.startsWith('/api/cron/pipeline')) return 'Discovery Pipeline';
  if (path.startsWith('/api/cron/intel')) return 'Intel Desk';
  return null;
}

export default async function CostsPage() {
  const admin = await requireAdminPage();
  const { editing, txt } = await getEditContext();

  const [data, bill] = await Promise.all([getCostDashboard(), getMonthlyBill()]);

  const fixedTotal = FIXED_MONTHLY.reduce((s, f) => s + f.usd, 0);
  const runningCost = Math.round(fixedTotal + bill.projectedUsd);
  const totalMtd = bill.mtdUsd || 1; // guard div-by-zero for the share bars
  const subsystemByName = new Map(bill.subsystems.map((s) => [s.name, s]));
  const crons = (vercelConfig as { crons: { path: string; schedule: string }[] }).crons;

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 1080, paddingBottom: 100 }}>
        <header className="pagehead">
          <Editable
            as="h1"
            k="costs.title"
            value={txt('costs.title', 'AI costs')}
            editing={editing}
          />
          <Editable
            as="p"
            className="lede"
            multiline
            k="costs.lede"
            value={txt(
              'costs.lede',
              'The whole running cost of the system: fixed platform subscriptions plus every metered model call the app makes (Anthropic and OpenRouter alike, spend, tokens, latency, and context-window use), priced from the active rate card and frozen at call time.'
            )}
            editing={editing}
          />
          <Link href="/costs/deck" className="btn btn--primary" style={{ marginTop: 16 }}>
            Produce cost report
          </Link>
        </header>
        <WorkspaceTabs tabs={ANALYTICS_TABS} active="/costs" />

        <section id="monthly-bill" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">Monthly bill</div>

          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
            <div style={{ fontSize: 30, fontWeight: 600, color: 'var(--ink)' }}>
              Running cost: ~${runningCost} / month
            </div>
            <div className="text-xs" style={{ color: 'var(--dim)', marginTop: 6 }}>
              {usd2(fixedTotal)} fixed + {usd2(bill.mtdUsd)} metered so far this month
              (projected {usd2(bill.projectedUsd)} by month end) · {usd2(bill.todayUsd)} today ·
              {' '}{usd2(bill.allTimeUsd)} metered all-time
            </div>
          </div>

          <div className="flex flex-wrap gap-3" style={{ marginTop: 14 }}>
            {/* (a) Fixed stack */}
            <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, flex: '1 1 240px', minWidth: 240 }}>
              <div className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 8 }}>Fixed</div>
              <table className="text-xs" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {FIXED_MONTHLY.map((f) => (
                    <tr key={f.name} style={{ color: 'var(--dim)' }}>
                      <td style={{ padding: '5px 8px 5px 0', borderTop: '1px solid var(--line)', verticalAlign: 'top' }}>
                        <div style={{ color: 'var(--ink)' }}>{f.name}</div>
                        <div style={{ color: 'var(--faint-ink)', marginTop: 2 }}>{f.note}</div>
                      </td>
                      <td style={{ padding: '5px 0', textAlign: 'right', borderTop: '1px solid var(--line)', verticalAlign: 'top', color: 'var(--ink)' }}>
                        {usd2(f.usd)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ padding: '6px 8px 0 0', color: 'var(--faint-ink)' }}>Total</td>
                    <td style={{ padding: '6px 0 0', textAlign: 'right', color: 'var(--ink)', fontWeight: 600 }}>
                      {usd2(fixedTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* (b) Metered by subsystem */}
            <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, flex: '2 1 380px', minWidth: 340 }}>
              <div className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 8 }}>Metered by subsystem</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="text-xs" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--faint-ink)' }}>
                      <th style={{ padding: '4px 8px 4px 0' }}>subsystem</th>
                      <th style={{ padding: '4px 8px', textAlign: 'right' }}>this month</th>
                      <th style={{ padding: '4px 8px', textAlign: 'right' }}>today</th>
                      <th style={{ padding: '4px 8px', textAlign: 'right' }}>calls</th>
                      <th style={{ padding: '4px 0', textAlign: 'right' }}>all-time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bill.subsystems.map((s) => (
                      <tr key={s.name} style={{ color: 'var(--dim)' }}>
                        <td style={{ padding: '5px 8px 5px 0', borderTop: '1px solid var(--line)' }}>
                          <div style={{ color: 'var(--ink)' }}>
                            {s.name}
                            {s.cron && <span style={{ color: 'var(--faint-ink)' }}> · cron</span>}
                          </div>
                          <div style={{ marginTop: 4, height: 4, borderRadius: 2, background: 'var(--bg)', overflow: 'hidden', maxWidth: 140 }}>
                            <div
                              style={{
                                height: '100%',
                                width: `${Math.max(0, Math.min(100, (s.mtdUsd / totalMtd) * 100))}%`,
                                background: 'var(--accent)', opacity: 0.55,
                              }}
                            />
                          </div>
                        </td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', borderTop: '1px solid var(--line)' }}>{usd2(s.mtdUsd)}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', borderTop: '1px solid var(--line)' }}>{usd2(s.todayUsd)}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', borderTop: '1px solid var(--line)' }}>{s.calls.toLocaleString()}</td>
                        <td style={{ padding: '5px 0', textAlign: 'right', borderTop: '1px solid var(--line)' }}>{usd2(s.allTimeUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* (c) Cron jobs */}
            <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, flex: '2 1 380px', minWidth: 340 }}>
              <div className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 8 }}>Cron jobs</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="text-xs" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--faint-ink)' }}>
                      <th style={{ padding: '4px 8px 4px 0' }}>path</th>
                      <th style={{ padding: '4px 8px' }}>schedule</th>
                      <th style={{ padding: '4px 8px', textAlign: 'right' }}>this month</th>
                      <th style={{ padding: '4px 0', textAlign: 'right' }}>today</th>
                    </tr>
                  </thead>
                  <tbody>
                    {crons.map((c) => {
                      const isSweep = c.path.endsWith('/sweep');
                      const subName = cronSubsystemName(c.path);
                      const sub = subName ? subsystemByName.get(subName) : undefined;
                      return (
                        <tr key={c.path} style={{ color: 'var(--dim)' }}>
                          <td style={{ padding: '5px 8px 5px 0', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', borderTop: '1px solid var(--line)' }}>
                            {c.path}
                          </td>
                          <td style={{ padding: '5px 8px', whiteSpace: 'nowrap', borderTop: '1px solid var(--line)' }}>{cronLabel(c.schedule)}</td>
                          {isSweep ? (
                            <td colSpan={2} style={{ padding: '5px 8px', borderTop: '1px solid var(--line)', color: 'var(--faint-ink)' }}>
                              shares the bucket above
                            </td>
                          ) : (
                            <>
                              <td style={{ padding: '5px 8px', textAlign: 'right', borderTop: '1px solid var(--line)' }}>
                                {sub ? usd2(sub.mtdUsd) : '–'}
                              </td>
                              <td style={{ padding: '5px 0', textAlign: 'right', borderTop: '1px solid var(--line)' }}>
                                {sub ? usd2(sub.todayUsd) : '–'}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>
            Metered figures are frozen at call time from the rate card. Fixed figures are
            edited in code when subscriptions change.
          </p>
        </section>

        <SpendForecast daily={data.daily} fixedMonthly={fixedTotal} />

        <CostsDashboard data={data} />
      </section>
    </>
  );
}
