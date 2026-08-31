import type { ReactNode } from 'react';
import type { CostDeck, DeckSlide } from '@/lib/costs-deck';

// Renders every DeckSlide kind into a { id, title, node } item for
// DeckController. Server component, pure functions of the CostDeck payload:
// render EXACTLY what lib/costs-deck.ts computed, never reshape it. Shared
// by the live /costs/deck stage; the PDF export (lib/pdf/costs-deck.tsx)
// consumes the same CostDeck but renders it with react-pdf primitives.

const usd2 = (n: number): string => `$${n.toFixed(2)}`;
const usdWhole = (n: number): string => (n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(0)}`);

function Head({ kicker, title }: { kicker: string; title: string }) {
  return (
    <>
      <div className="cdk-kicker">{kicker}</div>
      <div className="cdk-rule" />
      <h2 className="cdk-h2">{title}</h2>
    </>
  );
}

function Takeaway({ text }: { text: string }) {
  return (
    <div className="cdk-takeaway">
      <div className="cdk-takeaway-k">Takeaway</div>
      <div className="cdk-takeaway-t">{text}</div>
    </div>
  );
}

function TitleSlide(s: Extract<DeckSlide, { kind: 'title' }>) {
  return (
    <div className="cdk-slide cdk-title">
      <div className="cdk-kicker">{s.kicker}</div>
      <div className="cdk-rule" />
      <h2 className="cdk-h2">{s.title}</h2>
      <p className="cdk-subtitle">{s.subtitle}</p>
      <div className="cdk-title-stat">
        <div className="cdk-bigstat-n">{s.bigStat.n}</div>
        <div className="cdk-bigstat-l">{s.bigStat.l}</div>
      </div>
      <div className="cdk-title-date">{s.date}</div>
    </div>
  );
}

function BillSlide(s: Extract<DeckSlide, { kind: 'bill' }>) {
  return (
    <div className="cdk-slide">
      <Head kicker={s.kicker} title={s.title} />
      <div className="cdk-body">
        <div className="cdk-bill-running">
          <div className="cdk-bigstat-n">${s.runningUsd}</div>
          <div className="cdk-bill-running-l">per month, all-in</div>
        </div>
        <div className="cdk-bill-cols">
          <table className="cdk-table">
            <thead>
              <tr>
                <th>Fixed</th>
                <th className="cdk-num">USD / mo</th>
              </tr>
            </thead>
            <tbody>
              {s.fixed.map((f) => (
                <tr key={f.name}>
                  <td>
                    <div className="cdk-cell-main">{f.name}</div>
                    <div className="cdk-cell-sub">{f.note}</div>
                  </td>
                  <td className="cdk-num">{usd2(f.usd)}</td>
                </tr>
              ))}
              <tr className="cdk-total">
                <td>Total fixed</td>
                <td className="cdk-num">{usd2(s.fixedTotalUsd)}</td>
              </tr>
            </tbody>
          </table>

          <div className="cdk-metered-stats">
            <div className="cdk-metered-row">
              <span className="cdk-metered-l">Month to date</span>
              <span className="cdk-metered-n">{usd2(s.mtdUsd)}</span>
            </div>
            <div className="cdk-metered-row">
              <span className="cdk-metered-l">Projected by month end</span>
              <span className="cdk-metered-n">{usd2(s.projectedUsd)}</span>
            </div>
            <div className="cdk-metered-row">
              <span className="cdk-metered-l">Today</span>
              <span className="cdk-metered-n">{usd2(s.todayUsd)}</span>
            </div>
            <div className="cdk-metered-row">
              <span className="cdk-metered-l">All-time metered</span>
              <span className="cdk-metered-n">{usd2(s.allTimeUsd)}</span>
            </div>
            <div className="cdk-metered-row">
              <span className="cdk-metered-l">Calls, month to date</span>
              <span className="cdk-metered-n">{s.mtdCalls.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
      <Takeaway text={s.takeaway} />
    </div>
  );
}

function BarTableSlide(s: Extract<DeckSlide, { kind: 'bar-table' }>) {
  return (
    <div className="cdk-slide">
      <Head kicker={s.kicker} title={s.title} />
      <div className="cdk-body">
        <div className="cdk-bar-colheads">
          <span />
          <span />
          <div className="cdk-bar-colheads-cols">
            {s.colHeads.map((h) => (
              <span key={h}>{h}</span>
            ))}
          </div>
        </div>
        <div className="cdk-bars">
          {s.rows.map((r) => (
            <div className="cdk-bar-row" key={r.label}>
              <div>
                <div className="cdk-bar-label">{r.label}</div>
                {r.sub && <div className="cdk-bar-sub">{r.sub}</div>}
              </div>
              <div className="cdk-bar-track">
                <div
                  className="cdk-bar-fill"
                  style={{ width: `${Math.max(1.5, (r.value / (s.maxValue || 1)) * 100)}%` }}
                />
              </div>
              <div className="cdk-bar-cols">
                {r.cols.map((c, i) => (
                  <span key={i}>{c}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <Takeaway text={s.takeaway} />
    </div>
  );
}

function ForecastChartSlide(s: Extract<DeckSlide, { kind: 'forecast-chart' }>) {
  const all = [...s.actual, ...s.forecast];
  const nActual = s.actual.length;
  const n = all.length;
  const W = 1500, H = 560, padL = 74, padR = 20, padT = 24, padB = 56;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(1e-9, ...all.map((d) => d.cost));
  const slot = n > 0 ? innerW / n : innerW;
  const bw = Math.max(3, slot * 0.62);
  const xc = (i: number) => padL + (i + 0.5) * slot;
  const y = (v: number) => padT + (1 - v / max) * innerH;
  const zeroY = y(0);
  const todayX = padL + nActual * slot;

  return (
    <div className="cdk-slide">
      <Head kicker={s.kicker} title={s.title} />
      <div className="cdk-body">
        <div className="cdk-forecast-head">
          <div />
          <div className="cdk-forecast-figs">
            <div className="cdk-forecast-fig">
              <div className="cdk-fig-n">{usd2(s.forecastSumUsd)}</div>
              <div className="cdk-fig-l">Next 30 days</div>
            </div>
            <div className="cdk-forecast-fig">
              <div className="cdk-fig-n">${s.runRateUsd}</div>
              <div className="cdk-fig-l">Run rate / mo</div>
            </div>
          </div>
        </div>

        {n === 0 ? (
          <p style={{ color: 'var(--faint-ink)', fontSize: '1.4cqw' }}>No spend logged yet.</p>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="cdk-forecast-svg"
            role="img"
            aria-label="daily AI spend, last 30 days, and a 30-day forecast"
          >
            <line x1={padL} y1={y(max)} x2={W - padR} y2={y(max)} stroke="var(--line)" strokeDasharray="4 6" />
            <text x={padL - 10} y={y(max) + 5} textAnchor="end" fontSize="16" fontFamily="var(--font-mono)" fill="var(--faint-ink)">
              {usd2(max)}
            </text>
            <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="var(--line)" />

            {s.actual.map((d, i) => (
              <rect
                key={`a-${d.day}`}
                x={xc(i) - bw / 2}
                y={y(d.cost)}
                width={bw}
                height={Math.max(0, zeroY - y(d.cost))}
                rx={2}
                fill="var(--accent)"
                opacity={0.78}
              >
                <title>{`${d.day}: ${usd2(d.cost)}`}</title>
              </rect>
            ))}

            {s.forecast.map((d, i) => (
              <rect
                key={`f-${d.day}`}
                x={xc(nActual + i) - bw / 2}
                y={y(d.cost)}
                width={bw}
                height={Math.max(0, zeroY - y(d.cost))}
                rx={2}
                fill="var(--accent)"
                fillOpacity={0.16}
                stroke="var(--accent)"
                strokeOpacity={0.6}
                strokeWidth={1.5}
                strokeDasharray="3 3"
              >
                <title>{`${d.day}: ${usd2(d.cost)} (forecast)`}</title>
              </rect>
            ))}

            {nActual > 0 && nActual < n && (
              <>
                <line x1={todayX} y1={padT} x2={todayX} y2={zeroY} stroke="var(--faint-ink)" strokeDasharray="4 4" />
                <text x={todayX} y={padT - 8} textAnchor="middle" fontSize="15" fontFamily="var(--font-mono)" fill="var(--faint-ink)">
                  today
                </text>
              </>
            )}

            <text x={xc(0)} y={H - 18} textAnchor="middle" fontSize="15" fontFamily="var(--font-mono)" fill="var(--faint-ink)">
              {all[0].day.slice(5)}
            </text>
            <text x={xc(n - 1)} y={H - 18} textAnchor="middle" fontSize="15" fontFamily="var(--font-mono)" fill="var(--faint-ink)">
              {all[n - 1].day.slice(5)}
            </text>
          </svg>
        )}
      </div>
      <Takeaway text={s.takeaway} />
    </div>
  );
}

function BeforeAfterSlide(s: Extract<DeckSlide, { kind: 'before-after' }>) {
  return (
    <div className="cdk-slide">
      <Head kicker={s.kicker} title={s.title} />
      <div className="cdk-body">
        <div className="cdk-ba-list">
          {s.pairs.map((p) => (
            <div className="cdk-ba-row" key={p.label}>
              <div className="cdk-ba-label">{p.label}</div>
              <div className="cdk-ba-before">
                <div className="cdk-ba-stat-n">{p.before.n}</div>
                <div className="cdk-ba-stat-l">{p.before.l}</div>
              </div>
              <div className="cdk-ba-arrow">&rarr;</div>
              <div className="cdk-ba-after">
                <div className="cdk-ba-stat-n">{p.after.n}</div>
                <div className="cdk-ba-stat-l">{p.after.l}</div>
              </div>
              <div className="cdk-ba-factor">{p.factor}</div>
            </div>
          ))}
        </div>
        <div className="cdk-ba-footnote">{s.footnote}</div>
      </div>
      <Takeaway text={s.takeaway} />
    </div>
  );
}

function TableSlide(s: Extract<DeckSlide, { kind: 'table' }>) {
  return (
    <div className="cdk-slide">
      <Head kicker={s.kicker} title={s.title} />
      <div className="cdk-body">
        <div className="cdk-table-wrap">
          <table className="cdk-table">
            <thead>
              <tr>
                {s.heads.map((h, i) => (
                  <th key={h} className={s.rows[0]?.[i]?.startsWith('$') ? 'cdk-num' : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={cell.startsWith('$') ? 'cdk-num' : undefined}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.note && <div className="cdk-table-note">{s.note}</div>}
      </div>
      <Takeaway text={s.takeaway} />
    </div>
  );
}

function StatGridSlide(s: Extract<DeckSlide, { kind: 'stat-grid' }>) {
  return (
    <div className="cdk-slide">
      <Head kicker={s.kicker} title={s.title} />
      <div className="cdk-body">
        <div className="cdk-stat-grid">
          {s.stats.map((st, i) => (
            <div className="cdk-stat-cell" key={i}>
              <div className="cdk-stat-n">{st.n}</div>
              <div className="cdk-stat-l">{st.l}</div>
              {st.sub && <div className="cdk-stat-sub">{st.sub}</div>}
            </div>
          ))}
        </div>
        {s.note && <div className="cdk-stat-note">{s.note}</div>}
      </div>
      <Takeaway text={s.takeaway} />
    </div>
  );
}

function DividerSlide(s: Extract<DeckSlide, { kind: 'divider' }>) {
  return (
    <div className="cdk-slide cdk-divider">
      <div className="cdk-kicker">{s.kicker}</div>
      <h2 className="cdk-h2">{s.title}</h2>
      <p className="cdk-subtitle">{s.subtitle}</p>
    </div>
  );
}

function MatrixSlide(s: Extract<DeckSlide, { kind: 'matrix' }>) {
  return (
    <div className="cdk-slide">
      <Head kicker={s.kicker} title={s.title} />
      <div className="cdk-body">
        <div className="cdk-matrix-wrap">
          <table className="cdk-matrix">
            <thead>
              <tr>
                <th />
                {s.cols.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  {r.cells.map((c, i) => (
                    <td key={i}>
                      <span className="cdk-matrix-cell">
                        {c === 'yes' && <span className="cdk-dot-yes" aria-label="yes" />}
                        {c === 'partial' && (
                          <>
                            <span className="cdk-dot-partial" aria-label="partial" />
                            <span className="cdk-partial-label">partial</span>
                          </>
                        )}
                        {c === 'no' && (
                          <span className="cdk-dot-no" aria-label="no">
                            &ndash;
                          </span>
                        )}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="cdk-matrix-note">{s.note}</div>
      </div>
      <Takeaway text={s.takeaway} />
    </div>
  );
}

function BulletsSlide(s: Extract<DeckSlide, { kind: 'bullets' }>) {
  return (
    <div className="cdk-slide">
      <Head kicker={s.kicker} title={s.title} />
      <div className="cdk-body">
        <div className="cdk-bullets">
          {s.bullets.map((b, i) => (
            <div className="cdk-bullet-row" key={i}>
              <span className="cdk-bullet-mark" aria-hidden="true" />
              <div className="cdk-bullet-copy">
                <span className="cdk-bullet-lead">{b.lead}</span>
                {' '}
                <span className="cdk-bullet-text">{b.text}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <Takeaway text={s.takeaway} />
    </div>
  );
}

// Fixed log10 domain shared with the PDF renderer ($500-$100k) so the two
// exports read as the same chart, not just the same numbers.

function PriceCompareSlide(s: Extract<DeckSlide, { kind: 'price-compare' }>) {

  return (
    <div className="cdk-slide">
      <Head kicker={s.kicker} title={s.title} />
      <div className="cdk-body">
        <div className="cdk-pc-ours">
          <div className="cdk-pc-ours-n">{usdWhole(s.ours.usd)}</div>
          <div className="cdk-pc-ours-meta">
            <div className="cdk-pc-ours-l">{s.ours.label}</div>
            <div className="cdk-pc-ours-u">{s.ours.unit}</div>
          </div>
        </div>

        <div className="cdk-pc-rows">
          {s.items.map((it) => {
            return (
              <div className="cdk-pc-row" key={it.label}>
                <div className="cdk-pc-cat">
                  <div className="cdk-pc-cat-label">{it.label}</div>
                  <div className="cdk-pc-cat-example">{it.example}</div>
                </div>

                <div className="cdk-pc-range">
                  <div className="cdk-pc-range-n">
                    {usdWhole(it.lowUsd)}&ndash;{usdWhole(it.highUsd)}
                  </div>
                  <div className="cdk-pc-range-u">{it.unit}</div>
                </div>


                <div className="cdk-pc-mult">
                  <div className="cdk-pc-mult-n">{it.multiple}</div>
                  <div className="cdk-pc-mult-c">this system&apos;s annual cost</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="cdk-pc-sources">
          {s.items.map((it) => (
            <div className="cdk-pc-source-row" key={it.label}>
              <strong>{it.label}:</strong> {it.source}
            </div>
          ))}
        </div>

        <div className="cdk-pc-footnote">{s.footnote}</div>
      </div>
      <Takeaway text={s.takeaway} />
    </div>
  );
}

function renderSlide(slide: DeckSlide) {
  switch (slide.kind) {
    case 'title': return <TitleSlide {...slide} />;
    case 'bill': return <BillSlide {...slide} />;
    case 'bar-table': return <BarTableSlide {...slide} />;
    case 'forecast-chart': return <ForecastChartSlide {...slide} />;
    case 'before-after': return <BeforeAfterSlide {...slide} />;
    case 'table': return <TableSlide {...slide} />;
    case 'stat-grid': return <StatGridSlide {...slide} />;
    case 'divider': return <DividerSlide {...slide} />;
    case 'matrix': return <MatrixSlide {...slide} />;
    case 'bullets': return <BulletsSlide {...slide} />;
    case 'price-compare': return <PriceCompareSlide {...slide} />;
  }
}

export function renderDeckSlides(deck: CostDeck): { id: string; title: string; node: ReactNode }[] {
  return deck.slides.map((slide, i) => ({
    id: `slide-${i}`,
    title: slide.title,
    node: renderSlide(slide),
  }));
}
