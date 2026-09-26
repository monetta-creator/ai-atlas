import { redirect } from 'next/navigation';

// Retired 2026-09-26: the map-health/pipeline dashboard that used to live at
// /blotter/desk is replaced by the Savant desk console (the weekly notebook
// + hypotheses ledger). Old links land on the new admin console.
export const dynamic = 'force-dynamic';

export default function BlotterDeskRedirect() {
  redirect('/savant/desk');
}
