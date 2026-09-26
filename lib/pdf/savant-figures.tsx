import { StyleSheet, Svg, Rect, Circle, Line, Path, Text as SvgText, View, Text, Link, Image } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { COBALT, INK, DIM, LINE } from './shell';
import { layoutFigure, MAP_NOTE, FIG_W, type SavantFigure, type Prim, type Tone } from '../savant/figures-core';
import { monogram } from '../logo';

// The PDF painter for Savant's figures: the same primitive list the web
// paints, drawn with react-pdf's Svg (a viewBox scales the 600-unit layout
// to the column width). Entity cards are Views with the favicon baked as a
// data URI at run time (or the monogram tile), so this file makes no
// network calls. Fonts: Schibsted for every model-written string, JetBrains
// only for the kicker and axis labels the layout core controls.

const FAINT = '#95a0b1';
const PAPER = '#ffffff';
const TONE: Record<Tone, string> = {
  ink: INK, cobalt: COBALT, cobaltSoft: '#9fb3ff', dim: DIM, faint: FAINT, line: '#c9d0dc', paper: PAPER, none: 'none',
};
const FONT = { body: 'Schibsted', mono: 'JetBrains', head: 'Anton' };
const COL_W = 524;

const f = StyleSheet.create({
  wrap: { marginTop: 8, marginBottom: 14, paddingTop: 8, borderTopWidth: 1.5, borderTopColor: INK },
  kicker: { fontFamily: 'JetBrains', fontSize: 7, letterSpacing: 1.2, color: COBALT, marginBottom: 2 },
  title: { fontSize: 11, fontWeight: 'bold', color: INK, marginBottom: 6 },
  caption: { fontSize: 8.5, color: DIM, lineHeight: 1.45, marginTop: 6, borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 5 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  card: { paddingHorizontal: 4, marginBottom: 8 },
  cardInner: { borderWidth: 0.75, borderColor: LINE, borderRadius: 3, padding: 7 },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  logo: { width: 16, height: 16, marginRight: 6, borderRadius: 2 },
  mono: { width: 16, height: 16, marginRight: 6, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  monoText: { fontSize: 6.5, fontWeight: 'bold' },
  name: { fontSize: 9.5, fontWeight: 'bold', color: INK, textDecoration: 'none' },
  note: { fontSize: 8, color: DIM, lineHeight: 1.4 },
  bullet: { fontSize: 7.8, color: INK, lineHeight: 1.4, marginTop: 1.5 },
});

function paint(p: Prim, i: number): ReactNode {
  switch (p.t) {
    case 'rect':
      return <Rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r ?? 0} ry={p.r ?? 0} fill={TONE[p.fill]} stroke={p.stroke ? TONE[p.stroke] : undefined} strokeWidth={p.stroke ? 1 : 0} />;
    case 'circle':
      return <Circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill={TONE[p.fill]} stroke={p.stroke ? TONE[p.stroke] : undefined} strokeWidth={p.stroke ? 1.5 : 0} />;
    case 'line':
      return <Line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={TONE[p.stroke]} strokeWidth={p.width ?? 1} strokeDasharray={p.dash ? '3,3' : undefined} />;
    case 'path':
      return <Path key={i} d={p.d} stroke={TONE[p.stroke]} fill={p.fill ? TONE[p.fill] : 'none'} strokeWidth={p.width ?? 1} />;
    case 'text':
      return (
        <SvgText
          key={i} x={p.x} y={p.y} textAnchor={p.anchor ?? 'start'}
          style={{ fontFamily: FONT[p.font ?? 'body'], fontSize: p.size, fill: TONE[p.fill], fontWeight: p.bold ? 'bold' : 'normal' }}
        >
          {p.text}
        </SvgText>
      );
    default:
      return null;
  }
}

function Mark({ name, logo }: { name: string; logo: string | null | undefined }) {
  if (logo) {
    // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image takes no alt; the mark is decorative
    return <Image src={logo} style={f.logo} />;
  }
  const m = monogram(name);
  return (
    <View style={[f.mono, { backgroundColor: m.bgHex }]}>
      <Text style={[f.monoText, { color: m.fgHex }]}>{m.initials}</Text>
    </View>
  );
}

export function PdfFigure({ figure, index, origin }: { figure: SavantFigure; index: number; origin: string }): ReactNode {
  const layout = layoutFigure(figure);
  const abs = (href: string | null): string | null => (href ? (href.startsWith('/') ? `${origin}${href}` : href) : null);
  return (
    <View style={f.wrap} wrap={false}>
      <Text style={f.kicker}>{`FIGURE ${index}`}</Text>
      <Text style={f.title}>{figure.title}</Text>
      {figure.kind === 'entities' ? (
        <View style={f.cards}>
          {figure.entities.map((e) => {
            const href = abs(e.href);
            return (
              <View key={`${e.label}-${e.href ?? ''}`} style={[f.card, { width: `${100 / figure.columns}%` }]}>
                <View style={f.cardInner}>
                  <View style={f.cardHead}>
                    <Mark name={e.label} logo={e.logo} />
                    {href ? <Link src={href} style={f.name}>{e.label}</Link> : <Text style={f.name}>{e.label}</Text>}
                  </View>
                  {e.note && <Text style={f.note}>{e.note}</Text>}
                  {e.bullets.map((b) => <Text key={b} style={f.bullet}>{`• ${b}`}</Text>)}
                </View>
              </View>
            );
          })}
        </View>
      ) : layout ? (
        <Svg width={COL_W} height={(layout.height * COL_W) / FIG_W} viewBox={`0 0 ${FIG_W} ${layout.height}`}>
          {layout.prims.map(paint)}
        </Svg>
      ) : null}
      <Text style={f.caption}>{figure.kind === 'map' ? `${figure.caption} ${MAP_NOTE}` : figure.caption}</Text>
    </View>
  );
}
