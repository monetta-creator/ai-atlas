import { renderToBuffer, StyleSheet } from '@react-pdf/renderer';
import {
  registerFonts, Html, PdfFooter, Callout, Disclaimer, Document, Page, View, Text, Link,
  COBALT, INK, DIM, LINE, s,
} from './shell';
import type { SavedSavantIssue, PeerMetricCell, PeerRow } from '../savant/types';
import { allowlistForSavant } from '../savant/allowlist';
import { enforceCitations } from '../citations';
import { dateLabel } from '../format';

// Savant's branded weekly PDF: a cover with the script signature, then one
// flowing Letter page carrying every TOC section. Every scraped or
// model-written string renders in Schibsted; only dates, the issue number,
// and the footer label carry JetBrains Mono (the fontkit ligature-crash
// landmine in shell.tsx). The narrative is re-gated at render time with the
// same allowlist the pack was built against, belt and braces.

const FAINT = '#95a0b1';
const UP = '#2e7d32';
const DOWN = '#c62828';

const p = StyleSheet.create({
  page: {
    paddingTop: 40, paddingHorizontal: 44, paddingBottom: 48,
    fontFamily: 'Schibsted', fontSize: 9.5, color: INK, lineHeight: 1.45,
  },
  cover: {
    paddingTop: 96, paddingHorizontal: 56, paddingBottom: 56, fontFamily: 'Schibsted', color: INK,
  },
  coverWordmark: { fontFamily: 'Anton', fontSize: 14, letterSpacing: 2, color: INK },
  signature: { fontFamily: 'Savant', fontSize: 54, color: COBALT, marginTop: 4, marginBottom: 18 },
  coverIssueLine: { fontFamily: 'JetBrains', fontSize: 8.5, color: DIM, marginBottom: 10 },
  coverStrap: { fontSize: 11, color: DIM, lineHeight: 1.5, marginBottom: 22, maxWidth: 400 },
  coverRule: { borderTopWidth: 2, borderTopColor: INK, marginBottom: 18 },
  coverSummaryItem: { flexDirection: 'row', marginBottom: 8 },
  coverSummaryN: { width: 18, fontFamily: 'JetBrains', fontSize: 9, color: COBALT },
  coverSummaryText: { flex: 1, fontSize: 10, lineHeight: 1.5 },
  coverFoot: {
    position: 'absolute', bottom: 48, left: 56, right: 56,
    borderTopWidth: 1, borderTopColor: LINE, paddingTop: 10, fontSize: 8, color: FAINT, lineHeight: 1.6,
  },
  byline: { fontFamily: 'JetBrains', fontSize: 7.5, letterSpacing: 1, textTransform: 'uppercase', color: FAINT, marginBottom: 4 },
  leadTitle: { fontFamily: 'Anton', fontSize: 17, lineHeight: 1.15, marginBottom: 8 },
  hypoStatement: { fontWeight: 'bold', fontSize: 10 },
  hypoDirection: { fontFamily: 'JetBrains', fontSize: 7.5, letterSpacing: 0.6, textTransform: 'uppercase', marginLeft: 6 },
  hypoRow: { marginBottom: 10, paddingBottom: 8, borderBottomWidth: 0.5, borderBottomColor: LINE },
  numbers: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1.5, borderTopColor: INK, borderBottomWidth: 0.75, borderBottomColor: FAINT, marginBottom: 12 },
  numCell: { width: '25%', alignItems: 'center', paddingVertical: 6, borderLeftWidth: 0.5, borderLeftColor: LINE },
  numN: { fontFamily: 'Anton', fontSize: 14 },
  numL: { fontFamily: 'JetBrains', fontSize: 6, letterSpacing: 0.8, color: FAINT, textTransform: 'uppercase', marginTop: 2 },
  tierHead: { fontFamily: 'JetBrains', fontSize: 7.5, letterSpacing: 1, textTransform: 'uppercase', color: COBALT, marginTop: 8, marginBottom: 3 },
  peerCell: { fontSize: 7.5 },
  sourcesCol: { width: '50%', paddingRight: 10, marginBottom: 3 },
  sourcesHost: { fontSize: 7, fontWeight: 'bold', color: DIM, marginBottom: 1 },
});

const direction = (d: string) => (d === 'strengthened' ? UP : d === 'weakened' ? DOWN : DIM);

