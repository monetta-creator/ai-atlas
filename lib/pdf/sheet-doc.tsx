import { renderToBuffer } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import type {
  ClaimSheetPack, LensSheetPack, AtlasSheetPack, RoundupPack, SavedSheet, SheetEvidence, SheetSignal,
} from '@/lib/types';

import { SIGNIFICANCE_LABEL, SHEET_KIND_LABEL, SHEET_SECTION_TITLES } from '@/lib/format';
import {
  registerFonts, s, COBALT, DIM, DIRECTION_COLOR,
  Document, Page, View, Text, Link,
  PdfCover, PdfFooter, SectionHead, StatBand, Callout, Disclaimer, Html,
} from './shell';

// The generated-report PDF (claim/bridge tear sheet, lens deep report, executive
// briefing): cover page, at-a-glance stat band, the gated narrative, then the
// full evidence and signal record. Everything rendered here is from the saved
// row's guest-safe pack + gated narrative; the route decides who may download.

const clip = (t: string | null | undefined, n: number): string => {
  const v = (t ?? '').trim().replace(/\s+/g, ' ');
  return v.length > n ? `${v.slice(0, n)} ...` : v;
};

const DISPLAY_EVIDENCE = 20;
const DISPLAY_SIGNALS = 20;

function scopeLine(saved: SavedSheet): string {
  if (!saved.scope_from && !saved.scope_to) return 'Scope: the full corpus';
  if (saved.scope_from && saved.scope_to) return `Scope: ${saved.scope_from} to ${saved.scope_to}`;
  if (saved.scope_from) return `Scope: from ${saved.scope_from}`;
  return `Scope: through ${saved.scope_to}`;
}

function NarrativeSections({ saved, origin }: { saved: SavedSheet; origin: string }): ReactNode {
  const titles = SHEET_SECTION_TITLES[saved.pack.kind];
  const n = saved.narrative;
  return (
    <>
      {n.reading && (
        <View>
          <SectionHead>{titles.reading}</SectionHead>
          <Html html={n.reading} origin={origin} />
        </View>
      )}
      {n.connections && (
        <View>
          <SectionHead>{titles.connections}</SectionHead>
          <Html html={n.connections} origin={origin} />
        </View>
      )}
      {n.watch && (
        <View>
          <SectionHead>{titles.watch}</SectionHead>
          <Html html={n.watch} origin={origin} />
        </View>
      )}
      {n.bottomLine && (
        <Callout>
          <Html html={n.bottomLine} origin={origin} />
        </Callout>
      )}
    </>
  );
}

