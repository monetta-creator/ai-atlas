import { renderToBuffer, StyleSheet, Svg, Circle, Rect } from '@react-pdf/renderer';
import {
  registerFonts, Html, PdfFooter, Callout, Disclaimer, Document, Page, View, Text, Link,
  COBALT, INK, DIM, LINE, s,
} from './shell';
import { SAVANT_TOC, type SavedSavantIssue } from '../savant/types';
import { interleave, type FigureSection } from '../savant/figures-core';
import { PdfFigure } from './savant-figures';
import { allowlistForSavant } from '../savant/allowlist';
import { enforceCitations } from '../citations';
import { collectCitedSources, breakableUrl, displayUrl } from '../savant/sources-core';
import { dateLabel } from '../format';

// Savant's branded weekly PDF: a full-bleed cobalt cover (the signature, the
// issue number and week, the lead's title as the need-to-know line), a
// contents page whose rows link to the section anchors, then one flowing
// Letter page carrying every TOC section. Every scraped or
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
  cover: { backgroundColor: COBALT, padding: 0, fontFamily: 'Schibsted', color: '#ffffff' },
  coverMast: { position: 'absolute', top: 64, left: 56, right: 56 },
  coverArt: { position: 'absolute', top: 0, left: 0 },
  coverWordmark: { fontFamily: 'Anton', fontSize: 13, letterSpacing: 2.5, color: '#ffffff' },
  signature: { fontFamily: 'Savant', fontSize: 64, color: '#ffffff', marginTop: 2, marginBottom: 4 },
  coverStrap: { fontSize: 10.5, color: 'rgba(255,255,255,0.78)', lineHeight: 1.5, maxWidth: 330 },
  coverIssueBlock: { position: 'absolute', top: 290, left: 56, right: 56 },
  coverIssueKicker: { fontFamily: 'JetBrains', fontSize: 9, letterSpacing: 2, color: 'rgba(255,255,255,0.8)', marginBottom: 8 },
  coverIssueNo: { fontFamily: 'Anton', fontSize: 88, lineHeight: 1.05, color: '#ffffff', letterSpacing: -1, marginBottom: 14 },
  coverWeek: { fontFamily: 'Anton', fontSize: 28, lineHeight: 1.15, color: '#ffffff' },
  coverWindow: { fontFamily: 'JetBrains', fontSize: 8.5, letterSpacing: 1, color: 'rgba(255,255,255,0.75)', marginTop: 8 },
  coverNeedBlock: { position: 'absolute', top: 530, left: 56, right: 56, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.45)', paddingTop: 14 },
  coverNeedKicker: { fontFamily: 'JetBrains', fontSize: 7.5, letterSpacing: 1.5, color: 'rgba(255,255,255,0.75)', marginBottom: 6 },
  coverLeadTitle: { fontFamily: 'Anton', fontSize: 20, lineHeight: 1.18, color: '#ffffff', maxWidth: 440 },
  coverHypo: { fontSize: 10, lineHeight: 1.5, color: 'rgba(255,255,255,0.85)', marginTop: 10, maxWidth: 440 },
  coverBand: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 92, backgroundColor: '#1a3fd1',
    paddingHorizontal: 56, paddingTop: 16, flexDirection: 'row', justifyContent: 'space-between',
  },
  coverBandText: { fontSize: 7.5, lineHeight: 1.55, color: 'rgba(255,255,255,0.78)', width: 330 },
  coverBandMeta: { fontFamily: 'JetBrains', fontSize: 7.5, letterSpacing: 1, color: 'rgba(255,255,255,0.78)', textAlign: 'right', lineHeight: 1.7 },
  tocPage: { paddingTop: 60, paddingHorizontal: 64, paddingBottom: 44, fontFamily: 'Schibsted', color: INK },
  tocHead: { fontFamily: 'Anton', fontSize: 26, marginBottom: 4 },
  tocSub: { fontFamily: 'JetBrains', fontSize: 8, letterSpacing: 1.2, color: DIM, textTransform: 'uppercase', marginBottom: 14 },
  tocRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5.5, borderBottomWidth: 0.5, borderBottomColor: LINE },
  tocN: { width: 34, fontFamily: 'JetBrains', fontSize: 9, color: COBALT, paddingTop: 2 },
  tocTitle: { fontSize: 12, fontWeight: 'bold', color: INK },
  tocDetail: { fontSize: 9, color: DIM, lineHeight: 1.4, marginTop: 1 },
  summaryItem: { flexDirection: 'row', marginBottom: 7 },
  summaryN: { width: 18, fontFamily: 'JetBrains', fontSize: 9, color: COBALT, paddingTop: 1 },
  summaryText: { flex: 1 },
  byline: { fontFamily: 'JetBrains', fontSize: 7.5, letterSpacing: 1, textTransform: 'uppercase', color: FAINT, marginBottom: 4 },
  leadTitle: { fontFamily: 'Anton', fontSize: 17, lineHeight: 1.15, marginBottom: 8 },
  hypoStatement: { fontWeight: 'bold', fontSize: 10 },
  hypoDirection: { fontFamily: 'JetBrains', fontSize: 7.5, letterSpacing: 0.6, textTransform: 'uppercase', marginLeft: 6 },
  hypoRow: { marginBottom: 10, paddingBottom: 8, borderBottomWidth: 0.5, borderBottomColor: LINE },
  sourcesCol: { width: '50%', paddingRight: 14, marginBottom: 7, flexDirection: 'row' },
  sourcesN: { width: 18, fontFamily: 'JetBrains', fontSize: 6.5, color: COBALT, paddingTop: 1 },
  sourcesLabel: { fontSize: 7.5, lineHeight: 1.3, color: INK, textDecoration: 'none' },
  sourcesUrl: { fontSize: 6, lineHeight: 1.3, color: FAINT, marginTop: 1.5, textDecoration: 'none' },
});

