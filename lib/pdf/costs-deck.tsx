import {
  renderToBuffer, Document, Page, View, Text, StyleSheet, Svg, Rect, Line,
} from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import type { CostDeck, DeckSlide, DeckStat } from '@/lib/costs-deck';
import { registerFonts, COBALT, INK, DIM, LINE, PdfFooter, StatBand } from './shell';

// The 16:9 PDF export of the cost deck: one Page (960x540, true 16:9) per
// DeckSlide. Renders EXACTLY the CostDeck payload built by buildCostDeckData
// (lib/costs-deck.ts) - no reformatting of already-formatted strings, only
// the raw-number fields get formatted here. Same visual language as the other
// PDF exports (lib/pdf/shell.tsx): kicker + rule + Anton headline, StatBand
// cells, bordered-row tables, PdfFooter mounted last on every page. Own
// StyleSheet proportioned for the 960x540 canvas rather than A4.

const PAGE_SIZE: [number, number] = [960, 540];
const PAD = 44;
const CONTENT_W = 960 - PAD * 2; // 872
const FAINT = '#95a0b1';

const usd0 = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
const usd2 = (n: number): string => `$${n.toFixed(2)}`;

const s = StyleSheet.create({
  page: {
    paddingTop: 40, paddingHorizontal: PAD, paddingBottom: 46,
    fontFamily: 'Schibsted', fontSize: 11, color: INK, lineHeight: 1.4,
    backgroundColor: '#ffffff',
  },
  body: { paddingBottom: 4 },
  bodyCenter: { flexGrow: 1, justifyContent: 'center' },
  kicker: {
    fontFamily: 'JetBrains', fontSize: 9, letterSpacing: 2.2, color: COBALT,
    textTransform: 'uppercase', marginBottom: 8,
  },
  ruleHeavy: { borderTopWidth: 2.5, borderTopColor: INK, marginBottom: 14 },
  title: { fontFamily: 'Anton', fontSize: 30, lineHeight: 1.1, color: INK, marginBottom: 10 },
  // Positioned absolute (never part of normal flow) so it can never push a
  // slide's content past the 540pt page and trigger a page split: it always
  // sits in the same spot, just above the footer, whatever the body's height.
  takeawayAbsolute: {
    position: 'absolute', left: PAD, right: PAD, bottom: 48,
    borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8,
    backgroundColor: '#ffffff',
  },
  takeawayLabel: {
    fontFamily: 'JetBrains', fontSize: 7.5, letterSpacing: 1.6, color: COBALT,
    textTransform: 'uppercase', marginBottom: 3,
  },
  takeawayText: { fontSize: 10.5, color: INK, lineHeight: 1.4, maxWidth: CONTENT_W - 40 },

  // cover / title slide
  coverTitle: { fontFamily: 'Anton', fontSize: 46, lineHeight: 1.06, color: INK, marginBottom: 14, maxWidth: 760 },
  coverSubtitle: { fontSize: 13, color: DIM, lineHeight: 1.5, maxWidth: 640, marginBottom: 26 },
  bigStatN: { fontFamily: 'Anton', fontSize: 52, lineHeight: 1, color: COBALT },
  bigStatL: { fontFamily: 'JetBrains', fontSize: 9.5, color: DIM, marginTop: 10, maxWidth: 480, lineHeight: 1.4 },
  coverDate: { fontFamily: 'JetBrains', fontSize: 9, color: FAINT, letterSpacing: 1 },

  // divider slide
  dividerTitle: { fontFamily: 'Anton', fontSize: 44, lineHeight: 1.08, color: INK, textAlign: 'center', marginTop: 8 },
  dividerSubtitle: { fontSize: 13, color: DIM, textAlign: 'center', marginTop: 14, maxWidth: 560 },

  // dominant figure (bill slide)
  dominantRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 18 },
  dominantN: { fontFamily: 'Anton', fontSize: 44, color: COBALT, lineHeight: 1 },
  dominantL: { fontFamily: 'JetBrains', fontSize: 9, color: DIM, marginLeft: 14, marginBottom: 6, maxWidth: 380, lineHeight: 1.4 },

  // generic section label
  sectionLabel: {
    fontFamily: 'JetBrains', fontSize: 8, letterSpacing: 1.4, color: FAINT,
    textTransform: 'uppercase', marginBottom: 6,
  },

  // bill: fixed table
  fixedRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 5 },
  fixedName: { flex: 1, fontSize: 10 },
  fixedNote: { fontSize: 8, color: DIM, marginTop: 1 },
  fixedUsd: { fontFamily: 'JetBrains', fontSize: 10, width: 60, textAlign: 'right' },
  fixedTotalRow: { flexDirection: 'row', borderTopWidth: 1.5, borderTopColor: INK, paddingTop: 6, marginTop: 2 },
  fixedTotalLabel: { flex: 1, fontSize: 10, fontWeight: 'bold' },
  fixedTotalUsd: { fontFamily: 'JetBrains', fontSize: 10, width: 60, textAlign: 'right', fontWeight: 'bold' },

  // generic table (table / bar-table / matrix)
  tableHead: { flexDirection: 'row', borderBottomWidth: 1.5, borderBottomColor: INK, paddingBottom: 5, marginBottom: 2 },
  tableHeadCell: {
    flex: 1, fontFamily: 'JetBrains', fontSize: 7.5, letterSpacing: 1, color: FAINT,
    textTransform: 'uppercase', paddingRight: 8,
  },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 4, alignItems: 'flex-start' },
  tableCell: { flex: 1, fontSize: 9.5, lineHeight: 1.35, paddingRight: 8 },
  tableCellMono: { fontFamily: 'JetBrains' },
  tableCellRight: { textAlign: 'right' },
  tableNote: { fontSize: 8.5, color: DIM, marginTop: 8, lineHeight: 1.5 },

  // bar-table (up to 9 rows: kept tight so 9 rows plus the head never crowds
  // the absolute takeaway band)
  barRowLabel: { width: 190 },
  barLabelText: { fontSize: 9.5, fontWeight: 'bold', lineHeight: 1.2 },
  barSubText: { fontSize: 7, color: DIM, marginTop: 0.5, lineHeight: 1.2 },
  barCols: { flexDirection: 'row', flex: 1 },
  barColCell: { flex: 1, fontFamily: 'JetBrains', fontSize: 9, textAlign: 'right', paddingRight: 6 },
  barColHead: {
    flex: 1, fontFamily: 'JetBrains', fontSize: 6.5, letterSpacing: 0.6, color: FAINT,
    textTransform: 'uppercase', textAlign: 'right', paddingRight: 6, lineHeight: 1.2,
  },

  // before-after: five fixed-width columns in plain column flow (label,
  // before stat, arrow, after stat, factor chip) - nothing absolutely
  // positioned, so a number can never render on top of its own label.
  pairRow: {
    flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14,
    borderBottomWidth: 1, borderBottomColor: LINE, paddingBottom: 12,
  },
  pairLabelCol: { width: 174, paddingRight: 10 },
  pairLabelText: { fontSize: 10, fontWeight: 'bold', lineHeight: 1.3 },
  pairBeforeCol: { width: 227, paddingRight: 10 },
  pairBeforeN: { fontFamily: 'Anton', fontSize: 17, color: DIM, lineHeight: 1.2 },
  pairBeforeL: { fontSize: 7.5, color: DIM, marginTop: 2, lineHeight: 1.3 },
  pairArrowCol: { width: 44, alignItems: 'center', paddingTop: 4 },
  pairArrowText: { fontFamily: 'Anton', fontSize: 16, color: DIM },
  pairAfterCol: { width: 279, paddingRight: 10 },
  pairAfterN: { fontFamily: 'Anton', fontSize: 23, color: COBALT, lineHeight: 1.2 },
  pairAfterL: { fontSize: 7.5, color: DIM, marginTop: 2, lineHeight: 1.3 },
  pairFactorCol: { width: 131 },
  pairFactorBadge: { borderWidth: 1, borderColor: COBALT, paddingHorizontal: 7, paddingVertical: 4, alignSelf: 'flex-start' },
  pairFactorText: { fontFamily: 'JetBrains', fontSize: 8.5, fontWeight: 'bold', color: COBALT },

  // stat-grid
  statGridRow: {
    flexDirection: 'row', borderTopWidth: 2, borderTopColor: INK,
    borderBottomWidth: 1, borderBottomColor: FAINT, marginBottom: 4,
  },
  statGridCell: { flex: 1, paddingVertical: 14, paddingHorizontal: 10, borderLeftWidth: 1, borderLeftColor: LINE },
  statGridCellFirst: { borderLeftWidth: 0 },
  statGridN: { fontFamily: 'Anton', fontSize: 24, color: INK, lineHeight: 1 },
  statGridL: { fontFamily: 'JetBrains', fontSize: 7.5, color: DIM, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 5, lineHeight: 1.4 },
  statGridSub: { fontSize: 7.5, color: FAINT, marginTop: 3, lineHeight: 1.3 },

  // matrix (8 rows: kept tight so they never crowd the absolute takeaway band)
  matrixHeadCell: { flex: 1, fontFamily: 'JetBrains', fontSize: 6.5, letterSpacing: 0.4, color: FAINT, textTransform: 'uppercase', textAlign: 'center', lineHeight: 1.25, paddingHorizontal: 3 },
  matrixLabelCell: { flex: 1.7, fontSize: 8.5, lineHeight: 1.2, paddingRight: 8 },
  matrixValCell: { flex: 1, fontSize: 9, fontFamily: 'JetBrains', textAlign: 'center' },

  // forecast chart
  chartYMax: { fontFamily: 'JetBrains', fontSize: 8, color: FAINT, marginBottom: 4 },
  chartWrap: { position: 'relative' },
  chartLabel: { position: 'absolute', fontFamily: 'JetBrains', fontSize: 7, color: DIM },

  // price-compare (kept tight so the 5 comps plus source lines never crowd
  // the absolute takeaway band)
  priceRow: { marginBottom: 6 },
  priceRowTop: { flexDirection: 'row', alignItems: 'center' },
  priceLabelBlock: { width: 200 },
  priceLabelText: { fontSize: 9.5, fontWeight: 'bold', lineHeight: 1.2 },
  priceExampleText: { fontSize: 7.5, color: DIM, marginTop: 1, lineHeight: 1.2 },
  priceRangeText: { fontFamily: 'JetBrains', fontSize: 8.5, width: 110, textAlign: 'right' },
  priceSourceText: { fontSize: 6.5, color: DIM, marginTop: 2, maxWidth: 780, lineHeight: 1.2 },
  axisLabel: { fontFamily: 'JetBrains', fontSize: 7, color: FAINT },
});

