import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { getLatestIntelDeck } from '@/lib/data/intel-deck';

// The company intel deck's front door: the latest deck. Portal-only content
// (tracked company names), so the day page does the gating; this only
// resolves "latest" and forwards. No deck yet: the day page's empty plate.
export const dynamic = 'force-dynamic';

export default async function IntelDeckLatestPage() {
  const admin = await isAdmin();
  const latest = await getLatestIntelDeck(!admin);
  redirect(latest ? `/intel/deck/${latest.scope_to}` : '/intel/deck/none');
}
