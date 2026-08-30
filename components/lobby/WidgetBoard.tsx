import { widgetMeta } from '@/lib/widgets/catalog';
import { WIDGET_COMPONENTS } from './widgets/registry';

// The seven portal tiles and the upload door render their own card chrome
// (`.lobby-tile`, unchanged from the pre-widget-board lobby); everything
// else gets the shared `.lw-card` wrapper.
const BARE_KEYS = new Set([
  'add-document',
  'tile-signals', 'tile-blotter', 'tile-map', 'tile-reports',
  'tile-datasets', 'tile-research', 'tile-scout',
]);

interface Cell {
  key: string;
  span: 1 | 2 | 3;
  bare: boolean;
  Widget: (typeof WIDGET_COMPONENTS)[string];
}

// One global layout: guests get the same order minus admin-only widgets,
// dropped here server-side before their data is ever fetched (an admin
// widget component is never invoked when personal is false).
export default function WidgetBoard({ widgets, personal }: { widgets: string[]; personal: boolean }) {
  const cells: Cell[] = [];
  for (const key of widgets) {
    const meta = widgetMeta(key);
    const Widget = WIDGET_COMPONENTS[key];
    if (!meta || !Widget) continue; // unknown/retired key
    if (meta.access === 'admin' && !personal) continue;
    cells.push({ key, span: meta.span, bare: BARE_KEYS.has(key), Widget });
  }

  return (
    <div className="lobby-widgets">
      {cells.map((c, idx) => (
        <div
          key={c.key}
          className={`lw lw-span${c.span} ${c.bare ? 'lw-bare' : 'lw-card'}`}
          style={{ animationDelay: `${idx * 55}ms` }}
        >
          <c.Widget personal={personal} />
        </div>
      ))}
    </div>
  );
}