// -------------------------------------------------------------- slide shell

function SlideBody({ kicker, title, children, takeaway }: {
  kicker: string;
  title: string;
  children: ReactNode;
  takeaway?: string;
}): ReactNode {
  return (
    <Page size={PAGE_SIZE} style={s.page}>
      <View style={s.body} wrap={false}>
        <Text style={s.kicker}>{kicker}</Text>
        <View style={s.ruleHeavy} />
        <Text style={s.title}>{title}</Text>
        {children}
      </View>
      {takeaway !== undefined && (
        <View style={s.takeawayAbsolute} wrap={false}>
          <Text style={s.takeawayLabel}>Takeaway</Text>
          <Text style={s.takeawayText}>{takeaway}</Text>
        </View>
      )}
      <PdfFooter label="COST REPORT" />
    </Page>
  );
}

// ------------------------------------------------------------------ title

function TitleSlide({ slide }: { slide: Extract<DeckSlide, { kind: 'title' }> }): ReactNode {
  return (
    <Page size={PAGE_SIZE} style={s.page}>
      <View style={s.bodyCenter} wrap={false}>
        <Text style={s.kicker}>{slide.kicker}</Text>
        <View style={s.ruleHeavy} />
        <Text style={s.coverTitle}>{slide.title}</Text>
        <Text style={s.coverSubtitle}>{slide.subtitle}</Text>
        <View>
          <Text style={s.bigStatN}>{slide.bigStat.n}</Text>
          <Text style={s.bigStatL}>{slide.bigStat.l}</Text>
        </View>
      </View>
      <View wrap={false}>
        <Text style={s.coverDate}>{slide.date}</Text>
      </View>
      <PdfFooter label="COST REPORT" />
    </Page>
  );
}

