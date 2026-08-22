import { renderToBuffer } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import type { SavedHypothesisReport, HypothesisNarrative } from '@/lib/types';
import { SIGNIFICANCE_LABEL } from '@/lib/format';
import {
  registerFonts, s, COBALT, DIM, DIRECTION_COLOR,
  Document, Page, Text, View, Link,
  PdfCover, PdfFooter, SectionHead, StatBand, Callout, Disclaimer, Html,
} from './shell';

// The hypothesis-report PDF: the saved pack + citation-gated narrative in the
// branded shell. The caller re-gates the narrative before rendering (same
// belt-and-braces as the read view).

const clip = (t: string | null | undefined, n: number): string => {
  const v = (t ?? '').trim().replace(/\s+/g, ' ');
  return v.length > n ? `${v.slice(0, n)} ...` : v;
};

const DISPLAY_SIGNALS = 24;

const DIR_COLOR: Record<string, string | undefined> = {
  supports: DIRECTION_COLOR.supports,
  contradicts: DIRECTION_COLOR.contradicts,
  neutral: '#b26a00',
};

function HypothesisPdf({ report, narrative, origin }: {
  report: SavedHypothesisReport;
  narrative: HypothesisNarrative;
  origin: string;
}): ReactNode {
  const pack = report.pack;
  const st = pack.stats;
  const footerLabel = `${report.title} · The Strategy Atlas · ${report.generated_at.slice(0, 10)}`;
  return (
    <Document title={report.title} author="The Strategy Atlas">
      <PdfCover
        kindLabel="Hypothesis report"
        title={report.title}
        subject={report.statement}
        metaLines={[
          `Hypothesis ${pack.code}`,
          `Generated ${report.generated_at.slice(0, 10)}`,
          `Report ${report.id}`,
        ]}
      />
      <Page size="A4" style={s.page}>
        <StatBand cells={[
          { n: st.matched, label: 'Signals matched' },
          { n: st.directions.supports, label: 'Supporting', tone: DIRECTION_COLOR.supports },
          { n: st.directions.contradicts, label: 'Contradicting', tone: DIRECTION_COLOR.contradicts },
          { n: st.directions.neutral, label: 'Neutral' },
          { n: st.significance.high, label: 'High signif.' },
        ]} />
        <Text style={s.note}>{st.corpusNote}</Text>

        <View style={s.panel} wrap={false}>
          <Text style={s.panelKicker}>The hypothesis</Text>
          <Text style={s.panelBody}>{report.statement}</Text>
        </View>

        {pack.test ? (
          <View style={s.panel} wrap={false}>
            <Text style={s.panelKicker}>Falsified if</Text>
            <Text style={s.panelBody}>{clip(pack.test, 400)}</Text>
          </View>
        ) : null}

        {narrative.reading && (
          <View>
            <SectionHead>What the signals show</SectionHead>
            <Html html={narrative.reading} origin={origin} />
          </View>
        )}
        {narrative.counterweight && (
          <View>
            <SectionHead>The other read and what is missing</SectionHead>
            <Html html={narrative.counterweight} origin={origin} />
          </View>
        )}
        {narrative.bottomLine && (
          <Callout>
            <Html html={narrative.bottomLine} origin={origin} />
          </Callout>
        )}

        {pack.signals.length > 0 && (
          <View>
            <SectionHead>Matched signals</SectionHead>
            {pack.signals.slice(0, DISPLAY_SIGNALS).map((sig) => (
              <View key={sig.id} style={s.row} wrap={false}>
                <Text style={[s.mono, { width: 62 }]}>{sig.published_at ?? 'undated'}</Text>
                <Link src={`${origin}/signals/${sig.id}`} style={[s.mono, { width: 30, color: COBALT }]}>{sig.tag}</Link>
                <View style={{ flex: 1, paddingRight: 6 }}>
                  <Text style={s.small}>{clip(sig.title, 110)}</Text>
                  <Text style={[s.mono, { fontSize: 6.5, color: DIM }]}>
                    {[SIGNIFICANCE_LABEL[sig.significance], sig.source_domain].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={[s.mono, { width: 68, textAlign: 'right', color: (sig.direction && DIR_COLOR[sig.direction]) || DIM }]}>
                  {sig.direction ?? 'untyped'}
                </Text>
              </View>
            ))}
            {pack.signals.length > DISPLAY_SIGNALS && (
              <Text style={[s.note, { marginTop: 4 }]}>
                And {pack.signals.length - DISPLAY_SIGNALS} more signals in the Atlas record.
              </Text>
            )}
          </View>
        )}

        <Disclaimer generatedAt={report.generated_at} />
        <PdfFooter label={footerLabel} />
      </Page>
    </Document>
  );
}

export function renderHypothesisPdf(
  report: SavedHypothesisReport, narrative: HypothesisNarrative, origin: string
): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<HypothesisPdf report={report} narrative={narrative} origin={origin} />);
}

export function hypothesisPdfFilename(report: SavedHypothesisReport): string {
  return `strategy-atlas-${report.pack.code.toLowerCase()}-${report.generated_at.slice(0, 10)}-${report.id.slice(0, 8)}.pdf`;
}
