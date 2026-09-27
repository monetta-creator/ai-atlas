import { redirect } from 'next/navigation';

// Limitations was renamed and extended into Where it fails (2026-09-27, the
// brand pass). Stub kept so old links and bookmarks still land somewhere
// useful.
export default function LimitationsRedirect() {
  redirect('/about/where-it-fails');
}
