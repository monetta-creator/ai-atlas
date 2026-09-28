import { renderToBuffer, StyleSheet, Svg, Path } from '@react-pdf/renderer';
import {
  registerFonts, Html, PdfFooter, Document, Page, View, Text, Link,
  INK, DIM, LINE, s,
} from './shell';
import type { SavedFieldReport } from '../data/field-reports';
import { allowlistForFieldReport } from '../field-report/allowlist';
import { contourLines } from '../field-report/contour';
import { researchDigest, sourceTitles } from '../field-report/core';
import { enforceCitations } from '../citations';
import { collectCitedSources, breakableUrl, displayUrl } from '../savant/sources-core';
import { dateLabel } from '../format';
import { PdfFigure } from './savant-figures';
import type { SavantFigure } from '../savant/figures-core';

// Field Report's own PDF: a paper-white cover carrying the same deterministic
// contour motif as the web view (drawn here with react-pdf Svg paths instead
// of inline SVG, from the exact same lib/field-report/contour.ts generator),
// a contents page linking the plan's sub-questions to their section anchors,
// then one flowing Letter page: summary, sections (each block gated again
// and labeled with its provenance), the editor's note, and two appendices.
// Distinct from Savant's cobalt cover on purpose (Field Report is its own
// imprint); the structure (cover -> contents -> one flowing page ->
// Appendix B) follows lib/pdf/savant-doc.tsx.

const ACCENT = '#1f6f4a';
const FAINT = '#95a0b1';

const p = StyleSheet.create({
  cover: { padding: 0, fontFamily: 'Schibsted', color: INK, backgroundColor: '#ffffff' },
  coverArt: { position: 'absolute', top: 0, left: 0 },
  coverMast: { position: 'absolute', top: 56, left: 56, right: 56 },
  coverWordmark: { fontFamily: 'Anton', fontSize: 13, letterSpacing: 2.5, color: INK },
  coverProduct: { fontFamily: 'Anton', fontSize: 30, color: ACCENT, marginTop: 10 },
  coverKicker: { fontFamily: 'JetBrains', fontSize: 8.5, letterSpacing: 2, color: ACCENT, marginTop: 30, marginBottom: 10 },
  coverQuestion: { fontFamily: 'Anton', fontSize: 30, lineHeight: 1.1, color: INK, maxWidth: 440 },
  coverObjective: { fontSize: 11.5, lineHeight: 1.55, color: DIM, marginTop: 16, maxWidth: 420 },
  coverMetaBlock: { position: 'absolute', bottom: 56, left: 56, right: 56, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 12 },
  coverMeta: { fontFamily: 'JetBrains', fontSize: 8.5, color: FAINT, lineHeight: 1.8 },
  tocPage: { paddingTop: 60, paddingHorizontal: 64, paddingBottom: 44, fontFamily: 'Schibsted', color: INK },
  tocHead: { fontFamily: 'Anton', fontSize: 24, marginBottom: 4 },
  tocSub: { fontFamily: 'JetBrains', fontSize: 8, letterSpacing: 1.2, color: DIM, textTransform: 'uppercase', marginBottom: 14 },
  tocRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: LINE },
  tocN: { width: 26, fontFamily: 'JetBrains', fontSize: 9, color: ACCENT, paddingTop: 2 },
  tocTitle: { fontSize: 11.5, fontWeight: 'bold', color: INK },
  page: { paddingTop: 46, paddingHorizontal: 46, paddingBottom: 62, fontFamily: 'Schibsted', fontSize: 9.5, color: INK, lineHeight: 1.5 },
  summaryItem: { flexDirection: 'row', marginBottom: 7 },
  summaryText: { flex: 1 },
  blockRow: { flexDirection: 'row', marginBottom: 8 },
  blockBody: { flex: 1 },
  analysisBlock: { backgroundColor: '#f4f4f2', borderLeftWidth: 2, borderLeftColor: FAINT, paddingLeft: 8, paddingVertical: 3 },
  // One full chip style per provenance (react-pdf's Style typing does not
  // play well with an array of partial style objects), reused for both the
  // summary rows and the section blocks.
  provChip: { width: 42, fontFamily: 'JetBrains', fontSize: 6.5, letterSpacing: 0.5, textTransform: 'uppercase', color: FAINT, paddingTop: 1.5 },
  provChipAtlas: { width: 42, fontFamily: 'JetBrains', fontSize: 6.5, letterSpacing: 0.5, textTransform: 'uppercase', color: ACCENT, paddingTop: 1.5 },
  provChipWeb: { width: 42, fontFamily: 'JetBrains', fontSize: 6.5, letterSpacing: 0.5, textTransform: 'uppercase', color: '#2d5bff', paddingTop: 1.5 },
  provChipMixed: { width: 42, fontFamily: 'JetBrains', fontSize: 6.5, letterSpacing: 0.5, textTransform: 'uppercase', color: '#b8860b', paddingTop: 1.5 },
  sourcesCol: { width: '50%', paddingRight: 14, marginBottom: 6, flexDirection: 'row' },
  sourcesN: { width: 16, fontFamily: 'JetBrains', fontSize: 6.5, color: ACCENT, paddingTop: 1 },
  sourcesLabel: { fontSize: 7.5, lineHeight: 1.3, color: INK, textDecoration: 'none' },
  sourcesUrl: { fontSize: 6, lineHeight: 1.3, color: FAINT, marginTop: 1.5, textDecoration: 'none' },
});

