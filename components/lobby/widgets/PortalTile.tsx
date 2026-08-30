import Link from 'next/link';
import { PORTAL_ICONS } from '@/components/portal-icons';

// The seven portal tiles, now board widgets rather than a hardcoded grid.
// Pure and data-free: registry.tsx curries this per tile-* catalog key with
// its route, icon, and catalog copy. Renders its own chrome (`.lobby-tile`,
// unchanged from the pre-widget-board lobby) since WidgetBoard marks these
// "bare" and skips the shared `.lw-card` wrapper.
export default function PortalTile({
  href, iconKey, name, desc,
}: {
  href: string;
  iconKey: keyof typeof PORTAL_ICONS;
  name: string;
  desc: string;
}) {
  return (
    <Link href={href} className="lobby-tile">
      <span className="lobby-tile-head">
        {PORTAL_ICONS[iconKey]}
        <span className="lobby-tile-name">{name}</span>
      </span>
      <span className="lobby-tile-desc">{desc}</span>
    </Link>
  );
}
