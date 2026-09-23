import type { ReactNode } from 'react';
import { isAdmin } from '@/lib/auth';
import AdminOnly from '@/components/AdminOnly';

// Kept out of lib/auth.ts on purpose: this returns a React element (a .tsx
// concern), and lib/auth.ts stays a plain, JSX-free module of cookie/HMAC
// helpers. This is the one server-only place that pairs isAdmin() with the
// AdminOnly notice.
export async function adminGate(pathname: string, title: string): Promise<ReactNode | null> {
  if (await isAdmin()) return null;
  return <AdminOnly pathname={pathname} title={title} />;
}