const direction = (d: string) => (d === 'strengthened' ? UP : d === 'weakened' ? DOWN : DIM);

const PAGE_W = 612;
const PAGE_H = 792;

function longDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// The cover's abstract field: a dot grid over the right two thirds, three
// concentric arcs anchored off the top-right corner, and one thin diagonal.
// Geometry only, no imagery: the kind of restrained mark an enterprise design
// system ships. Drawn once per render, deterministic.
function CoverArt() {
  const dots: { x: number; y: number }[] = [];
  for (let x = 236; x <= PAGE_W - 20; x += 22) {
    for (let y = 40; y <= 690; y += 22) dots.push({ x, y });
  }
  return (
    <Svg width={PAGE_W} height={PAGE_H} style={p.coverArt}>
      {dots.map((d) => <Circle key={`${d.x}-${d.y}`} cx={d.x} cy={d.y} r={0.9} fill="#ffffff" fillOpacity={0.22} />)}
      <Circle cx={560} cy={120} r={330} fill="none" stroke="#ffffff" strokeOpacity={0.28} strokeWidth={1.2} />
      <Circle cx={560} cy={120} r={250} fill="none" stroke="#ffffff" strokeOpacity={0.22} strokeWidth={1.2} />
      <Circle cx={560} cy={120} r={170} fill="#ffffff" fillOpacity={0.07} stroke="#ffffff" strokeOpacity={0.35} strokeWidth={1.2} />
      <Circle cx={560} cy={120} r={6} fill="#ffffff" fillOpacity={0.9} />
      <Circle cx={30} cy={PAGE_H - 30} r={150} fill="none" stroke="#ffffff" strokeOpacity={0.18} strokeWidth={1} />
      <Circle cx={30} cy={PAGE_H - 30} r={95} fill="none" stroke="#ffffff" strokeOpacity={0.14} strokeWidth={1} />
      <Rect x={56} y={286} width={36} height={4} fill="#ffffff" />
    </Svg>
  );
}

