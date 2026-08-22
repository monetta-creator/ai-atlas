import path from 'node:path';
import { Document, Page, View, Text, Link, Font, StyleSheet } from '@react-pdf/renderer';
import { parse, HTMLElement, NodeType, type Node } from 'node-html-parser';
import type { ReactNode } from 'react';

// The branded PDF kit (Atlas broadsheet identity): embedded Anton + Schibsted
// Grotesk + JetBrains Mono (OFL, binaries in lib/pdf/fonts, traced into the PDF
// routes via next.config.ts outputFileTracingIncludes), cobalt accent, square
// rules. Server-only: react-pdf renders in the PDF Route Handlers, never in the
// Server-Component graph. The HTML converter handles the citation-gated subset
// (p/h2/h3/strong/em/u/code/br/ul/ol/li/blockquote/a); links become clickable
// /URI annotations, internal hrefs absolutized against the request origin.

export const COBALT = '#2d5bff';
export const INK = '#0f172a';
export const DIM = '#5b6675';
const FAINT = '#95a0b1';
export const LINE = '#d9dee7';

const FONT_DIR = path.join(process.cwd(), 'lib', 'pdf', 'fonts');
let registered = false;
export function registerFonts(): void {
  if (registered) return;
  registered = true;
  Font.register({ family: 'Anton', src: path.join(FONT_DIR, 'Anton-Regular.ttf') });
  Font.register({
    family: 'Schibsted',
    fonts: [
      { src: path.join(FONT_DIR, 'SchibstedGrotesk-Regular.ttf'), fontWeight: 'normal' },
      { src: path.join(FONT_DIR, 'SchibstedGrotesk-Bold.ttf'), fontWeight: 'bold' },
      // No italic binaries are embedded; map the italic style onto the upright faces
      // so narrative <em>/<i> renders upright instead of throwing "Could not resolve
      // font" and 500ing the whole document.
      { src: path.join(FONT_DIR, 'SchibstedGrotesk-Regular.ttf'), fontWeight: 'normal', fontStyle: 'italic' },
      { src: path.join(FONT_DIR, 'SchibstedGrotesk-Bold.ttf'), fontWeight: 'bold', fontStyle: 'italic' },
    ],
  });
  Font.register({ family: 'JetBrains', src: path.join(FONT_DIR, 'JetBrainsMono-Regular.ttf') });
  // Broadsheet: no hyphenation, ragged right.
  Font.registerHyphenationCallback((word) => [word]);
}

