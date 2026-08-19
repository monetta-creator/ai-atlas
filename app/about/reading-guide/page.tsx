import { redirect } from 'next/navigation';

// The reading guide was deleted 2026-08-15 (its legend content overlapped the
// glossary and the in-app badges). Stub kept so old links land on About.
export default function ReadingGuideRedirect() {
  redirect('/about');
}