// ---------------------------------------------------------------- divider

function DividerSlide({ slide }: { slide: Extract<DeckSlide, { kind: 'divider' }> }): ReactNode {
  return (
    <Page size={PAGE_SIZE} style={s.page}>
      <View style={[s.bodyCenter, { alignItems: 'center' }]} wrap={false}>
        <Text style={[s.kicker, { textAlign: 'center' }]}>{slide.kicker}</Text>
        <Text style={s.dividerTitle}>{slide.title}</Text>
        <Text style={s.dividerSubtitle}>{slide.subtitle}</Text>
      </View>
      <PdfFooter label="COST REPORT" />
    </Page>
  );
}

// -------------------------------------------------------------------- bill

function BillSlide({ slide }: { slide: Extract<DeckSlide, { kind: 'bill' }> }): ReactNode {
  return (
    <SlideBody kicker={slide.kicker} title={slide.title} takeaway={slide.takeaway}>
      <View style={s.dominantRow}>
        <Text style={s.dominantN}>{usd0(slide.runningUsd)}</Text>
        <Text style={s.dominantL}>per month, all-in{'\n'}fixed platform plus metered intelligence</Text>
      </View>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1, marginRight: 30 }}>
          <Text style={s.sectionLabel}>Fixed platform</Text>
          {slide.fixed.map((f, i) => (
            <View key={i} style={s.fixedRow} wrap={false}>
              <View style={s.fixedName}>
                <Text>{f.name}</Text>
                <Text style={s.fixedNote}>{f.note}</Text>
              </View>
              <Text style={s.fixedUsd}>{usd2(f.usd)}</Text>
            </View>
          ))}
          <View style={s.fixedTotalRow}>
            <Text style={s.fixedTotalLabel}>Fixed total, per month</Text>
            <Text style={s.fixedTotalUsd}>{usd2(slide.fixedTotalUsd)}</Text>
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.sectionLabel}>Metered this month</Text>
          <StatBand cells={[
            { n: usd2(slide.mtdUsd), label: 'Month to date' },
            { n: usd2(slide.projectedUsd), label: 'Projected, full month' },
          ]} />
          <StatBand cells={[
            { n: usd2(slide.todayUsd), label: 'Today' },
            { n: usd2(slide.allTimeUsd), label: 'All time' },
            { n: slide.mtdCalls.toLocaleString('en-US'), label: 'Calls, this month' },
          ]} />
        </View>
      </View>
    </SlideBody>
  );
}

