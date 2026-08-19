import { redirect } from 'next/navigation';

// Retired 2026-08-14 (Report Portal integration): the period-report generator moved
// into the portal at /reports/period. Old links land there, controls intact.
export default async function ReportRedirect({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; lenses?: string }>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (sp.from) qs.set('from', sp.from);
  if (sp.to) qs.set('to', sp.to);
  if (sp.lenses) qs.set('lenses', sp.lenses);
  redirect(qs.size > 0 ? `/reports/period?${qs}` : '/reports/period');
}
