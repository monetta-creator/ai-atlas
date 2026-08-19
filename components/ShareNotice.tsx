import { asOfLabel } from '@/lib/format';

// The calm, consistent "this is the share view" notice shown to guests (and to an
// admin previewing as a guest) across the public pages. Reuses the .guestnote style.
export default function ShareNotice({ asOf }: { asOf?: string | null }) {
  const when = asOf ? asOfLabel(asOf) : null;
  return (
    <div className="guestnote" style={{ display: 'flex' }}>
      ◷ Share view{when ? `, as of ${when}` : ''}: confidence, rationales and priors are hidden.
      The questions, stances, claims, tests and evidence stay visible.
    </div>
  );
}