export async function renderSavantPdf(saved: SavedSavantIssue, origin: string): Promise<Buffer> {
  registerFonts();
  const { pack, narrative } = saved;
  const allow = allowlistForSavant(pack);
  const dateLine = `Issue No. ${pack.issueNumber} · Week ending ${dateLabel(pack.weekEnd)}`;

  const gate = (html: string | null) => enforceCitations(html, allow).html;
  const figures = narrative.figures ?? [];
  const sectionOrder: string[] = ['lead', ...narrative.departments.map((d) => d.key)];
  const numbered = [...figures].sort((a, b) => sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section) || a.after - b.after);
  const figureNumber = (id: string) => numbered.findIndex((f) => f.id === id) + 1;
  // A section's html with its figures between the blocks (the web view's Illustrated).
  const illustrated = (html: string | null, section: FigureSection) => {
    const own = figures.filter((f) => f.section === section);
    if (!own.length) return <Html html={gate(html) ?? ''} origin={origin} />;
    return interleave(gate(html), own).map((piece, i) => (
      'figure' in piece
        ? <PdfFigure key={piece.figure.id} figure={piece.figure} index={figureNumber(piece.figure.id)} origin={origin} />
        : <Html key={i} html={piece.html} origin={origin} />
    ));
  };
  // Appendix B lists what the issue actually cites, in reading order (not the
  // whole allow-list); the cover's source count counts the same list.
  const cited = collectCitedSources(narrative, allow.hrefs);
  const sourceCount = cited.length;
  const absolute = (href: string) => (href.startsWith('/') ? `${origin}${href}` : href);
  const deptDetail = new Map(narrative.departments.map((d) => [d.key, d.html] as const));
  const firstSentence = (html: string | null | undefined): string | undefined => {
    if (!html) return undefined;
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return undefined;
    const m = text.match(/^.{20,150}?[.!?](?=\s|$)/);
    if (m) return m[0].trim();
    const cut = text.slice(0, 140);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 60)).trim()}...`;
  };
  const tocDetail: Record<string, string | undefined> = {
    summary: `${narrative.summary.length} points, each linked to its record`,
    lead: narrative.lead.title,
    hypotheses: narrative.hypotheses.fresh
      ? `New this week: ${narrative.hypotheses.fresh.statement}`
      : `${narrative.hypotheses.readings.length} standing hypotheses revisited`,
    'appendix-a': 'The Monday plan, the daily diary, every query the desk ran, and what the editor cut',
    'appendix-b': `${sourceCount} public links, grouped by host`,
    editor: narrative.editor ? `Signed by ${narrative.editor.name}` : undefined,
  };
  for (const [key, html] of deptDetail) if (!(key in tocDetail)) tocDetail[key] = firstSentence(html);

  return renderToBuffer(
    <Document title={`Savant, week ending ${dateLabel(pack.weekEnd)}`} author="The AI Atlas">
      <Page size="LETTER" style={p.cover}>
        <CoverArt />
        <View style={p.coverMast}>
          <Text style={p.coverWordmark}>THE AI ATLAS</Text>
          <Text style={p.signature}>Savant</Text>
          <Text style={p.coverStrap}>An autonomous research agent with an editorial point of view. Produced by The AI Atlas.</Text>
        </View>

        <View style={p.coverIssueBlock}>
          <Text style={p.coverIssueKicker}>ISSUE</Text>
          <Text style={p.coverIssueNo}>{`No. ${pack.issueNumber}`}</Text>
          <Text style={p.coverWeek}>{`Week ending ${longDate(pack.weekEnd)}`}</Text>
          <Text style={p.coverWindow}>{`RESEARCHED ${(dateLabel(pack.windowFrom) ?? '').toUpperCase()} TO ${(dateLabel(pack.windowTo) ?? '').toUpperCase()}`}</Text>
        </View>

        <View style={p.coverNeedBlock}>
          <Text style={p.coverNeedKicker}>THIS WEEK&apos;S LEAD</Text>
          <Text style={p.coverLeadTitle}>{narrative.lead.title}</Text>
          {narrative.hypotheses.fresh && (
            <Text style={p.coverHypo}>{`The question Savant poses this week: ${narrative.hypotheses.fresh.statement}`}</Text>
          )}
        </View>

        <View style={p.coverBand}>
          <Text style={p.coverBandText}>
            Written by Savant ({narrative.models.writer}), reviewed by {narrative.editor?.name ?? 'the editor'} ({narrative.models.editor}),
            no human in the loop. Every figure links to a public record or a stored Atlas record. For access-key holders.
          </Text>
          <View>
            <Text style={p.coverBandMeta}>{`${sourceCount} SOURCES`}</Text>
            <Text style={p.coverBandMeta}>{`${pack.numbers.itemsRead} ITEMS READ`}</Text>
            <Text style={p.coverBandMeta}>{`${SAVANT_TOC.length} SECTIONS`}</Text>
          </View>
        </View>
      </Page>

      <Page size="LETTER" style={p.tocPage}>
        <Text style={p.tocHead}>Contents</Text>
        <Text style={p.tocSub}>{dateLine}</Text>
        {SAVANT_TOC.map((entry, i) => (
          <Link key={entry.key} src={`#${entry.key}`} style={{ textDecoration: 'none', color: INK }}>
            <View style={p.tocRow} wrap={false}>
              <Text style={p.tocN}>{String(i + 1)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={p.tocTitle}>{entry.title}</Text>
                {tocDetail[entry.key] && <Text style={p.tocDetail}>{tocDetail[entry.key]}</Text>}
              </View>
            </View>
          </Link>
        ))}
      </Page>

      <Page size="LETTER" style={p.page}>
        <Text id="summary" style={s.sectionHead}>Executive summary</Text>
        {narrative.summary.map((html, i) => (
          <View key={i} style={p.summaryItem}>
            <Text style={p.summaryN}>{`${i + 1}.`}</Text>
            <View style={p.summaryText}><Html html={gate(html) ?? ''} origin={origin} /></View>
          </View>
        ))}

        <Text id="lead" style={s.sectionHead}>Lead analysis</Text>
        <Text style={p.byline}>By Savant</Text>
        <Text style={p.leadTitle}>{narrative.lead.title}</Text>
        {illustrated(narrative.lead.html, 'lead')}

        <Text id="hypotheses" style={s.sectionHead}>Savant&apos;s hypotheses</Text>
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
            <Text id={d.key} style={s.sectionHead}>{d.title}</Text>
            {illustrated(d.html, d.key)}
          </View>
        ))}

        <Text id="appendix-a" style={s.sectionHead}>Appendix A: how this issue was researched</Text>
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

        <Text id="appendix-b" style={s.sectionHead}>Appendix B: sources</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {cited.map((src, i) => (
            <View key={src.href} style={p.sourcesCol} wrap={false}>
              <Text style={p.sourcesN}>{String(i + 1)}</Text>
              <View style={{ flex: 1 }}>
                <Link src={absolute(src.href)} style={p.sourcesLabel}>{src.label}</Link>
                <Link src={absolute(src.href)} style={p.sourcesUrl}>
                  {breakableUrl(src.host === 'The AI Atlas' ? `The AI Atlas · ${src.href}` : displayUrl(src.href))}
                </Link>
              </View>
            </View>
          ))}
        </View>
        <Text style={s.small}>
          Every link above resolves to a public record or a stored Atlas record. Savant reads no private data.
        </Text>

        {narrative.editor && (
          <View wrap={false} style={{ marginTop: 10 }}>
            <Text id="editor" style={s.sectionHead}>Editor&apos;s note</Text>
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
