import { Suspense } from 'react';
import { widgetMeta, type Board } from '@/lib/widgets/catalog';
import { WIDGET_COMPONENTS } from '@/components/widgets/all';

// The upload door and the portal row render their own chrome; everything else
// gets the shared `.lw-card` wrapper.
const BARE_KEYS = new Set(['add-document', 'portal-tiles']);

interface Cell {
  key: string;
  span: 1 | 2 | 3;
  bare: boolean;
  name: string;
  Widget: (typeof WIDGET_COMPONENTS)[string];
}

// Each widget streams in its own Suspense boundary (2026-09-28): a slow
// widget used to hold the whole board (the /ops Background widget once took
// ~7 s), so the board now paints at once and each widget fills its slot when
// its own data arrives.
function WidgetSkeleton({ name, bare }: { name: string; bare: boolean }) {
  if (bare) return <div className="lw-skel" aria-hidden="true"><span /><span /></div>;
  return (
    <div className="lw-skel" role="status" aria-label={`Loading ${name}`}>
      <div className="lw-head">{name}</div>
      <span /><span /><span />
    </div>
  );
}

// One saved layout per board: guests get the same order minus admin-only
// widgets, dropped here server-side before their data is ever fetched (an
// admin widget component is never invoked when personal is false), and a key
// that does not belong on this board is skipped.
export default function WidgetBoard({ widgets, personal, board = 'home' }: { widgets: string[]; personal: boolean; board?: Board }) {
  const cells: Cell[] = [];
  for (const key of widgets) {
    const meta = widgetMeta(key);
    const Widget = WIDGET_COMPONENTS[key];
    if (!meta || !Widget) continue; // unknown/retired key, or a widget not built yet
    if (!meta.boards.includes(board)) continue;
    if (meta.access === 'admin' && !personal) continue;
    cells.push({ key, span: meta.span, bare: BARE_KEYS.has(key), name: meta.name, Widget });
  }

  return (
    <div className={board === 'ops' ? 'lobby-widgets ops-board' : 'lobby-widgets'}>
      {cells.map((c, idx) => (
        <div
          key={c.key}
          className={`lw lw-span${c.span} ${c.bare ? 'lw-bare' : 'lw-card'}`}
          style={{ animationDelay: `${idx * 55}ms` }}
        >
          <Suspense fallback={<WidgetSkeleton name={c.name} bare={c.bare} />}>
            <c.Widget personal={personal} board={board} />
          </Suspense>
        </div>
      ))}
    </div>
  );
}
