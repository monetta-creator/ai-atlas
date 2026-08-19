'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { PROPS_BY_STOP, type Prop } from '@/lib/traceroute/props';
import { STOP_BY_ID } from '@/lib/traceroute/stops';
import type { StopId } from '@/lib/traceroute/types';

// A side elevation of one place, drawn straight from the same geometry the 3D scene will
// use. Not decoration: every rectangle is a real prop at its real position and size, so this
// is a true plan of the thing, and it previews the layout before three.js exists.
//
// The words live here rather than in paragraphs. Hover or focus a part and you get its name
// and one plain line. Nothing is explained until you point at it.

interface Rect {
  prop: Prop;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Project a prop, plus any lattice copies, onto the XY plane. */
function project(props: Prop[]): Rect[] {
  const out: Rect[] = [];
  for (const p of props) {
    const [sx, sy] = p.size;
    const [ax, ay] = p.at;
    const cx = p.repeat?.count[0] ?? 1;
    const cy = p.repeat?.count[1] ?? 1;
    const px = p.repeat?.pitch[0] ?? 0;
    const py = p.repeat?.pitch[1] ?? 0;
    // Cap the drawn lattice: a hall is 48 racks, and 12 reads as "many" just as well.
    const nx = Math.min(cx, 12);
    const ny = Math.min(cy, 12);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const x = ax + i * px;
        const y = ay + j * py;
        out.push({ prop: p, x: x - sx / 2, y: -(y + sy / 2), w: Math.max(sx, 0.05), h: Math.max(sy, 0.05) });
      }
    }
  }
  return out;
}

export default function PartsDiagram({ stop }: { stop: StopId }) {
  const [hot, setHot] = useState<string | null>(null);
  const info = STOP_BY_ID.get(stop);

  const { rects, view } = useMemo(() => {
    const props = PROPS_BY_STOP.get(stop) ?? [];
    const r = project(props);
    if (r.length === 0) return { rects: r, view: '0 0 10 10' };
    const minX = Math.min(...r.map((k) => k.x));
    const maxX = Math.max(...r.map((k) => k.x + k.w));
    const minY = Math.min(...r.map((k) => k.y));
    const maxY = Math.max(...r.map((k) => k.y + k.h));
    const pad = Math.max((maxX - minX) * 0.04, 0.6);
    return {
      rects: r,
      view: `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`,
    };
  }, [stop]);

  if (rects.length === 0) return null;
  const hotProp = hot ? rects.find((r) => r.prop.id === hot)?.prop ?? null : null;

  return (
    <figure className="tr-dia" data-stop={stop}>
      <svg
        viewBox={view}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={info ? `${info.title}, ${info.scaleLabel}` : stop}
      >
        {rects.map((r, i) => (
          <rect
            key={`${r.prop.id}-${i}`}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            className="tr-dia-part"
            data-material={r.prop.material}
            data-energy={r.prop.energy ? '' : undefined}
            data-passive={r.prop.passive ? '' : undefined}
            data-hot={hot === r.prop.id ? '' : undefined}
            data-cold={hot && hot !== r.prop.id ? '' : undefined}
            onMouseEnter={() => !r.prop.passive && setHot(r.prop.id)}
            onMouseLeave={() => setHot(null)}
            onFocus={() => !r.prop.passive && setHot(r.prop.id)}
            onBlur={() => setHot(null)}
            tabIndex={r.prop.passive ? -1 : 0}
          >
            <title>{r.prop.label}</title>
          </rect>
        ))}
      </svg>

      <figcaption className="tr-dia-cap" data-live={hotProp ? '' : undefined}>
        {hotProp ? (
          <>
            <b>{hotProp.label}</b>
            <span>{hotProp.blurb}</span>
            {hotProp.anchor?.conceptSlug && (
              <Link className="tr-link" href={`/concepts/${hotProp.anchor.conceptSlug}`}>
                {hotProp.anchor.conceptSlug.replace(/-/g, ' ')}
              </Link>
            )}
          </>
        ) : (
          <span className="tr-dia-hint">{info?.scaleLabel}. Point at anything.</span>
        )}
      </figcaption>
    </figure>
  );
}