// --------------------------------------------------------------- bar-table

function BarTableSlide({ slide }: { slide: Extract<DeckSlide, { kind: 'bar-table' }> }): ReactNode {
  const BAR_W = 220;
  const BAR_H = 10;
  return (
    <SlideBody kicker={slide.kicker} title={slide.title} takeaway={slide.takeaway}>
      <View style={{ flexDirection: 'row', marginBottom: 3 }}>
        <View style={s.barRowLabel} />
        <View style={{ width: BAR_W, marginRight: 12 }} />
        <View style={s.barCols}>
          {slide.colHeads.map((h, i) => <Text key={i} style={s.barColHead}>{h}</Text>)}
        </View>
      </View>
      {slide.rows.map((row, i) => {
        const w = Math.max(2, Math.round((row.value / slide.maxValue) * BAR_W));
        return (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }} wrap={false}>
            <View style={s.barRowLabel}>
              <Text style={s.barLabelText}>{row.label}</Text>
              {row.sub && <Text style={s.barSubText}>{row.sub}</Text>}
            </View>
            <Svg width={BAR_W} height={BAR_H} style={{ marginRight: 12 }}>
              <Rect x={0} y={0} width={BAR_W} height={BAR_H} fill={LINE} />
              <Rect x={0} y={0} width={w} height={BAR_H} fill={COBALT} />
            </Svg>
            <View style={s.barCols}>
              {row.cols.map((c, j) => <Text key={j} style={s.barColCell}>{c}</Text>)}
            </View>
          </View>
        );
      })}
    </SlideBody>
  );
}

