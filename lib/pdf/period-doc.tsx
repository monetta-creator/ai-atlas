import { renderToBuffer } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import type { Report, SignalContext } from '@/lib/types';
import { SIGNAL_CONTEXT_LABEL, SIGNIFICANCE_LABEL, formatDateRange } from '@/lib/format';
import {
  registerFonts, s, COBALT, DIM, INK,
  Document, Page, View, Text, Link,
  PdfCover, PdfFooter, SectionHead, StatBand, Callout, Disclaimer, Html,
} from './shell';

// The period-report PDF: cover, at-a-glance stat band, the per-context callout grid,
// Period summary / Hypotheses recap / per-context narrative sections, then the
// touched-hypotheses and signal-record appendices. Renders the SAVED, sanitized Report
// object (the same shape the /reports/[id] read view renders); the route re-sanitizes
// before calling in.

interface SavedPeriodReport {
  id: string;
  title: string;
  report: Report;
}

// The section titles duplicate a leading heading the model sometimes writes into the
// narrative HTML; strip it so the head isn't doubled (mirrors ReportReadView/ReportPrint).
const stripLeadingHeading = (html: string) =>
  html.replace(/^\s*<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>\s*/i, '');

const clip = (t: string, n: number): string => {
  const v = t.trim().replace(/\s+/g, ' ');
  return v.length > n ? `${v.slice(0, n)} ...` : v;
};

const DISPLAY_TOUCHES = 30;
const DISPLAY_SIGNALS = 30;

