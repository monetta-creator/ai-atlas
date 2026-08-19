import { redirect } from 'next/navigation';

// Retired 2026-08-13 (lobby redesign): the media-landscape dashboard is gone.
// Its evidence-shape story lives in the reports and the source library now;
// old links land softly on the News Blotter.
export default function LandscapeRedirect() {
  redirect('/blotter');
}
