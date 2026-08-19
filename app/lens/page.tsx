import { redirect } from 'next/navigation';

// Retired 2026-08-13 (lobby redesign): the lens hub and per-lens map views are
// gone. Lens tagging itself lives on (node_lenses, the /data tagger); old links
// land on the Argument Map.
export default function LensRedirect() {
  redirect('/map');
}
