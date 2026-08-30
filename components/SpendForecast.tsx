import type { DailyCostPoint } from '@/lib/types';

// The /costs page's "Spend forecast" section: the last 30 actual metered-spend days
// (bars, solid) beside a 30-day forecast (bars, dashed/low-opacity) so the reader sees
// where spend is headed without a chart dependency. Hand-rolled SVG, same idiom as
// CostsDashboard's DailyChart / QuestionMap / ConceptGraph. Server component, no state.

const panel = { background: 'var(--surface)', borderColor: 'var(--line)' } as const;
const usd2 = (n: number): string => `$${n.toFixed(2)}`;

// ---- forecast: trailing-14-day weekday/weekend means ------------------------
// The crons that drive most metered spend (scan, pipeline) are weekday-only, so daily
// spend has a weekly shape a flat trailing average would wash out. For each of the next
// 30 days, use the mean actual spend of the SAME day type (weekday vs weekend) over the
// trailing 14 actual days. Day-of-week is derived from the 'YYYY-MM-DD' string in UTC so
// server and client (there is no client here, but the math stays deterministic) agree.
function parseUTCDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function isWeekendUTC(day: string): boolean {
  const dow = parseUTCDay(day).getUTCDay();
  return dow === 0 || dow === 6;
}
function addDaysUTC(day: string, n: number): string {
  const dt = parseUTCDay(day);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function mean(rows: { cost: number }[]): number {
  return rows.length ? rows.reduce((s, r) => s + r.cost, 0) / rows.length : 0;
}

function computeForecast(actual: { day: string; cost: number }[]): { day: string; cost: number }[] {
  if (actual.length === 0) return [];
  const trailing = actual.slice(-14);
  const overallMean = mean(trailing);
  const weekday = trailing.filter((d) => !isWeekendUTC(d.day));
  const weekend = trailing.filter((d) => isWeekendUTC(d.day));
  const weekdayMean = weekday.length ? mean(weekday) : overallMean;
  const weekendMean = weekend.length ? mean(weekend) : overallMean;
  const lastDay = actual[actual.length - 1].day;
  return Array.from({ length: 30 }, (_, i) => {
    const day = addDaysUTC(lastDay, i + 1);
    return { day, cost: isWeekendUTC(day) ? weekendMean : weekdayMean };
  });
}

export default function SpendForecast({
  daily,
  fixedMonthly,
}: {
  daily: DailyCostPoint[]; // last 30 actual days, oldest -> newest (zero-filled)
  fixedMonthly: number; // the page's FIXED_MONTHLY sum, folded into the run-rate figure
}) {
  const actual = daily.map((d) => ({ day: d.day, cost: d.cost }));
  const forecast = computeForecast(actual);
  const forecastSum = forecast.reduce((s, d) => s + d.cost, 0);
  const runRate = Math.round(forecastSum + fixedMonthly);

  const all = [...actual, ...forecast];
  const nActual = actual.length;
  const n = all.length;

  const W = 920, H = 230, padL = 46, padR = 12, padT = 18, padB = 34;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(1e-9, ...all.map((d) => d.cost));
  const slot = n > 0 ? innerW / n : innerW;
  const bw = Math.max(2, slot * 0.62);
  const xc = (i: number) => padL + (i + 0.5) * slot;
  const y = (v: number) => padT + (1 - v / max) * innerH;
  const zeroY = y(0);
  const todayX = padL + nActual * slot;

  return (
    <section id="forecast" style={{ marginTop: 24, scrollMarginTop: 80 }}>
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div className="section-label" style={{ margin: 0 }}>Spend forecast</div>
        <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--dim)', lineHeight: 1.5 }}>
          <div>next 30 days ≈ {usd2(forecastSum)}</div>
          <div>run rate ≈ ${runRate}/mo all-in</div>
        </div>
      </div>

      <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
        {n === 0 ? (
          <p className="ls-empty" style={{ margin: 0 }}>No spend logged yet.</p>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            role="img"
            aria-label="daily AI spend, last 30 days, and a 30-day forecast"
            style={{ display: 'block' }}
          >
            {/* y max gridline + label */}
            <line x1={padL} y1={y(max)} x2={W - padR} y2={y(max)} stroke="var(--line)" strokeDasharray="2 3" />
            <text x={padL - 6} y={y(max) + 3} textAnchor="end" fontSize="9" fontFamily="var(--font-mono)" fill="var(--faint-ink)">
              {usd2(max)}
            </text>

            {/* zero line */}
            <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="var(--line)" />

            {/* actual: solid bars */}
            {actual.map((d, i) => (
              <rect
                key={`a-${d.day}`}
                x={xc(i) - bw / 2}
                y={y(d.cost)}
                width={bw}
                height={Math.max(0, zeroY - y(d.cost))}
                rx={1}
                fill="var(--accent)"
                opacity={0.55}
              >
                <title>{`${d.day}: ${usd2(d.cost)}`}</title>
              </rect>
            ))}

            {/* forecast: lower opacity + dashed outline, reads as projected not actual */}
            {forecast.map((d, i) => (
              <rect
                key={`f-${d.day}`}
                x={xc(nActual + i) - bw / 2}
                y={y(d.cost)}
                width={bw}
                height={Math.max(0, zeroY - y(d.cost))}
                rx={1}
                fill="var(--accent)"
                fillOpacity={0.14}
                stroke="var(--accent)"
                strokeOpacity={0.65}
                strokeWidth={1}
                strokeDasharray="2 2"
              >
                <title>{`${d.day}: ${usd2(d.cost)} (forecast)`}</title>
              </rect>
            ))}

            {/* today divider, between the two halves */}
            {nActual > 0 && nActual < n && (
              <>
                <line x1={todayX} y1={padT} x2={todayX} y2={zeroY} stroke="var(--faint-ink)" strokeDasharray="3 3" />
                <text x={todayX} y={padT - 6} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--faint-ink)">
                  today
                </text>
              </>
            )}

            {/* first / last date labels */}
            <text x={xc(0)} y={H - 10} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--faint-ink)">
              {all[0].day.slice(5)}
            </text>
            <text x={xc(n - 1)} y={H - 10} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--faint-ink)">
              {all[n - 1].day.slice(5)}
            </text>
          </svg>
        )}

        <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>
          Actual daily metered spend for the last 30 days, and a 30 day forecast from the
          trailing two weeks’ weekday and weekend averages. Forecast excludes fixed
          subscriptions.
        </p>
      </div>
    </section>
  );
}
