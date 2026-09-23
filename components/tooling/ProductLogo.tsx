'use client';

import EntityLogo from '@/components/EntityLogo';

// The tooling catalog's vendor mark, now the shared EntityLogo (components/
// EntityLogo.tsx, pure helpers in lib/logo.ts) with its original props.
export { logoSource } from '@/lib/logo';

export default function ProductLogo({
  name, domain, url, size = 28,
}: {
  name: string;
  domain: string | null;
  url: string | null;
  size?: number;
}) {
  return <EntityLogo name={name} domain={domain} url={url} size={size} />;
}