const PROV_LABEL: Record<string, string> = { atlas: 'ATLAS', web: 'WEB', mixed: 'MIXED', analysis: 'ANALYSIS' };
function provChipStyle(prov: string) {
  if (prov === 'atlas') return p.provChipAtlas;
  if (prov === 'web') return p.provChipWeb;
  if (prov === 'mixed') return p.provChipMixed;
  return p.provChip;
}

const PAGE_W = 612;
const PAGE_H = 792;

function CoverArt({ id }: { id: string }) {
  const lines = contourLines(id, { cx: 520, cy: 200, maxR: 260 });
  return (
    <Svg width={PAGE_W} height={PAGE_H} style={p.coverArt}>
      {lines.map((line) => (
        <Path key={line.ring} d={line.d} stroke={ACCENT} strokeOpacity={0.14 + line.ring * 0.05} strokeWidth={1.2} fill="none" />
      ))}
    </Svg>
  );
}

const GREEK: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', θ: 'theta', λ: 'lambda', μ: 'mu', π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', φ: 'phi', ω: 'omega',
};

export async function renderFieldReportPdf(saved: SavedFieldReport, origin: string): Promise<Buffer> {
  registerFonts();
  const { pack, narrative } = saved;
  const allow = allowlistForFieldReport(pack);
  // The bundled fonts carry no Greek; spell out the letters benchmarks use.
  const glyphs = (t: string) => t.replace(/[α-ωΑ-Ω]/g, (c) => GREEK[c] ?? c);
  const gate = (html: string | null) => { const h = enforceCitations(html, allow).html; return h == null ? h : glyphs(h); };
  const dateStr = dateLabel(pack.generatedAt.slice(0, 10)) ?? pack.generatedAt.slice(0, 10);

  const contentsN = Math.min(pack.plan.sub_questions.length, narrative.sections.length);
  const contents = Array.from({ length: contentsN }, (_, i) => ({
    label: pack.plan.sub_questions[i],
    key: narrative.sections[i].key,
  }));

  const titles = sourceTitles(pack.records, pack.web);
  const cited = collectCitedSources(narrative, allow.hrefs).map((src) =>
    ({ ...src, label: glyphs(titles.get(src.href) ?? src.label) })
  );
  const digest = researchDigest(pack.research.log, pack.plan.sub_questions, 6);
  // Figures follow the block their `after` names, numbered in reading order.
  const figures = (narrative.figures ?? []) as SavantFigure[];
  const sectionOrder = narrative.sections.map((x) => x.key);
  const ordered = [...figures].sort((a, b) => sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section) || a.after - b.after);
  const figureNumber = (id: string) => ordered.findIndex((f) => f.id === id) + 1;
  const figuresAt = (key: string, i: number, n: number) =>
    figures.filter((f) => f.section === key && (f.after < 0 || f.after >= n ? n - 1 : f.after) === i);
  const absolute = (href: string) => (href.startsWith('/') ? `${origin}${href}` : href);

  return renderToBuffer(
    <Document title={`Field Report: ${pack.question}`} author="The AI Atlas">
      <Page size="LETTER" style={p.cover}>
        <CoverArt id={saved.id} />
        <View style={p.coverMast}>
          <Text style={p.coverWordmark}>THE AI ATLAS</Text>
          <Text style={p.coverProduct}>Field Report</Text>
          <Text style={p.coverKicker}>{`FIELD REPORT · ${pack.size.toUpperCase()} · ${dateStr}`}</Text>
          <Text style={p.coverQuestion}>{glyphs(pack.question)}</Text>
          <Text style={p.coverObjective}>{pack.plan.objective}</Text>
        </View>
        <View style={p.coverMetaBlock}>
          <Text style={p.coverMeta}>{`Researched by ${pack.models.research} · written by ${pack.models.writer}`}</Text>
          <Text style={p.coverMeta}>
            {narrative.editor ? `Reviewed by ${narrative.editor.name} (${pack.models.editor})` : 'A Brief run, no editor review'}
          </Text>
          <Text style={p.coverMeta}>Every citation resolves to an Atlas record or a public web source.</Text>
        </View>
      </Page>

      <Page size="LETTER" style={p.tocPage}>
        <Text style={p.tocHead}>Contents</Text>
        <Text style={p.tocSub}>{`FIELD REPORT · ${dateStr}`}</Text>
        {contents.map((c, i) => (
          <Link key={c.key} src={`#${c.key}`} style={{ textDecoration: 'none', color: INK }}>
            <View style={p.tocRow} wrap={false}>
              <Text style={p.tocN}>{String(i + 1)}</Text>
              <Text style={p.tocTitle}>{glyphs(c.label)}</Text>
            </View>
          </Link>
        ))}
      </Page>

      <Page size="LETTER" style={p.page}>
        <Text id="summary" style={s.sectionHead}>Summary</Text>
        {narrative.summary.map((b, i) => (
          <View key={i} style={p.summaryItem} wrap={false}>
            <Text style={provChipStyle(b.prov)}>{PROV_LABEL[b.prov]}</Text>
            <View style={p.summaryText}><Html html={gate(b.html) ?? ''} origin={origin} /></View>
          </View>
        ))}

        {/* Flat on purpose: each unbreakable group is a direct child of the page.
            Nested wrappers let react-pdf draw a moved group over the figure after it. */}
        {narrative.sections.flatMap((sec) => sec.blocks.flatMap((b, i) => [
          // The heading rides with the first block so it never ends a page alone.
          <View key={`${sec.key}-${i}`} wrap={false}>
            {i === 0 && <Text id={sec.key} style={s.sectionHead}>{glyphs(sec.title)}</Text>}
            <View style={b.prov === 'analysis' ? [p.blockRow, p.analysisBlock] : p.blockRow}>
              <Text style={provChipStyle(b.prov)}>{PROV_LABEL[b.prov]}</Text>
              <View style={p.blockBody}><Html html={gate(b.html) ?? ''} origin={origin} /></View>
            </View>
          </View>,
          ...figuresAt(sec.key, i, sec.blocks.length).map((f) => (
            <PdfFigure key={f.id} figure={f} index={figureNumber(f.id)} origin={origin} />
          )),
        ]))}

        {narrative.editor && (
          <View wrap={false} style={{ marginTop: 10 }}>
            <Text id="editor" style={s.sectionHead}>Editor&apos;s note</Text>
            <Text style={s.note}>{narrative.editor.note}</Text>
            <Text style={s.small}>{`Signed, ${narrative.editor.name}`}</Text>
          </View>
        )}

        <Text id="appendix-a" style={s.sectionHead}>Appendix A: how this report was researched</Text>
        <Text style={s.small}>
          {`${pack.research.rounds} research round${pack.research.rounds === 1 ? '' : 's'} · ${pack.research.webSearches} web search${pack.research.webSearches === 1 ? '' : 'es'}`}
        </Text>
        {digest.map((d) => (
          <View key={d.label} style={{ marginTop: 6 }} wrap={false}>
            <Text style={[s.small, s.bold]}>{glyphs(d.label)}</Text>
            <Text style={s.small}>
              {`${d.searches} search${d.searches === 1 ? '' : 'es'}${d.reads ? ` · ${d.reads} record${d.reads === 1 ? '' : 's'} read` : ''}${d.queries.length ? `: ${glyphs(d.queries.join(' · '))}` : ''}`}
            </Text>
          </View>
        ))}
        {pack.research.dropped.length > 0 && (
          <View style={{ marginTop: 6 }}>
            <Text style={[s.small, s.bold]}>Removed by the citation gate</Text>
            {pack.research.dropped.map((d, i) => <Text key={i} style={s.small}>{`• ${d}`}</Text>)}
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

        <View wrap={false} style={{ marginTop: 22, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8 }}>
          <Text style={s.disclaimer}>
            {`Method: an AI research agent (${pack.models.research}) read the AI Atlas's own records first, then searched the web for what they did not hold; a writer model (${pack.models.writer}) drafted the report from those notes. Every paragraph is labeled by where it came from: Atlas records, web sources, both, or the Atlas's own analysis, which covers any paragraph without a citation. A citation gate removed any link the research did not turn up. Generated ${saved.generated_at.slice(0, 10)}.`}
          </Text>
          <Text style={s.disclaimer}>
            The AI Atlas is an orientation tool, not a research product. Nothing here is investment, legal, or professional advice.
          </Text>
        </View>
        <PdfFooter label={`FIELD REPORT · ${dateStr} · THE AI ATLAS`} />
      </Page>
    </Document>
  );
}

export function fieldReportPdfFilename(id: string): string {
  return `field-report-${id.slice(0, 8)}.pdf`;
}