// ----------------------------------------------------------- forecast-chart

function ForecastChartSlide({ slide }: { slide: Extract<DeckSlide, { kind: 'forecast-chart' }> }): ReactNode {
  const CHART_W = CONTENT_W;
  const CHART_H = 160;
  const all = [...slide.actual, ...slide.forecast];
  const yMax = Math.max(...all.map((d) => d.cost), 0.01);
  const n = Math.max(all.length, 1);
  const gap = 1.2;
  const barW = Math.max(1.5, (CHART_W - gap * (n - 1)) / n);
  const todayX = slide.actual.length * (barW + gap);

  return (
    <SlideBody kicker={slide.kicker} title={slide.title} takeaway={slide.takeaway}>
      <Text style={s.chartYMax}>{`y-max ${usd2(yMax)} / day`}</Text>
      <View style={s.chartWrap}>
        <Svg width={CHART_W} height={CHART_H}>
          <Rect x={0} y={0} width={CHART_W} height={CHART_H} fill="#ffffff" stroke={LINE} strokeWidth={1} />
          {all.map((d, i) => {
            const isForecast = i >= slide.actual.length;
            const h = Math.max(1, (d.cost / yMax) * (CHART_H - 18));
            const x = i * (barW + gap);
            const y = CHART_H - 18 - h;
            return (
              <Rect
                key={i} x={x} y={y} width={barW} height={h}
                fill={COBALT} fillOpacity={isForecast ? 0.35 : 1}
              />
            );
          })}
          <Line x1={todayX} y1={0} x2={todayX} y2={CHART_H - 18} stroke={INK} strokeWidth={1} strokeDasharray="3,2" />
        </Svg>
        <Text style={[s.chartLabel, { left: 8, top: 6 }]}>actual</Text>
        <Text style={[s.chartLabel, { left: todayX + 6, top: 6, color: INK }]}>today, forecast begins</Text>
      </View>
      <View style={{ flexDirection: 'row', marginTop: 14 }}>
        <View style={{ flex: 1 }}>
          <StatBand cells={[
            { n: usd0(slide.forecastSumUsd), label: 'Next 30 days, forecast, metered spend' },
            { n: usd0(slide.runRateUsd), label: 'Projected monthly run-rate, all-in' },
          ]} />
        </View>
      </View>
    </SlideBody>
  );
}

// ----------------------------------------------------------- before-after

function BeforeAfterSlide({ slide }: { slide: Extract<DeckSlide, { kind: 'before-after' }> }): ReactNode {
  return (
    <SlideBody kicker={slide.kicker} title={slide.title} takeaway={slide.takeaway}>
      {slide.pairs.map((pair, i) => (
        <View key={i} style={s.pairRow} wrap={false}>
          <View style={s.pairLabelCol}>
            <Text style={s.pairLabelText}>{pair.label}</Text>
          </View>
          <View style={s.pairBeforeCol}>
            <Text style={s.pairBeforeN}>{pair.before.n}</Text>
            <Text style={s.pairBeforeL}>{pair.before.l}</Text>
          </View>
          <View style={s.pairArrowCol}>
            <Text style={s.pairArrowText}>{'→'}</Text>
          </View>
          <View style={s.pairAfterCol}>
            <Text style={s.pairAfterN}>{pair.after.n}</Text>
            <Text style={s.pairAfterL}>{pair.after.l}</Text>
          </View>
          <View style={s.pairFactorCol}>
            <View style={s.pairFactorBadge}>
              <Text style={s.pairFactorText}>{pair.factor}</Text>
            </View>
          </View>
        </View>
      ))}
      <Text style={s.tableNote}>{slide.footnote}</Text>
    </SlideBody>
  );
}