function fmtMetric(cell: PeerMetricCell | undefined): string {
  if (!cell || cell.latest == null) return '–';
  switch (cell.unit) {
    case 'usd_thousands': return `$${((cell.latest * 1000) / 1e9).toFixed(1)}B`;
    case 'usd': return `$${(cell.latest / 1e9).toFixed(1)}B`;
    case 'percent': return `${cell.latest.toFixed(2)}%`;
    case 'per_share': return `$${cell.latest.toFixed(2)}`;
    case 'count': return String(Math.round(cell.latest));
    default: return String(cell.latest);
  }
}

function metricFor(row: PeerRow, code: string): PeerMetricCell | undefined {
  return row.metrics.find((m) => m.code === code);
}

export async function renderSavantPdf(saved: SavedSavantIssue, origin: string): Promise<Buffer> {
  registerFonts();
  const { pack, narrative } = saved;
  const allow = allowlistForSavant(pack);
  const dateLine = `Issue No. ${pack.issueNumber} · Week ending ${dateLabel(pack.weekEnd)}`;
  const codes = pack.peers.codes.slice(0, 7);

  const gate = (html: string | null) => enforceCitations(html, allow).html;

  return renderToBuffer(
    <Document title={`Savant, week ending ${dateLabel(pack.weekEnd)}`} author="The AI Atlas">
      <Page size="LETTER" style={p.cover}>
        <Text style={p.coverWordmark}>THE AI ATLAS</Text>
        <Text style={p.signature}>Savant</Text>
        <Text style={p.coverIssueLine}>{dateLine}</Text>
        <View style={p.coverRule} />
        <Text style={p.coverStrap}>
          An autonomous research agent with an editorial point of view. Produced by The AI Atlas.
        </Text>
        {narrative.summary.slice(0, 5).map((html, i) => (
          <View key={i} style={p.coverSummaryItem}>
            <Text style={p.coverSummaryN}>{`${i + 1}.`}</Text>
            <View style={p.coverSummaryText}><Html html={gate(html) ?? ''} origin={origin} /></View>
          </View>
        ))}
        <View style={p.coverFoot}>
          <Text>
            Issue No. {pack.issueNumber} researched {dateLabel(pack.windowFrom)} to {dateLabel(pack.windowTo)}, written by
            Savant ({narrative.models.writer}), reviewed by {narrative.editor?.name ?? 'the editor'} ({narrative.models.editor}).
            Produced by The AI Atlas.
          </Text>
        </View>
      </Page>

      <Page size="LETTER" style={p.page}>
        <Text style={s.sectionHead}>Lead analysis</Text>
        <Text style={p.byline}>By Savant</Text>
        <Text style={p.leadTitle}>{narrative.lead.title}</Text>
        <Html html={gate(narrative.lead.html) ?? ''} origin={origin} />

        <Text style={s.sectionHead}>Savant&apos;s hypotheses</Text>
        {narrative.hypotheses.fresh && (
          <Callout>
            <Text style={p.hypoStatement}>{narrative.hypotheses.fresh.statement}</Text>
            <Html html={gate(narrative.hypotheses.fresh.html) ?? ''} origin={origin} />
          </Callout>
        )}
        {narrative.hypotheses.readings.map((r) => (
          <View key={r.id} style={p.hypoRow} wrap={false}>
            <Text>
              <Text style={p.hypoStatement}>{r.statement}</Text>
              <Text style={[p.hypoDirection, { color: direction(r.direction) }]}>{`  ${r.direction.toUpperCase()}`}</Text>
            </Text>
            <Html html={gate(r.html) ?? ''} origin={origin} />
            {r.verdict && <Text style={s.small}>{`Verdict: ${r.verdict}`}</Text>}
          </View>
        ))}

        {narrative.departments.map((d) => (
          <View key={d.key}>
            <Text style={s.sectionHead}>{d.title}</Text>
            <Html html={gate(d.html) ?? ''} origin={origin} />
          </View>
        ))}

        <Text style={s.sectionHead}>Appendix A: how this issue was researched</Text>
        {pack.plan && (
          <View wrap={false} style={{ marginBottom: 8 }}>
            <Text style={[s.small, s.bold]}>{pack.plan.topic}</Text>
            <Text style={s.small}>{pack.plan.why}</Text>
            <Text style={s.small}>{`Hypothesis: ${pack.plan.hypothesis.statement}`}</Text>
          </View>
        )}
        {pack.notebook.notes.map((n) => (
          <View key={n.day} style={s.row} wrap={false}>
            <Text style={[s.small, { width: 70 }]}>{dateLabel(n.day) ?? n.day}</Text>
            <Text style={[s.small, { flex: 1 }]}>{n.text}</Text>
          </View>
        ))}
        {narrative.research.queries.length > 0 && (
          <View>
            <View style={s.rowHead}>
              <Text style={[s.cellHead, { width: 30 }]}>Rd</Text>
              <Text style={[s.cellHead, { width: 60 }]}>Tool</Text>
              <Text style={[s.cellHead, { flex: 1 }]}>Query</Text>
              <Text style={[s.cellHead, { width: 40 }]}>Hits</Text>
            </View>
            {narrative.research.queries.map((q, i) => (
              <View key={i} style={s.row} wrap={false}>
                <Text style={[s.small, { width: 30 }]}>{q.round}</Text>
                <Text style={[s.small, { width: 60 }]}>{q.tool}</Text>
                <Text style={[s.small, { flex: 1 }]}>{q.query}</Text>
                <Text style={[s.small, { width: 40 }]}>{q.results}</Text>
              </View>
            ))}
          </View>
        )}
        {narrative.dropped.length > 0 && (
          <View style={{ marginTop: 6 }}>
            <Text style={[s.small, s.bold]}>Removed by the citation gate</Text>
            {narrative.dropped.map((d, i) => <Text key={i} style={s.small}>{`• ${d}`}</Text>)}
          </View>
        )}

        <Text style={s.sectionHead}>Appendix B: numbers</Text>
        <View style={p.numbers}>
          {[
            { n: pack.numbers.itemsRead, l: 'Items' },
            { n: pack.numbers.outlets, l: 'Outlets' },
            { n: pack.numbers.signals, l: 'Signals' },
            { n: pack.numbers.papers, l: 'Papers' },
            { n: pack.numbers.evidence, l: 'Evidence' },
            { n: pack.numbers.connections, l: 'Connections' },
            { n: pack.numbers.anomalies, l: 'Anomalies' },
            { n: pack.numbers.companies, l: 'Companies' },
          ].map((c) => (
            <View key={c.l} style={p.numCell}>
              <Text style={p.numN}>{String(c.n)}</Text>
              <Text style={p.numL}>{c.l}</Text>
            </View>
          ))}
        </View>
        {pack.peers.tiers.map((tier) => (
          tier.rows.length > 0 && (
            <View key={tier.tier} wrap={false}>
              <Text style={p.tierHead}>{tier.label}</Text>
              <View style={s.rowHead}>
                <Text style={[s.cellHead, { flex: 1.2 }]}>Company</Text>
                {codes.map((c) => <Text key={c.code} style={[s.cellHead, { flex: 0.8 }]}>{c.label}</Text>)}
              </View>
              {tier.rows.map((row) => (
                <View key={row.slug} style={s.row}>
                  <Text style={[p.peerCell, { flex: 1.2 }, row.isSelf ? s.bold : undefined]}>{row.name}</Text>
                  {codes.map((c) => (
                    <Text key={c.code} style={[p.peerCell, { flex: 0.8 }]}>{fmtMetric(metricFor(row, c.code))}</Text>
                  ))}
                </View>
              ))}
            </View>
          )
        ))}

        <Text style={s.sectionHead}>Appendix C: sources</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {[...allow.hrefs].filter((h) => /^https?:\/\//.test(h)).slice(0, 60).map((href) => (
            <View key={href} style={p.sourcesCol}>
              <Link src={href} style={[s.small, { color: COBALT }]}>{href}</Link>
            </View>
          ))}
        </View>
        <Text style={s.small}>
          Every link above resolves to a public record or a stored Atlas record. Savant reads no private data.
        </Text>

        {narrative.editor && (
          <View wrap={false} style={{ marginTop: 10 }}>
            <Text style={s.sectionHead}>Editor&apos;s note</Text>
            <Text style={s.note}>{narrative.editor.note}</Text>
            <Text style={s.small}>{`Signed, ${narrative.editor.name}`}</Text>
          </View>
        )}

        <Disclaimer generatedAt={saved.generated_at} />
        <PdfFooter label={`SAVANT · WEEK ENDING ${dateLabel(pack.weekEnd)} · THE AI ATLAS`} />
      </Page>
    </Document>
  );
}

export function savantPdfFilename(week: string): string {
  return `savant-${week}.pdf`;
}