export const s = StyleSheet.create({
  page: {
    paddingTop: 46, paddingHorizontal: 46, paddingBottom: 62,
    fontFamily: 'Schibsted', fontSize: 10, color: INK, lineHeight: 1.55,
  },
  cover: { paddingTop: 120, paddingHorizontal: 56, paddingBottom: 56, fontFamily: 'Schibsted', color: INK },
  wordmark: { fontFamily: 'Anton', fontSize: 15, letterSpacing: 2, marginBottom: 10 },
  ruleHeavy: { borderTopWidth: 3, borderTopColor: INK },
  ruleThin: { borderTopWidth: 1, borderTopColor: INK, marginTop: 2 },
  kicker: {
    fontFamily: 'JetBrains', fontSize: 8.5, letterSpacing: 2, color: COBALT,
    textTransform: 'uppercase', marginTop: 36, marginBottom: 14,
  },
  coverTitle: { fontFamily: 'Anton', fontSize: 34, lineHeight: 1.12, marginBottom: 16 },
  coverSubject: { fontSize: 12.5, lineHeight: 1.5, color: DIM, marginBottom: 26, maxWidth: 400 },
  coverMeta: { fontFamily: 'JetBrains', fontSize: 8.5, color: FAINT, lineHeight: 1.8 },
  coverFoot: {
    position: 'absolute', bottom: 48, left: 56, right: 56,
    borderTopWidth: 1, borderTopColor: LINE, paddingTop: 10,
    fontSize: 8.5, color: FAINT, lineHeight: 1.6,
  },
  footer: {
    position: 'absolute', bottom: 26, left: 46, right: 46,
    textAlign: 'center', fontSize: 7.5, fontFamily: 'JetBrains', color: FAINT,
  },
  sectionHead: {
    fontSize: 10.5, fontWeight: 'bold', letterSpacing: 1.4, textTransform: 'uppercase',
    color: INK, marginTop: 18, marginBottom: 8,
    borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 4,
  },
  statBand: {
    flexDirection: 'row', borderTopWidth: 2, borderTopColor: INK,
    borderBottomWidth: 1, borderBottomColor: FAINT, marginBottom: 14,
  },
  statCell: { flex: 1, alignItems: 'center', paddingVertical: 10, borderLeftWidth: 1, borderLeftColor: LINE },
  statCellFirst: { borderLeftWidth: 0 },
  statN: { fontFamily: 'Anton', fontSize: 19, lineHeight: 1 },
  statL: { fontFamily: 'JetBrains', fontSize: 6.5, letterSpacing: 1, color: FAINT, textTransform: 'uppercase', marginTop: 4 },
  note: { fontSize: 8.5, color: DIM, lineHeight: 1.6, marginBottom: 6 },
  panel: { borderWidth: 1, borderColor: INK, padding: 12, marginBottom: 14 },
  panelKicker: { fontFamily: 'JetBrains', fontSize: 7, letterSpacing: 1.5, color: COBALT, textTransform: 'uppercase', marginBottom: 4 },
  panelBody: { fontSize: 11, fontWeight: 'bold', lineHeight: 1.45 },
  panelSub: { fontSize: 9.5, color: DIM, lineHeight: 1.5, marginTop: 4 },
  callout: { borderLeftWidth: 3, borderLeftColor: COBALT, paddingLeft: 12, paddingVertical: 4, marginTop: 14, marginBottom: 6 },
  para: { marginBottom: 6 },
  bold: { fontWeight: 'bold' },
  italic: { fontStyle: 'italic' },
  underline: { textDecoration: 'underline' },
  code: { fontFamily: 'JetBrains', fontSize: 9 },
  link: { color: COBALT, textDecoration: 'underline' },
  li: { flexDirection: 'row', marginBottom: 3 },
  bullet: { width: 14 },
  liText: { flex: 1 },
  bq: { borderLeftWidth: 2, borderLeftColor: LINE, paddingLeft: 8, marginBottom: 6 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 4 },
  rowHead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 3 },
  cellHead: { fontFamily: 'JetBrains', fontSize: 6.5, letterSpacing: 1, color: FAINT, textTransform: 'uppercase' },
  mono: { fontFamily: 'JetBrains', fontSize: 8 },
  small: { fontSize: 8.5, color: DIM, lineHeight: 1.5 },
  disclaimer: { fontSize: 8, color: FAINT, lineHeight: 1.6, marginTop: 4 },
});

export const DIRECTION_COLOR: Record<string, string> = {
  supports: '#2e7d32',
  contradicts: '#c62828',
  neutral: FAINT,
};

// ---------------------------------------------------------------- shared parts

function DoubleRule(): ReactNode {
  return (
    <View>
      <View style={s.ruleHeavy} />
      <View style={s.ruleThin} />
    </View>
  );
}

export function PdfCover({ kindLabel, title, subject, metaLines }: {
  kindLabel: string;
  title: string;
  subject: string | null;
  metaLines: string[];
}): ReactNode {
  return (
    <Page size="A4" style={s.cover}>
      <Text style={s.wordmark}>THE AI ATLAS</Text>
      <DoubleRule />
      <Text style={s.kicker}>{kindLabel}</Text>
      <Text style={s.coverTitle}>{title}</Text>
      {subject && <Text style={s.coverSubject}>{subject}</Text>}
      <View>
        {metaLines.map((l, i) => <Text key={i} style={s.coverMeta}>{l}</Text>)}
      </View>
      <View style={s.coverFoot}>
        <Text>
          Generated from the Strategy Atlas corpus: tracked signals, falsifiable hypotheses, and the
          evidence wiring them together. Every citation in this report resolves to a tracked record.
        </Text>
      </View>
    </Page>
  );
}

export function PdfFooter({ label }: { label: string }): ReactNode {
  // Two react-pdf 4.6 + React 19 landmines encoded here: (1) fixed elements
  // must be mounted LAST inside their Page or they silently fail to render;
  // (2) the render-prop Text (the documented page-number pattern) never renders
  // at all in this stack, so the footer is a static label without page numbers.
  return <Text fixed style={s.footer}>{label}</Text>;
}

export function SectionHead({ children }: { children: ReactNode }): ReactNode {
  return <Text style={s.sectionHead}>{children}</Text>;
}