function CalloutGrid({ report }: { report: Report }): ReactNode {
  const contexts = report.contexts.filter((c) => (report.narrative.callouts[c] ?? '').trim());
  if (!contexts.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, marginBottom: 6 }}>
      {contexts.map((c) => (
        <View key={c} wrap={false} style={{ width: '50%', paddingRight: 10, marginBottom: 8 }}>
          <View style={{ borderLeftWidth: 3, borderLeftColor: COBALT, paddingLeft: 8, paddingVertical: 2 }}>
            <Text style={{ fontFamily: 'JetBrains', fontSize: 6.5, letterSpacing: 1.5, color: COBALT, textTransform: 'uppercase', marginBottom: 2 }}>
              {SIGNAL_CONTEXT_LABEL[c]}
            </Text>
            <Text style={{ fontSize: 9, lineHeight: 1.5 }}>{(report.narrative.callouts[c] ?? '').trim()}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function NarrativeSection({ head, html, callout, origin }: {
  head: string;
  html: string | null;
  callout: string | null | undefined;
  origin: string;
}): ReactNode {
  if (!html) return null;
  return (
    <View>
      <SectionHead>{head}</SectionHead>
      <Html html={stripLeadingHeading(html)} origin={origin} />
      {(callout ?? '').trim() ? (
        <Callout>
          <Text style={{ fontSize: 9.5, lineHeight: 1.5, fontWeight: 'bold' }}>{(callout as string).trim()}</Text>
        </Callout>
      ) : null}
    </View>
  );
}

function TouchedHypotheses({ report, origin }: { report: Report; origin: string }): ReactNode {
  if (!report.touches.length) return null;
  const shown = report.touches.slice(0, DISPLAY_TOUCHES);
  return (
    <View>
      <SectionHead>Hypotheses touched</SectionHead>
      <View style={s.rowHead}>
        <Text style={[s.cellHead, { width: 44 }]}>Code</Text>
        <Text style={[s.cellHead, { flex: 1 }]}>Statement</Text>
        <Text style={[s.cellHead, { width: 46, textAlign: 'right' }]}>Signals</Text>
      </View>
      {shown.map((t) => (
        <View key={t.code} style={s.row} wrap={false}>
          <Link src={`${origin}${t.href}`} style={[s.mono, { width: 44, color: COBALT }]}>{t.code}</Link>
          <Text style={[s.small, { flex: 1, paddingRight: 6 }]}>{clip(t.statement, 140)}</Text>
          <Text style={[s.mono, { width: 46, textAlign: 'right' }]}>{t.signal_count}</Text>
        </View>
      ))}
      {report.touches.length > shown.length && (
        <Text style={[s.note, { marginTop: 4 }]}>
          And {report.touches.length - shown.length} more in the Atlas record.
        </Text>
      )}
    </View>
  );
}

function SignalRecord({ report, origin }: { report: Report; origin: string }): ReactNode {
  if (!report.signals.length) return null;
  const shown = report.signals.slice(0, DISPLAY_SIGNALS);
  return (
    <View>
      <SectionHead>Signal record</SectionHead>
      {shown.map((sig) => (
        <View key={sig.id} style={s.row} wrap={false}>
          <Text style={[s.mono, { width: 62 }]}>{sig.published_at ? sig.published_at.slice(0, 10) : 'undated'}</Text>
          <View style={{ flex: 1, paddingRight: 6 }}>
            <Link src={`${origin}/signals/${sig.id}`} style={[s.small, { color: INK, textDecoration: 'none' }]}>
              {clip(sig.title, 110)}
            </Link>
            <Text style={[s.mono, { fontSize: 6.5, color: DIM }]}>
              {[SIGNIFICANCE_LABEL[sig.significance], SIGNAL_CONTEXT_LABEL[sig.context]]
                .filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
      ))}
      {report.signals.length > shown.length && (
        <Text style={[s.note, { marginTop: 4 }]}>
          And {report.signals.length - shown.length} more signals in the period.
        </Text>
      )}
    </View>
  );
}

function PeriodPdf({ saved, origin }: { saved: SavedPeriodReport; origin: string }): ReactNode {
  const { report } = saved;
  const { narrative, range } = report;
  const when = report.generatedAt.slice(0, 10);
  // Creative editorial titles lead; legacy auto-titles fall back to the plain name
  // (mirrors the ReportReadView headline logic).
  const creative = saved.title && !saved.title.startsWith('Strategy Atlas') ? saved.title : '';
  const title = creative || `Strategy Atlas Report - ${formatDateRange(range.from, range.to)}`;
  const highCount = report.signals.filter((x) => x.significance === 'high').length;
  const footerLabel = `${title} · The Strategy Atlas · ${when}`;
  const perContext = report.contexts.filter((c) => narrative.perContext[c]);

  return (
    <Document title={title} author="The Strategy Atlas">
      <PdfCover
        kindLabel="Period report"
        title={title}
        subject={`The period across ${report.contexts.length === 1 ? 'one context' : 'both contexts'}: ${report.contexts.map((c) => SIGNAL_CONTEXT_LABEL[c]).join(', ')}.`}
        metaLines={[
          `Period: ${formatDateRange(range.from, range.to)}`,
          `Generated ${when}`,
          `Report ${saved.id}`,
        ]}
      />
      <Page size="A4" style={s.page}>
        <StatBand cells={[
          { n: report.signals.length, label: 'Signals' },
          { n: highCount, label: 'High signif.' },
          { n: report.touches.length, label: 'Hypotheses touched' },
        ]} />

        <CalloutGrid report={report} />

        <NarrativeSection head="Period summary" html={narrative.macroSurvey}
          callout={narrative.callouts.macroSurvey} origin={origin} />
        <NarrativeSection head="Hypotheses recap" html={narrative.claimsRecap}
          callout={narrative.callouts.claimsRecap} origin={origin} />
        {perContext.map((c: SignalContext) => (
          <NarrativeSection key={c} head={SIGNAL_CONTEXT_LABEL[c]} html={narrative.perContext[c] ?? null}
            callout={null} origin={origin} />
        ))}

        <TouchedHypotheses report={report} origin={origin} />
        <SignalRecord report={report} origin={origin} />

        <Disclaimer generatedAt={report.generatedAt} />
        <PdfFooter label={footerLabel} />
      </Page>
    </Document>
  );
}

export function renderPeriodPdf(saved: SavedPeriodReport, origin: string): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<PeriodPdf saved={saved} origin={origin} />);
}

export function periodPdfFilename(saved: SavedPeriodReport): string {
  const base = ['period', saved.report.range.from, saved.report.range.to]
    .join('-').replace(/[^\w.-]+/g, '_');
  return `strategy-atlas-${base}.pdf`;
}
