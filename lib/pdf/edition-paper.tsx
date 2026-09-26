import { renderToBuffer, StyleSheet } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import {
  registerFonts, Html, PdfFooter, Document, Page, View, Text, Link, COBALT, INK, DIM, LINE,
} from './shell';
import type { PaperModel, PaperBrief, PaperFront, PaperDesk } from '../edition/paper';

// The Daily Edition as a newspaper: one flowing US Letter page (612 x 792pt)
// with narrow margins that react-pdf paginates to two or three pages by
// content. Blocks that must stay whole carry wrap={false} and are each well
// under a third of a page, so the white space at a page end stays small. The
// column is two side-by-side text columns balanced by character count and
// allowed to wrap across pages: react-pdf splits both columns at the same y
// and continues them at the top of the next page (uneven bottoms on the jump
// page are a newspaper look). Every scraped or model-written string is set in
// Schibsted or Anton, never JetBrains Mono (the fontkit ligature crash noted
// in shell.tsx); the mono face carries only the date, the issue number and
// the footer label.

const FAINT = '#95a0b1';
const UP = '#2e7d32';
const DOWN = '#c62828';

const p = StyleSheet.create({
  page: {
    paddingTop: 24, paddingHorizontal: 28, paddingBottom: 34,
    fontFamily: 'Schibsted', fontSize: 8.5, color: INK, lineHeight: 1.35,
  },
  masthead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 4 },
  wordmark: { fontFamily: 'Anton', fontSize: 24, letterSpacing: 1, lineHeight: 1.05 },
  wordSub: { fontSize: 7.5, color: DIM, marginTop: 4, letterSpacing: 1.2, textTransform: 'uppercase' },
  mastRight: { alignItems: 'flex-end' },
  dateline: { fontFamily: 'JetBrains', fontSize: 7.5, color: DIM, letterSpacing: 0.6 },
  online: { fontSize: 7.5, color: COBALT, textDecoration: 'underline', marginTop: 2 },
  ruleHeavy: { borderTopWidth: 2.5, borderTopColor: INK },
  ruleThin: { borderTopWidth: 0.75, borderTopColor: INK, marginTop: 1.5 },

  almanac: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 0.75, borderBottomColor: INK, paddingVertical: 5 },
  statCell: { alignItems: 'center', paddingHorizontal: 7, borderRightWidth: 0.5, borderRightColor: LINE },
  statN: { fontFamily: 'Anton', fontSize: 13, lineHeight: 1 },
  statL: { fontSize: 5.5, letterSpacing: 0.8, color: FAINT, textTransform: 'uppercase', marginTop: 2 },
  marketRow: { flexDirection: 'row', flex: 1, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', paddingLeft: 6 },
  market: { flexDirection: 'row', alignItems: 'baseline', marginLeft: 9 },
  marketLabel: { fontSize: 6.5, fontWeight: 'bold', color: INK },
  marketPrice: { fontSize: 6.5, color: DIM, marginLeft: 3 },
  marketChg: { fontSize: 6.5, marginLeft: 3 },

  lead: { paddingTop: 9, paddingBottom: 8, borderBottomWidth: 0.75, borderBottomColor: INK },
  leadHed: { fontFamily: 'Anton', fontSize: 21, lineHeight: 1.08, marginBottom: 4 },
  leadWhy: { fontSize: 9.5, lineHeight: 1.4 },
  numbersLine: { fontSize: 8, color: DIM, marginTop: 3 },
  coverage: { fontSize: 6.5, color: FAINT, marginTop: 2, letterSpacing: 0.3, textTransform: 'uppercase' },
  goDeeper: { fontSize: 7.5, color: COBALT, textDecoration: 'underline', marginTop: 3 },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cellHalf: { width: '50%', paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: LINE },
  cellFull: { width: '100%', paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: LINE },
  cellLeft: { paddingRight: 9 },
  cellRight: { paddingLeft: 9, borderLeftWidth: 0.5, borderLeftColor: LINE },
  itemHed: { fontFamily: 'Anton', fontSize: 12.5, lineHeight: 1.12, marginBottom: 3 },
  itemWhy: { fontSize: 8.5, lineHeight: 1.35 },

  kicker: { fontSize: 6.5, fontWeight: 'bold', letterSpacing: 1.4, textTransform: 'uppercase', color: COBALT, marginBottom: 3 },
  sectionHead: {
    fontSize: 8, fontWeight: 'bold', letterSpacing: 1.3, textTransform: 'uppercase', color: INK,
    marginTop: 12, marginBottom: 5, borderBottomWidth: 1.5, borderBottomColor: INK, paddingBottom: 2,
  },

  industry: { marginTop: 8, paddingTop: 5, borderTopWidth: 1.5, borderTopColor: INK },
  industryRow: { flexDirection: 'row' },
  industryCell: { flex: 1, paddingRight: 8 },

  columnWrap: { marginTop: 10, paddingTop: 6, borderTopWidth: 2.5, borderTopColor: INK },
  columnTitle: { fontFamily: 'Anton', fontSize: 15, lineHeight: 1.1, marginBottom: 6 },
  columnRow: { flexDirection: 'row', alignItems: 'flex-start' },
  columnHalf: { flex: 1, fontSize: 8.5, lineHeight: 1.38 },
  columnGap: { width: 14 },

  deskRow: { flexDirection: 'row', alignItems: 'flex-start' },
  deskCol: { flex: 1 },
  deskGap: { width: 12 },
  desk: { marginBottom: 7 },
  deskHead: { fontSize: 6.5, fontWeight: 'bold', letterSpacing: 1.2, textTransform: 'uppercase', color: COBALT, paddingBottom: 2, marginBottom: 1, borderBottomWidth: 0.5, borderBottomColor: INK },
  brief: { paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: LINE },
  briefHed: { fontSize: 8, fontWeight: 'bold', lineHeight: 1.3, color: INK },
  briefMeta: { fontSize: 6.3, color: FAINT, marginTop: 1 },

  paper: { width: '50%', paddingVertical: 4 },
  paperTitle: { fontSize: 8.5, fontWeight: 'bold', lineHeight: 1.3, color: INK },
  paperCares: { fontSize: 7.5, color: DIM, lineHeight: 1.35, marginTop: 1 },

  hnRow: { flexDirection: 'row', alignItems: 'baseline', paddingVertical: 1.5 },
  hnTitle: { fontSize: 8, color: INK, flex: 1 },
  hnMeta: { fontSize: 6.3, color: FAINT, marginLeft: 6 },

  sourcesLine: { fontSize: 7.2, color: DIM, lineHeight: 1.5 },
  blind: { fontSize: 8, marginBottom: 2 },
  footerNote: { fontSize: 6.8, color: FAINT, lineHeight: 1.45, marginTop: 10, borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 4 },
});

