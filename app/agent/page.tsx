import { adminGate } from '@/lib/admin-gate';
import { getAgentSpendToday, listBriefs, getNavCounts } from '@/lib/data';
import { AGENT_CHECKS } from '@/lib/agent/checks';
import { agentCapUsd } from '@/lib/agent/budget';
import type { CheckDomain } from '@/lib/agent/types';
import PageTop from '@/components/PageTop';
import { AgentPanel } from '@/components/agent/AgentDrawer';

// The console page: the same tabbed content as the drawer, full width, plus
// a sidebar orienting the operator itself (the check registry, today's
// spend against the cap, and the briefs archive). adminGate first, per
// house convention for every admin-only route.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Atlas Agent · The AI Atlas' };

function fmtDay(iso: string): string {
  return new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

export default async function AgentPage() {
  const gate = await adminGate('/agent', 'Atlas Agent');
  if (gate) return gate;
  const admin = true as const;
  const capUsd = agentCapUsd();
  const [spend, briefs, counts] = await Promise.all([
    getAgentSpendToday(), listBriefs(30), getNavCounts().catch(() => null),
  ]);

  const domains = new Map<CheckDomain, typeof AGENT_CHECKS>();
  for (const c of AGENT_CHECKS) {
    const list = domains.get(c.domain) ?? [];
    list.push(c);
    domains.set(c.domain, list);
  }

  return (
    <>
      <section className="wrap" style={{ maxWidth: 1180, paddingBottom: 100 }}>
        <PageTop
          pathname="/agent"
          label="Atlas Agent"
          viewer={{ admin, portal: admin }}
          counts={counts}
        >
          ${spend.usd.toFixed(4)} spent today of ${capUsd.toFixed(2)}
        </PageTop>

        <div className="ag-page">
          <div className="ag-page-main">
            <AgentPanel variant="page" />
          </div>

          <aside className="ag-sidebar">
            <div className="ag-side-block">
              <h3>Spend today</h3>
              <p className="ag-side-spend">
                ${spend.usd.toFixed(4)} <span className="ag-side-spend-cap">of ${capUsd.toFixed(2)}</span>
              </p>
            </div>

            <div className="ag-side-block">
              <h3>Checks</h3>
              {[...domains.entries()].map(([domain, checks]) => (
                <div key={domain} className="ag-side-domain">
                  <div className="ag-side-domain-label">{domain}</div>
                  {checks.map((c) => (
                    <div key={c.key} className="ag-side-check">
                      <span className="ag-side-check-key">{c.key}</span>
                      {c.title}
                    </div>
                  ))}
                </div>
              ))}
              {domains.size === 0 && <p className="ag-empty">No checks registered yet.</p>}
            </div>

            <div className="ag-side-block">
              <h3>Briefs</h3>
              {briefs.length === 0 && <p className="ag-empty">None yet.</p>}
              {briefs.map((b) => (
                <div key={b.id} className="ag-side-brief">
                  <span className="ag-side-brief-day">{fmtDay(b.day)}</span>
                  <span className="ag-side-brief-headline">{b.memo.headline}</span>
                  <span className="ag-side-brief-status">{b.emailed_at ? 'emailed' : 'not emailed'}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
