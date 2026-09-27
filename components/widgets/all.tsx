import { HOME_WIDGET_COMPONENTS, type WidgetComponent } from '@/components/lobby/widgets/registry';
import { OPS_WIDGET_COMPONENTS } from '@/components/ops/widgets/registry';

// Every board widget, key -> component: the lobby's and the ops board's
// registries merged for WidgetBoard. The catalog (lib/widgets/catalog.ts)
// decides which board a key may sit on; this only resolves the component.
export const WIDGET_COMPONENTS: Record<string, WidgetComponent> = {
  ...HOME_WIDGET_COMPONENTS,
  ...OPS_WIDGET_COMPONENTS,
};