// ---------------------------------------------------------------- parts

function FrontLead({ item }: { item: PaperFront }): ReactNode {
  return (
    <View wrap={false} style={p.lead}>
      <Text style={p.leadHed}>{item.headline}</Text>
      <Text style={p.leadWhy}>{item.why}</Text>
      {item.numbers && <Text style={p.numbersLine}>{item.numbers}</Text>}
      {item.coverage && <Text style={p.coverage}>{item.coverage}</Text>}
      <Link src={item.href} style={p.goDeeper}>{item.label}</Link>
    </View>
  );
}

function FrontCell({ item, side }: { item: PaperFront; side: 'left' | 'right' | 'full' }): ReactNode {
  const style = side === 'full' ? p.cellFull : side === 'left' ? [p.cellHalf, p.cellLeft] : [p.cellHalf, p.cellRight];
  return (
    <View wrap={false} style={style}>
      <Text style={p.itemHed}>{item.headline}</Text>
      <Text style={p.itemWhy}>{item.why}</Text>
      {item.numbers && <Text style={p.numbersLine}>{item.numbers}</Text>}
      {item.coverage && <Text style={p.coverage}>{item.coverage}</Text>}
      <Link src={item.href} style={p.goDeeper}>{item.label}</Link>
    </View>
  );
}

function BriefRow({ b }: { b: PaperBrief }): ReactNode {
  const meta = [b.domain, b.tier != null ? `T${b.tier}` : null, b.inAtlas ? 'in Atlas' : null].filter(Boolean).join(' · ');
  return (
    <View style={p.brief}>
      <Link src={b.href} style={p.briefHed}>{b.headline}</Link>
      <Text style={p.briefMeta}>{meta}</Text>
    </View>
  );
}

function DeskBlock({ desk }: { desk: PaperDesk }): ReactNode {
  return (
    <View wrap={false} style={p.desk}>
      <Text style={p.deskHead}>{`${desk.label} · ${desk.items.length}`}</Text>
      {desk.items.map((b) => <BriefRow key={b.href + b.headline} b={b} />)}
    </View>
  );
}

