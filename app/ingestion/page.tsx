import { adminGate } from '@/lib/admin-gate';
import { getIngestionLedger, getNavCounts } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';

// Admin-only ledger of what the system reads from the outside world: today's
// intake, the corpus retained so far, and the three engines that produce it,
// all queried live. Closes with the 1000x thought experiment and links to the
// story deck (app/ingestion/deck). No AI server action lives on this page, so
// no maxDuration.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ingestion · The AI Atlas' };

const panel = { background: 'var(--surface)', borderColor: 'var(--line)' } as const;

function tileGrid(tiles: { label: string; value: string; sub: string }[]) {
  return (
    <div
      style={{
        marginTop: 14, display: 'grid', gap: 'var(--gap, 10px)',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      }}
    >
      {tiles.map((t) => (
        <div key={t.label} className="rounded-[var(--radius)] border p-3" style={panel}>
          <div className="text-xs" style={{ color: 'var(--faint-ink)' }}>{t.label}</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>{t.value}</div>
          <div className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 2 }}>{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

export default async function IngestionPage() {
  const gate = await adminGate('/ingestion', 'Signal ingestion');
  if (gate) return gate;
  const admin = true as const;
  const { editing, txt } = await getEditContext();
  const ledger = await getIngestionLedger();
  const counts = await getNavCounts().catch(() => null);

  const mChars = ledger.corpus.charsTotal / 1_000_000;

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <PageTop
          pathname="/ingestion"
          label="Signal ingestion"
          viewer={{ admin, portal: admin }}
          counts={counts}
          title={
            <Editable
              as="h1"
              k="ingestion.title"
              value={txt('ingestion.title', 'Signal ingestion')}
              editing={editing}
            />
          }
        >
          {ledger.today.items.toLocaleString()} items today · ${ledger.today.spendUsd.toFixed(2)} spent today
        </PageTop>

        <section id="today" style={{ scrollMarginTop: 80 }}>
          <div className="section-label">Today</div>
          {tileGrid([
            { label: 'Items today', value: ledger.today.items.toLocaleString(), sub: 'discovered across all three engines' },
            { label: 'Items · 14 days', value: ledger.trailing14.items.toLocaleString(), sub: 'trailing two weeks' },
            { label: 'Facts · 14 days', value: ledger.trailing14.facts.toLocaleString(), sub: 'structured, dated, attributed' },
            { label: 'Spend today', value: `$${ledger.today.spendUsd.toFixed(2)}`, sub: 'scan, pipeline, and intel combined' },
            { label: 'Searches · 14 days', value: ledger.trailing14.tavilyQueries.toLocaleString(), sub: 'Tavily queries, model-free' },
          ])}
        </section>

        <section id="corpus" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">The corpus so far</div>
          {tileGrid([
            { label: 'Documents retained', value: ledger.corpus.itemsTotal.toLocaleString(), sub: 'full text, with provenance' },
            { label: 'Characters retained', value: `${mChars.toFixed(1)}M`, sub: 'of source text' },
            { label: 'Published signals', value: ledger.corpus.signalsPublished.toLocaleString(), sub: 'human-gated onto the argument map' },
            { label: 'Facts', value: ledger.corpus.factsTotal.toLocaleString(), sub: 'extracted from tracked companies' },
            { label: 'Metric values', value: ledger.corpus.metricsTotal.toLocaleString(), sub: 'loaded from public regulatory data' },
          ])}
        </section>

        <section id="engines" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">The engines</div>
          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14, overflowX: 'auto' }}>
            <table className="text-xs" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--faint-ink)' }}>
                  <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>engine</th>
                  <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>items · 14 days</th>
                  <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>items · all time</th>
                </tr>
              </thead>
              <tbody>
                {ledger.perEngine.map((e) => (
                  <tr key={e.label} style={{ color: 'var(--dim)' }}>
                    <td style={{ padding: '4px 10px', borderBottom: '1px solid var(--line)' }}>{e.label}</td>
                    <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{e.items14.toLocaleString()}</td>
                    <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{e.itemsTotal.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>
              Each engine is checkpointed, budget-capped, and resumable. Nothing an engine
              discovers enters the record on its own: a human reviews and publishes.
            </p>
          </div>
        </section>

        <section id="story" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">The 1000x question</div>
          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
            <p className="text-sm" style={{ color: 'var(--dim)', lineHeight: 1.6, maxWidth: 720 }}>
              A VP-level thought experiment: what if this intake ran a thousand times bigger?
              The step change is already done, collection here is continuous, structured, and
              cheap, not a research problem anymore. Scale from here is priced arithmetic: each
              order of magnitude has a cost, a bottleneck, and a list of what has to change,
              worked out on the numbers above.
            </p>
            <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 16 }}>
              <a className="btn btn--primary" href="/ingestion/deck">Open the story deck</a>
              <a className="btn" href="/ingestion/deck/pdf">Download the PDF</a>
            </div>
            <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 12 }}>
              The deck&apos;s scaling table pins its cost comparisons to enterprise-platform
              subscription prices, not to a human baseline.
            </p>
          </div>
        </section>
      </section>
    </>
  );
}
