import { redirect } from 'next/navigation';

// The team Ask surface moved to the unified workspace at /ask; this stub keeps
// every previously shared /datasets/ask link working.
export const dynamic = 'force-dynamic';

export default function DatasetsAskRedirect(): never {
  redirect('/ask');
}
