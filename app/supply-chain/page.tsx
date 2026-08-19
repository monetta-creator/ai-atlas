import { redirect } from 'next/navigation';

// Demoted 2026-08-13 (lobby redesign): the supply-chain map page is off the nav.
// The data layer stays (lib/supply-chain feeds /traceroute's risk chips), and the
// components remain in the tree for an easy revival; old links land on Traceroute.
export default function SupplyChainRedirect() {
  redirect('/traceroute');
}
