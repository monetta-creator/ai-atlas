import { redirect } from 'next/navigation';

// How Ask finds things moved into How it works (2026-09-27, the brand pass):
// its sections now live under the "retrieval" anchor there. Stub kept so old
// links and bookmarks still land somewhere useful.
export default function RetrievalRedirect() {
  redirect('/about/how-it-works#retrieval');
}
