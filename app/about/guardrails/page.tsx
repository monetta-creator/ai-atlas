import { redirect } from 'next/navigation';

// Guardrails moved into How it works (2026-09-27, the brand pass): its
// sections now live under the "guardrails" anchor there. Stub kept so old
// links and bookmarks still land somewhere useful.
export default function GuardrailsRedirect() {
  redirect('/about/how-it-works#guardrails');
}