function Paper({ m, docTitle }: { m: PaperModel; docTitle: string }): ReactNode {
  return (
    <Document title={docTitle} author="The AI Atlas">
      <Page size="LETTER" style={p.page}>
        <View style={p.masthead}>
          <View>
            <Text style={p.wordmark}>{m.masthead.wordmark}</Text>
            <Text style={p.wordSub}>Daily Edition</Text>
          </View>
          <View style={p.mastRight}>
            <Text style={p.dateline}>{`${m.masthead.dateLabel} · ${m.masthead.issue}`}</Text>
            <Link src={m.masthead.onlineUrl} style={p.online}>Read this edition online</Link>
          </View>
        </View>
        <View style={p.ruleHeavy} />
        <View style={p.ruleThin} />

        <View style={p.almanac}>
          {m.numbers.map((c) => (
            <View key={c.label} style={p.statCell}>
              <Text style={p.statN}>{String(c.n)}</Text>
              <Text style={p.statL}>{c.label}</Text>
            </View>
          ))}
          {m.markets.length > 0 && (
            <View style={p.marketRow}>
              {m.markets.map((mk) => (
                <View key={mk.label} style={p.market}>
                  <Text style={p.marketLabel}>{mk.label}</Text>
                  <Text style={p.marketPrice}>{mk.price}</Text>
                  <Text style={[p.marketChg, { color: mk.dir === 'up' ? UP : mk.dir === 'down' ? DOWN : FAINT }]}>{mk.change}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {m.lead && <FrontLead item={m.lead} />}
        {m.secondary.length > 0 && (
          <View style={p.grid}>
            {/* An odd last item spans the row instead of leaving a hole beside it. */}
            {m.secondary.map((it, i) => (
              <FrontCell
                key={it.href + i}
                item={it}
                side={i === m.secondary.length - 1 && m.secondary.length % 2 === 1 ? 'full' : i % 2 === 0 ? 'left' : 'right'}
              />
            ))}
          </View>
        )}

        {m.industry.length > 0 && (
          <View wrap={false} style={p.industry}>
            <Text style={p.kicker}>The industry · financial services, no AI angle</Text>
            <View style={p.industryRow}>
              {m.industry.map((b) => (
                <View key={b.href} style={p.industryCell}>
                  <Link src={b.href} style={p.briefHed}>{b.headline}</Link>
                  <Text style={p.briefMeta}>{[b.domain, b.tier != null ? `T${b.tier}` : null].filter(Boolean).join(' · ')}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {m.column && (
          <View style={p.columnWrap}>
            <Text style={p.kicker}>The column</Text>
            <Text style={p.columnTitle}>{m.column.title}</Text>
            <View style={p.columnRow}>
              <View style={p.columnHalf}><Html html={m.column.halves[0]} origin="" /></View>
              {m.column.halves[1] && (
                <>
                  <View style={p.columnGap} />
                  <View style={p.columnHalf}><Html html={m.column.halves[1]} origin="" /></View>
                </>
              )}
            </View>
          </View>
        )}

        {m.deskColumns.length > 0 && (
          <View>
            <Text style={p.sectionHead}>{`Things happen · ${m.thingsCount}`}</Text>
            <View style={p.deskRow}>
              {m.deskColumns.map((col, i) => (
                <View key={i} style={[p.deskCol, i > 0 ? { marginLeft: 12 } : {}]}>
                  {col.map((d) => <DeskBlock key={d.label} desk={d} />)}
                </View>
              ))}
            </View>
          </View>
        )}

        {m.research.length > 0 && (
          <View>
            <Text style={p.sectionHead}>{m.researchHead}</Text>
            <View style={p.grid}>
              {m.research.map((r, i) => (
                <View key={r.href} wrap={false} style={[p.paper, i % 2 === 0 ? p.cellLeft : { paddingLeft: 9 }]}>
                  <Link src={r.href} style={p.paperTitle}>{r.title}</Link>
                  {r.whoCares && <Text style={p.paperCares}>{r.whoCares}</Text>}
                </View>
              ))}
            </View>
          </View>
        )}

        {m.hn.length > 0 && (
          <View wrap={false}>
            <Text style={p.sectionHead}>What builders are reading · Hacker News front page</Text>
            {m.hn.map((h) => (
              <View key={h.href} style={p.hnRow}>
                <Link src={h.href} style={p.hnTitle}>{h.title}</Link>
                <Text style={p.hnMeta}>{h.meta}</Text>
              </View>
            ))}
          </View>
        )}

        {m.sourcesLine && (
          <View wrap={false}>
            <Text style={p.sectionHead}>{m.sourcesHead}</Text>
            <Text style={p.sourcesLine}>{m.sourcesLine}</Text>
          </View>
        )}

        {m.blindSpots.length > 0 && (
          <View wrap={false}>
            <Text style={p.sectionHead}>Blind spots · developments the desk knows it missed</Text>
            {m.blindSpots.map((b, i) => (
              b.href
                ? <Link key={i} src={b.href} style={[p.blind, { color: INK }]}>{b.headline}</Link>
                : <Text key={i} style={p.blind}>{b.headline}</Text>
            ))}
          </View>
        )}

        <Text style={p.footerNote}>{m.footer}</Text>
        <PdfFooter label={`THE AI ATLAS · DAILY EDITION · ${m.masthead.dateLabel}`} />
      </Page>
    </Document>
  );
}

export async function renderEditionPaperPdf(m: PaperModel, docTitle: string): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<Paper m={m} docTitle={docTitle} />);
}
