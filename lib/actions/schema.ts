'use server';

import { revalidatePath } from 'next/cache';
import { applyPendingMigrations, type MigrationRun } from '../migrations';
import { requireAdmin } from './shared';

// Apply the deploy's pending migrations from the app (lib/migrations.ts).
// Admin only; failures return as data because production redacts thrown
// messages from server actions.
export async function applyPendingMigrationsAction(): Promise<MigrationRun | { error: string }> {
  await requireAdmin();
  try {
    const run = await applyPendingMigrations();
    revalidatePath('/', 'layout');
    return run;
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not apply migrations.' };
  }
}
