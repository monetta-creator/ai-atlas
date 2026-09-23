import type { ReactNode } from 'react';
import { isAdmin } from '@/lib/auth';
import AdminOnly from '@/components/AdminOnly';

// Kept out of lib/auth.ts on purpose: AdminOnly renders Header, which imports
// lib/auth for isEditMode/isPreview/shareToken, so adminGate living in
// lib/auth.ts would be a straight import cycle (auth -> AdminOnly -> Header ->
// auth). This module is the one server-only place that bridges the two.
export async function adminGate(pathname: string, title: string): Promise<ReactNode | null> {
  if (await isAdmin()) return null;
  return <AdminOnly pathname={pathname} title={title} />;
}
