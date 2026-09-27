import { widgetMeta, type Board } from '@/lib/widgets/catalog';
import { WIDGET_COMPONENTS } from '@/components/widgets/all';

// The upload door and the portal row render their own chrome; everything else
// gets the shared `.lw-card` wrapper.
const BARE_KEYS = new Set(['add-document', 'portal-tiles']);

interface Cell {
  key: string;
  span: 1 | 2 | 3;
  bare: boolean;
  Widget: (typeof WIDGET_COMPONENTS)[string];
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
    cells.push({ key, span: meta.span, bare: BARE_KEYS.has(key), Widget });
  }

  return (
    <div className={board === 'ops' ? 'lobby-widgets ops-board' : 'lobby-widgets'}>
      {cells.map((c, idx) => (
        <div
          key={c.key}
          className={`lw lw-span${c.span} ${c.bare ? 'lw-bare' : 'lw-card'}`}
          style={{ animationDelay: `${idx * 55}ms` }}
        >
          <c.Widget personal={personal} board={board} />
        </div>
      ))}
    </div>
  );
}
