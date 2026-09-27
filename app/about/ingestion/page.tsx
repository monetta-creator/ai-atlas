import { redirect } from 'next/navigation';

// Signal ingestion moved into How it works (2026-09-27, the brand pass): its
// sections now live under the "ingestion" anchor there. Stub kept so old
// links and bookmarks still land somewhere useful.
export default function IngestionRedirect() {
  redirect('/about/how-it-works#ingestion');
}