function EvidenceLedger({ evidence }: { evidence: SheetEvidence[] }): ReactNode {
  if (!evidence.length) return null;
  const shown = evidence.slice(0, DISPLAY_EVIDENCE);
  return (
    <View>
      <SectionHead>Evidence ledger</SectionHead>
      <View style={s.rowHead}>
        <Text style={[s.cellHead, { width: 66 }]}>Direction</Text>
        <Text style={[s.cellHead, { width: 46 }]}>Weight</Text>
        <Text style={[s.cellHead, { flex: 1.1 }]}>Source</Text>
        <Text style={[s.cellHead, { flex: 2 }]}>Excerpt</Text>
      </View>
      {shown.map((e, i) => (
        <View key={i} style={s.row} wrap={false}>
          <Text style={[s.mono, { width: 66, color: DIRECTION_COLOR[e.direction] }]}>{e.direction}</Text>
          <Text style={[s.mono, { width: 46 }]}>{e.weight}</Text>
          <View style={{ flex: 1.1, paddingRight: 6 }}>
            {e.source_url ? (
              <Link src={e.source_url} style={[s.small, { color: COBALT }]}>
                {clip(e.source_title ?? e.source_outlet ?? 'source', 70)}
              </Link>
            ) : (
              <Text style={s.small}>{clip(e.source_title ?? e.signal_title ?? 'signal record', 70)}</Text>
            )}
            <Text style={[s.mono, { fontSize: 6.5, color: DIM }]}>
              {[e.source_outlet, e.source_published ?? e.noted_on, e.signal_tag].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Text style={[s.small, { flex: 2 }]}>{e.excerpt ? `"${clip(e.excerpt, 220)}"` : 'No excerpt recorded.'}</Text>
        </View>
      ))}
      {evidence.length > shown.length && (
        <Text style={[s.note, { marginTop: 4 }]}>
          And {evidence.length - shown.length} more evidence items in the Atlas record.
        </Text>
      )}
    </View>
  );
}

function SignalRecord({ signals, origin, withDirection }: { signals: SheetSignal[]; origin: string; withDirection: boolean }): ReactNode {
  if (!signals.length) return null;
  const shown = signals.slice(0, DISPLAY_SIGNALS);
  return (
    <View>
      <SectionHead>Signal record</SectionHead>
      {shown.map((sig) => (
        <View key={sig.id} style={s.row} wrap={false}>
          <Text style={[s.mono, { width: 62 }]}>{sig.published_at ?? 'undated'}</Text>
          <Link src={`${origin}/signals/${sig.id}`} style={[s.mono, { width: 30, color: COBALT }]}>{sig.tag}</Link>
          <View style={{ flex: 1, paddingRight: 6 }}>
            <Text style={[s.small, { color: '#0f172a' }]}>{clip(sig.title, 110)}</Text>
            <Text style={[s.mono, { fontSize: 6.5, color: DIM }]}>
              {[SIGNIFICANCE_LABEL[sig.significance], sig.source_domain, withDirection ? sig.direction ?? undefined : undefined]
                .filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
      ))}
      {signals.length > shown.length && (
        <Text style={[s.note, { marginTop: 4 }]}>
          And {signals.length - shown.length} more signals in the Atlas record.
        </Text>
      )}
    </View>
  );
}

function BulletRow({ children }: { children: ReactNode }): ReactNode {
  return (
    <View style={s.li} wrap={false}>
      <Text style={s.bullet}>•</Text>
      <Text style={s.liText}>{children}</Text>
    </View>
  );
}

function ClaimBody({ saved, pack, origin }: { saved: SavedSheet; pack: ClaimSheetPack; origin: string }): ReactNode {
  const st = pack.stats;
  return (
    <>
      <StatBand cells={[
        { n: st.evidence.total, label: 'Evidence items' },
        { n: st.evidence.supports, label: 'Supporting', tone: DIRECTION_COLOR.supports },
        { n: st.evidence.contradicts, label: 'Contradicting', tone: DIRECTION_COLOR.contradicts },
        { n: st.signals.total, label: 'Signals' },
        { n: st.signals.significance.high, label: 'High signif.' },
      ]} />
      <Text style={s.note}>{st.corpusNote}</Text>

      <View style={s.panel} wrap={false}>
        <Text style={s.panelKicker}>{pack.kind === 'bridge' ? `Bridge-claim ${pack.node.code}` : `Claim ${pack.node.code}`}</Text>
        <Text style={s.panelBody}>{pack.node.statement}</Text>
        {pack.node.test && (
          <>
            <Text style={[s.panelKicker, { marginTop: 8 }]}>Would falsify it</Text>
            <Text style={s.panelSub}>{pack.node.test}</Text>
          </>
        )}
      </View>

      <NarrativeSections saved={saved} origin={origin} />

      {(pack.stances.length > 0 || pack.bridges.length > 0 || pack.concepts.length > 0 || pack.theses.length > 0) && (
        <View>
          <SectionHead>Wired into the argument</SectionHead>
          {pack.stances.map((x, i) => (
            <BulletRow key={`st-${i}`}>
              {x.relation} the stance &quot;{x.stance_title}&quot; in{' '}
              <Link src={`${origin}/q/${x.q_slug}`} style={s.link}>{x.q_title}</Link>
            </BulletRow>
          ))}
          {pack.bridges.map((x, i) => (
            <BulletRow key={`br-${i}`}>
              {pack.kind === 'bridge' ? `fed by ${x.code} (${x.relation})` : `${x.relation} bridge ${x.code}`}:{' '}
              <Link src={`${origin}${x.href}`} style={s.link}>{clip(x.statement, 140)}</Link>
            </BulletRow>
          ))}
          {pack.concepts.map((x, i) => (
            <BulletRow key={`co-${i}`}>
              concept <Link src={`${origin}${x.href}`} style={s.link}>{x.name}</Link> ({x.status})
            </BulletRow>
          ))}
          {pack.theses.map((x, i) => (
            <BulletRow key={`th-${i}`}>
              tracked by the thesis &quot;{clip(x.statement, 130)}&quot;
              {x.latest_report_id ? (
                <>
                  {' '}(<Link src={`${origin}/thesis-report/${x.latest_report_id}`} style={s.link}>latest report</Link>)
                </>
              ) : null}
            </BulletRow>
          ))}
        </View>
      )}

      <EvidenceLedger evidence={pack.evidence} />
      <SignalRecord signals={pack.signals} origin={origin} withDirection />
    </>
  );
}

function LensBody({ saved, pack, origin }: { saved: SavedSheet; pack: LensSheetPack; origin: string }): ReactNode {
  const st = pack.stats;
  return (
    <>
      <StatBand cells={[
        { n: st.signals.total, label: 'Signals' },
        { n: st.signals.significance.high, label: 'High signif.' },
        { n: st.codes, label: 'Claims touched' },
        { n: pack.evidence.length, label: 'Evidence rows' },
        { n: st.oneSidedCodes.length, label: 'One-sided', tone: st.oneSidedCodes.length ? '#c62828' : undefined },
      ]} />
      <Text style={s.note}>{st.corpusNote}</Text>

      <NarrativeSections saved={saved} origin={origin} />

      {pack.codes.length > 0 && (
        <View>
          <SectionHead>Claims in play</SectionHead>
          <View style={s.rowHead}>
            <Text style={[s.cellHead, { width: 44 }]}>Code</Text>
            <Text style={[s.cellHead, { flex: 1 }]}>Statement</Text>
            <Text style={[s.cellHead, { width: 46, textAlign: 'right' }]}>Signals</Text>
            <Text style={[s.cellHead, { width: 64, textAlign: 'right' }]}>s / c / n</Text>
          </View>
          {pack.codes.slice(0, 24).map((c) => (
            <View key={c.code} style={s.row} wrap={false}>
              <Link src={`${origin}${c.href}`} style={[s.mono, { width: 44, color: COBALT }]}>{c.code}</Link>
              <Text style={[s.small, { flex: 1, paddingRight: 6 }]}>{clip(c.statement, 130)}</Text>
              <Text style={[s.mono, { width: 46, textAlign: 'right' }]}>{c.signal_count}</Text>
              <Text style={[s.mono, { width: 64, textAlign: 'right' }]}>
                {c.directions.supports}/{c.directions.contradicts}/{c.directions.neutral}
              </Text>
            </View>
          ))}
        </View>
      )}

      <EvidenceLedger evidence={pack.evidence} />
      <SignalRecord signals={pack.signals} origin={origin} withDirection={false} />
    </>
  );
}

function AtlasBody({ saved, pack, origin }: { saved: SavedSheet; pack: AtlasSheetPack; origin: string }): ReactNode {
  const h = pack.health;
  return (
    <>
      <StatBand cells={[
        { n: h.claims, label: 'Claims' },
        { n: h.bridges, label: 'Bridges' },
        { n: h.evidence, label: 'Evidence' },
        { n: h.signalsPublished, label: 'Signals' },
        { n: h.oneSided, label: 'One-sided', tone: h.oneSided ? '#c62828' : undefined },
      ]} />
      <Text style={s.note}>{pack.stats.corpusNote}</Text>

      <NarrativeSections saved={saved} origin={origin} />

      <View>
        <SectionHead>The map</SectionHead>
        {pack.questions.map((qn) => (
          <View key={qn.slug} style={{ marginBottom: 8 }} wrap={false}>
            <Link src={`${origin}/q/${qn.slug}`} style={[s.para, s.bold, { color: '#0f172a', textDecoration: 'none' }]}>
              {qn.title}
            </Link>
            {qn.stances.map((x) => (
              <View key={x.code} style={s.li}>
                <Text style={s.bullet}>•</Text>
                <Text style={[s.small, { flex: 1 }]}>
                  {x.title}: {x.claims_supporting} claims for, {x.claims_contradicting} against · evidence{' '}
                  {x.evidence.supports}s/{x.evidence.contradicts}c/{x.evidence.neutral}n
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>

      {pack.oneSidedTargets.length > 0 && (
        <View>
          <SectionHead>Most one-sided nodes</SectionHead>
          {pack.oneSidedTargets.map((t) => (
            <BulletRow key={t.code}>
              <Link src={`${origin}${t.href}`} style={s.link}>{t.code}</Link>: {clip(t.statement, 150)}
            </BulletRow>
          ))}
        </View>
      )}

      {pack.theses.length > 0 && (
        <View>
          <SectionHead>Standing theses</SectionHead>
          {pack.theses.map((t, i) => (
            <BulletRow key={i}>
              &quot;{clip(t.statement, 140)}&quot;: {t.matched} matched, {t.supports} supporting, {t.contradicts}{' '}
              contradicting{t.report_id ? (
                <>
                  {' '}(<Link src={`${origin}/thesis-report/${t.report_id}`} style={s.link}>report</Link>)
                </>
              ) : null}
            </BulletRow>
          ))}
        </View>
      )}

      <SignalRecord signals={pack.signals} origin={origin} withDirection={false} />
    </>
  );
}

function RoundupBody({ saved, pack, origin }: { saved: SavedSheet; pack: RoundupPack; origin: string }): ReactNode {
  const st = pack.stats;
  const shownPapers = pack.papers.slice(0, DISPLAY_SIGNALS);
  return (
    <>
      <StatBand cells={[
        { n: st.papersTracked, label: 'Tracked' },
        { n: st.papersNoted, label: 'Noted' },
        { n: st.findings, label: 'Findings' },
        { n: st.threadsUpdated, label: 'Threads updated' },
        { n: st.risingRejects, label: 'Rising rejects', tone: st.risingRejects ? '#c62828' : undefined },
      ]} />
      <Text style={s.note}>
        The week of {pack.scopeFrom} to {pack.scopeTo}: {st.papersTracked + st.papersNoted} papers
        reviewed, {st.findings} with an extracted finding, {st.threadsUpdated} research thread
        {st.threadsUpdated === 1 ? '' : 's'} refreshed, {st.risingRejects} rising reject
        {st.risingRejects === 1 ? '' : 's'} on watch.
      </Text>

      <NarrativeSections saved={saved} origin={origin} />

      {pack.papers.length > 0 && (
        <View>
          <SectionHead>Papers this week</SectionHead>
          <View style={s.rowHead}>
            <Text style={[s.cellHead, { flex: 1.4 }]}>Title</Text>
            <Text style={[s.cellHead, { flex: 1 }]}>Effect size</Text>
            <Text style={[s.cellHead, { width: 44 }]}>Status</Text>
          </View>
          {shownPapers.map((p) => (
            <View key={p.id} style={s.row} wrap={false}>
              <View style={{ flex: 1.4, paddingRight: 6 }}>
                <Link src={`${origin}/research/${p.id}`} style={[s.small, { color: COBALT }]}>{clip(p.title, 90)}</Link>
                {p.headline_claim && (
                  <Text style={[s.mono, { fontSize: 6.5, color: DIM }]}>{clip(p.headline_claim, 90)}</Text>
                )}
              </View>
              <Text style={[s.small, { flex: 1 }]}>{p.effect_size ? clip(p.effect_size, 90) : '–'}</Text>
              <Text style={[s.mono, { width: 44 }]}>{p.review_status}</Text>
            </View>
          ))}
          {pack.papers.length > shownPapers.length && (
            <Text style={[s.note, { marginTop: 4 }]}>
              And {pack.papers.length - shownPapers.length} more papers reviewed this week.
            </Text>
          )}
        </View>
      )}

      {pack.threads.length > 0 && (
        <View>
          <SectionHead>Threads updated</SectionHead>
          {pack.threads.map((t) => (
            <BulletRow key={t.slug}>
              <Link src={`${origin}/research/threads/${t.slug}`} style={s.link}>{t.title}</Link>: {clip(t.synthesis_excerpt, 160)}
            </BulletRow>
          ))}
        </View>
      )}

      {pack.risingRejects.length > 0 && (
        <View>
          <SectionHead>Rising rejects</SectionHead>
          {pack.risingRejects.map((r) => (
            <BulletRow key={r.id}>
              {clip(r.title, 130)} · {r.citation_count}× citations ({r.review_status})
            </BulletRow>
          ))}
        </View>
      )}
    </>
  );
}

function SheetPdf({ saved, origin }: { saved: SavedSheet; origin: string }): ReactNode {
  const pack = saved.pack;
  const kindLabel = SHEET_KIND_LABEL[pack.kind];
  const subjectLine =
    pack.kind === 'lens' ? `The Signal Board through the ${pack.label} lens.` :
    pack.kind === 'atlas' ? 'The state of the AI-economy debate across the Atlas.' :
    pack.kind === 'roundup' ? `Week of ${pack.scopeFrom} to ${pack.scopeTo}.` :
    `${pack.node.code} · ${pack.node.statement}`;
  const metaLines = [
    scopeLine(saved),
    `Generated ${saved.generated_at.slice(0, 10)}`,
    `Report ${saved.id}`,
  ];
  const footerLabel = `${saved.title} · The AI Atlas · ${saved.generated_at.slice(0, 10)}`;
  return (
    <Document title={saved.title} author="The AI Atlas">
      <PdfCover kindLabel={kindLabel} title={saved.title} subject={subjectLine} metaLines={metaLines} />
      <Page size="A4" style={s.page}>
        {pack.kind === 'lens' ? (
          <LensBody saved={saved} pack={pack} origin={origin} />
        ) : pack.kind === 'atlas' ? (
          <AtlasBody saved={saved} pack={pack} origin={origin} />
        ) : pack.kind === 'roundup' ? (
          <RoundupBody saved={saved} pack={pack} origin={origin} />
        ) : (
          <ClaimBody saved={saved} pack={pack} origin={origin} />
        )}
        <Disclaimer generatedAt={saved.generated_at} />
        <PdfFooter label={footerLabel} />
      </Page>
    </Document>
  );
}

export function renderSheetPdf(saved: SavedSheet, origin: string): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<SheetPdf saved={saved} origin={origin} />);
}

export function sheetPdfFilename(saved: SavedSheet): string {
  const base = [saved.kind, saved.subject ?? 'atlas', saved.generated_at.slice(0, 10)]
    .join('-').replace(/[^\w.-]+/g, '_');
  return `ai-atlas-${base}.pdf`;
}