export function StatBand({ cells }: { cells: { n: string | number; label: string; tone?: string }[] }): ReactNode {
  return (
    <View style={s.statBand}>
      {cells.map((c, i) => (
        <View key={i} style={i === 0 ? [s.statCell, s.statCellFirst] : s.statCell}>
          <Text style={c.tone ? [s.statN, { color: c.tone }] : s.statN}>{String(c.n)}</Text>
          <Text style={s.statL}>{c.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function Callout({ children }: { children: ReactNode }): ReactNode {
  return <View style={s.callout}>{children}</View>;
}

export function Disclaimer({ generatedAt }: { generatedAt: string }): ReactNode {
  return (
    <View wrap={false} style={{ marginTop: 22, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8 }}>
      <Text style={s.disclaimer}>
        Methodology: the data half of this report (counts, directions, spans, coverage statements) is
        computed deterministically from the Strategy Atlas database. The narrative half is drafted by an AI
        model (Claude) over that frozen evidence pack only, then passed through a citation gate: any
        link the pack cannot vouch for is removed before rendering. Statistics in the prose come from
        the computed figures. Generated {generatedAt.slice(0, 10)}.
      </Text>
      <Text style={s.disclaimer}>
        The Strategy Atlas is an orientation tool, not a research product: it maps where the
        disagreement is and what evidence would move it. Nothing here is investment, legal, or
        professional advice.
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------- HTML → PDF

const isEl = (n: Node): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE;
const tagOf = (el: HTMLElement) => el.tagName?.toLowerCase();

function inline(nodes: Node[], origin: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  nodes.forEach((n, i) => {
    const k = `${key}-${i}`;
    if (n.nodeType === NodeType.TEXT_NODE) {
      if (n.text) out.push(n.text);
      return;
    }
    if (!isEl(n)) return;
    const tag = tagOf(n);
    if (tag === 'a') {
      const href = n.getAttribute('href') || '';
      const src = href.startsWith('/') ? origin + href : href;
      out.push(<Link key={k} src={src} style={s.link}>{inline(n.childNodes, origin, k)}</Link>);
    } else if (tag === 'strong' || tag === 'b') {
      out.push(<Text key={k} style={s.bold}>{inline(n.childNodes, origin, k)}</Text>);
    } else if (tag === 'em' || tag === 'i') {
      out.push(<Text key={k} style={s.italic}>{inline(n.childNodes, origin, k)}</Text>);
    } else if (tag === 'u') {
      out.push(<Text key={k} style={s.underline}>{inline(n.childNodes, origin, k)}</Text>);
    } else if (tag === 'code') {
      out.push(<Text key={k} style={s.code}>{inline(n.childNodes, origin, k)}</Text>);
    } else if (tag === 'br') {
      out.push('\n');
    } else {
      out.push(...inline(n.childNodes, origin, k));
    }
  });
  return out;
}

function blocks(root: HTMLElement, origin: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  root.childNodes.forEach((n, i) => {
    const k = `${keyBase}-${i}`;
    if (n.nodeType === NodeType.TEXT_NODE) {
      const t = n.text.trim();
      if (t) out.push(<Text key={k} style={s.para}>{t}</Text>);
      return;
    }
    if (!isEl(n)) return;
    const tag = tagOf(n);
    if (tag === 'p') {
      out.push(<Text key={k} style={s.para}>{inline(n.childNodes, origin, k)}</Text>);
    } else if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      out.push(<Text key={k} style={[s.para, s.bold]}>{inline(n.childNodes, origin, k)}</Text>);
    } else if (tag === 'ul' || tag === 'ol') {
      const lis = n.childNodes.filter((c) => isEl(c) && tagOf(c) === 'li') as HTMLElement[];
      lis.forEach((li, j) => {
        out.push(
          <View key={`${k}-${j}`} style={s.li}>
            <Text style={s.bullet}>{tag === 'ol' ? `${j + 1}.` : '•'}</Text>
            <Text style={s.liText}>{inline(li.childNodes, origin, `${k}-${j}`)}</Text>
          </View>
        );
      });
    } else if (tag === 'blockquote') {
      out.push(<View key={k} style={s.bq}><Text style={s.para}>{inline(n.childNodes, origin, k)}</Text></View>);
    } else if (tag === 'br') {
      // skip
    } else {
      out.push(...blocks(n, origin, k));
    }
  });
  return out;
}

export function Html({ html, origin }: { html: string; origin: string }): ReactNode {
  return <View>{blocks(parse(html), origin, 'blk')}</View>;
}

export { Document, Page, View, Text, Link };