// ------------------------------------------------------------------- table

function DeckTable({ heads, rows, note }: { heads: string[]; rows: string[][]; note?: string }): ReactNode {
  return (
    <View>
      <View style={s.tableHead} wrap={false}>
        {heads.map((h, i) => (
          <Text key={i} style={[s.tableHeadCell, i === 0 ? { flex: 1.6 } : undefined]}>{h}</Text>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={s.tableRow} wrap={false}>
          {row.map((cell, ci) => (
            <Text
              key={ci}
              style={[
                s.tableCell,
                ci === 0 ? { flex: 1.6 } : undefined,
                cell.startsWith('$') ? [s.tableCellMono, s.tableCellRight] : undefined,
              ]}
            >
              {cell}
            </Text>
          ))}
        </View>
      ))}
      {note && <Text style={s.tableNote}>{note}</Text>}
    </View>
  );
}

function TableSlide({ slide }: { slide: Extract<DeckSlide, { kind: 'table' }> }): ReactNode {
  return (
    <SlideBody kicker={slide.kicker} title={slide.title} takeaway={slide.takeaway}>
      <DeckTable heads={slide.heads} rows={slide.rows} note={slide.note} />
    </SlideBody>
  );
}

// --------------------------------------------------------------- stat-grid

function StatGridSlide({ slide }: { slide: Extract<DeckSlide, { kind: 'stat-grid' }> }): ReactNode {
  const rows = [slide.stats.slice(0, 3), slide.stats.slice(3, 6)];
  return (
    <SlideBody kicker={slide.kicker} title={slide.title} takeaway={slide.takeaway}>
      {rows.map((row, ri) => (
        <View key={ri} style={s.statGridRow}>
          {row.map((stat: DeckStat, i) => (
            <View key={i} style={i === 0 ? [s.statGridCell, s.statGridCellFirst] : s.statGridCell}>
              <Text style={s.statGridN}>{stat.n}</Text>
              <Text style={s.statGridL}>{stat.l}</Text>
              {stat.sub && <Text style={s.statGridSub}>{stat.sub}</Text>}
            </View>
          ))}
        </View>
      ))}
      {slide.note && <Text style={s.tableNote}>{slide.note}</Text>}
    </SlideBody>
  );
}

// ------------------------------------------------------------------ matrix

const MATRIX_LABEL: Record<'yes' | 'partial' | 'no', string> = { yes: 'Yes', partial: 'Partial', no: '–' };
const MATRIX_COLOR: Record<'yes' | 'partial' | 'no', string> = { yes: COBALT, partial: DIM, no: FAINT };

function MatrixSlide({ slide }: { slide: Extract<DeckSlide, { kind: 'matrix' }> }): ReactNode {
  return (
    <SlideBody kicker={slide.kicker} title={slide.title} takeaway={slide.takeaway}>
      <View style={s.tableHead} wrap={false}>
        <Text style={s.matrixLabelCell} />
        {slide.cols.map((c, i) => <Text key={i} style={s.matrixHeadCell}>{c}</Text>)}
      </View>
      {slide.rows.map((row, ri) => (
        <View key={ri} style={s.tableRow} wrap={false}>
          <Text style={s.matrixLabelCell}>{row.label}</Text>
          {row.cells.map((cell, ci) => (
            <Text key={ci} style={[s.matrixValCell, { color: MATRIX_COLOR[cell], fontWeight: cell === 'yes' ? 'bold' : 'normal' }]}>
              {MATRIX_LABEL[cell]}
            </Text>
          ))}
        </View>
      ))}
      <Text style={s.tableNote}>{slide.note}</Text>
    </SlideBody>
  );
}

// ---------------------------------------------------------- price-compare

