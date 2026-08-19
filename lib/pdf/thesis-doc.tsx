import { renderToBuffer } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import type { SavedThesisReport, ThesisNarrative } from '@/lib/types';
import { SIGNIFICANCE_LABEL } from '@/lib/format';
import {
  registerFonts, s, COBALT, DIM, DIRECTION_COLOR,
  Document, Page, Text, View, Link,
  PdfCover, PdfFooter, SectionHead, StatBand, Callout, Disclaimer, Html,
} from './shell';

// The thesis-report PDF: the saved pack + citation-gated narrative in the same
// branded shell as the tear sheets. The caller re-gates the narrative before
// rendering (same belt-and-braces as the read view).

const clip = (t: string | null | undefined, n: number): string => {
  const v = (t ?? '').trim().replace(/\s+/g, ' ');
  return v.length > n ? `${v.slice(0, n)} ...` : v;
};

const DISPLAY_SIGNALS = 24;

const STANCE_COLOR: Record<string, string | undefined> = {
  supports: DIRECTION_COLOR.supports,
  contradicts: DIRECTION_COLOR.contradicts,
  mixed: '#b26a00',
};

function ThesisPdf({ report, narrative, origin }: {
  report: SavedThesisReport;
  narrative: ThesisNarrative;
  origin: string;
}): ReactNode {
  const pack = report.pack;
  const st = pack.stats;
  const footerLabel = `${report.title} · The AI Atlas · ${report.generated_at.slice(0, 10)}`;
  return (
    <Document title={report.title} author="The AI Atlas">
      <PdfCover
        kindLabel="Thesis report"
        title={report.title}
        subject={report.statement}
        metaLines={[
          `Generated ${report.generated_at.slice(0, 10)}`,
          `Report ${report.id}`,
        ]}
      />
      <Page size="A4" style={s.page}>
        <StatBand cells={[
          { n: st.matched, label: 'Signals matched' },
          { n: st.stances.supports, label: 'Supporting', tone: DIRECTION_COLOR.supports },
          { n: st.stances.contradicts, label: 'Contradicting', tone: DIRECTION_COLOR.contradicts },
          { n: st.stances.mixed, label: 'Mixed' },
          { n: st.significance.high, label: 'High signif.' },
        ]} />
        <Text style={s.note}>{st.corpusNote}</Text>

        <View style={s.panel} wrap={false}>
          <Text style={s.panelKicker}>The thesis</Text>
          <Text style={s.panelBody}>{report.statement}</Text>
        </View>

        {pack.claims.length > 0 && (
          <View>
            <SectionHead>Mapped claims</SectionHead>
            {pack.claims.map((c) => (
              <View key={c.code} style={s.li} wrap={false}>
                <Text style={s.bullet}>•</Text>
                <Text style={s.liText}>
                  <Link src={`${origin}${c.href}`} style={s.link}>{c.code}</Link>: {clip(c.statement, 160)}{' '}
                  ({c.signal_count} signal{c.signal_count === 1 ? '' : 's'})
                </Text>
              </View>
            ))}
          </View>
        )}

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
                <Text style={[s.mono, { width: 68, textAlign: 'right', color: STANCE_COLOR[sig.stance] ?? DIM }]}>
                  {sig.stance}
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

export function renderThesisPdf(
  report: SavedThesisReport, narrative: ThesisNarrative, origin: string
): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<ThesisPdf report={report} narrative={narrative} origin={origin} />);
}

export function thesisPdfFilename(report: SavedThesisReport): string {
  return `ai-atlas-thesis-${report.generated_at.slice(0, 10)}-${report.id.slice(0, 8)}.pdf`;
}