function PriceCompareSlide({ slide }: { slide: Extract<DeckSlide, { kind: 'price-compare' }> }): ReactNode {
  const LABEL_W = 200;
  const CHART_X0 = LABEL_W + 10;
  const CHART_W = CONTENT_W - CHART_X0 - 110;
  const ROW_H = 29;
  const logMin = Math.log10(500);
  const logMax = Math.log10(100_000);
  const scaleX = (usd: number): number => {
    const v = Math.min(Math.max(usd, 500), 100_000);
    return ((Math.log10(v) - logMin) / (logMax - logMin)) * CHART_W;
  };
  const oursX = scaleX(slide.ours.usd);
  const totalH = slide.items.length * ROW_H;

  return (
    <SlideBody kicker={slide.kicker} title={slide.title} takeaway={slide.takeaway}>
      <View style={s.chartWrap}>
        <View>
          {slide.items.map((item, i) => {
            const x1 = scaleX(item.lowUsd);
            const x2 = scaleX(item.highUsd);
            return (
              <View key={i} style={s.priceRow} wrap={false}>
                <View style={s.priceRowTop}>
                  <View style={[s.priceLabelBlock, { width: LABEL_W }]}>
                    <Text style={s.priceLabelText}>{item.label}</Text>
                    <Text style={s.priceExampleText}>{`${item.example}, ${item.unit}`}</Text>
                  </View>
                  <Svg width={CHART_W} height={12}>
                    <Rect x={x1} y={0} width={Math.max(2, x2 - x1)} height={12} fill={COBALT} fillOpacity={0.5} />
                  </Svg>
                  <Text style={s.priceRangeText}>{`${usd0(item.lowUsd)} to ${usd0(item.highUsd)}`}</Text>
                </View>
                <Text style={s.priceSourceText}>{item.source}</Text>
              </View>
            );
          })}
        </View>
        <View style={{ position: 'absolute', left: CHART_X0, top: 0, width: CHART_W, height: totalH }}>
          <Svg width={CHART_W} height={totalH}>
            <Line x1={oursX} y1={0} x2={oursX} y2={totalH} stroke={COBALT} strokeWidth={1.5} strokeDasharray="3,2" />
          </Svg>
          <Text style={[s.chartLabel, { left: Math.min(oursX + 4, CHART_W - 140), top: 0, color: COBALT, fontWeight: 'bold' }]}>
            {`${slide.ours.label}, ${usd0(slide.ours.usd)}/${slide.ours.unit.includes('year') ? 'yr' : slide.ours.unit}`}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', marginTop: 2, marginBottom: 10 }}>
        <View style={{ width: CHART_X0 }} />
        <View style={{ width: CHART_W, flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={s.axisLabel}>$500</Text>
          <Text style={s.axisLabel}>$100,000, log scale</Text>
        </View>
      </View>
      <Text style={s.tableNote}>{slide.footnote}</Text>
    </SlideBody>
  );
}

// ------------------------------------------------------------------ deck

function SlideForKind({ slide }: { slide: DeckSlide }): ReactNode {
  switch (slide.kind) {
    case 'title': return <TitleSlide slide={slide} />;
    case 'bill': return <BillSlide slide={slide} />;
    case 'bar-table': return <BarTableSlide slide={slide} />;
    case 'forecast-chart': return <ForecastChartSlide slide={slide} />;
    case 'before-after': return <BeforeAfterSlide slide={slide} />;
    case 'table': return <TableSlide slide={slide} />;
    case 'stat-grid': return <StatGridSlide slide={slide} />;
    case 'divider': return <DividerSlide slide={slide} />;
    case 'matrix': return <MatrixSlide slide={slide} />;
    case 'price-compare': return <PriceCompareSlide slide={slide} />;
    default: {
      const exhaustive: never = slide;
      throw new Error(`Unhandled deck slide kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function CostDeckPdf({ deck }: { deck: CostDeck }): ReactNode {
  return (
    <Document title="Cost report, The AI Atlas" author="The AI Atlas">
      {deck.slides.map((slide, i) => <SlideForKind key={i} slide={slide} />)}
    </Document>
  );
}

export function renderCostDeckPdf(deck: CostDeck): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<CostDeckPdf deck={deck} />);
}

export function costDeckPdfFilename(deck: CostDeck): string {
  return `cost-report-${deck.generatedOn}.pdf`;
}
