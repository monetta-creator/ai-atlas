import { encode, decode } from 'gpt-tokenizer/encoding/o200k_base';

// Tokenize a reader's sentence for the Traceroute walkthrough.
//
// This exists because the vocabulary is the expensive part of a BPE tokenizer: o200k_base is
// about 1MB gzipped, which is far too much to push at someone the moment they start typing.
// Running it here costs the client nothing and guarantees the ids match the ones the curated
// runs were authored with (scripts/author-run.mjs pins the same encoding).
//
// Deliberately NOT an LLM call. This is pure string processing: no model, no DB, no auth, no
// cost log. The app's property that no public surface can trigger an Anthropic call (see the
// explicit isAdmin gate on app/api/ask/route.ts) is preserved.
//
// Guardrails are the input bound and nothing else, which is all a CPU-only endpoint over a
// capped string needs.

export const dynamic = 'force-dynamic';

/** Long enough for a sentence, short enough that the work is always trivial. */
const MAX_CHARS = 240;
/** A hard ceiling on the response regardless of how the encoder behaves. */
const MAX_TOKENS = 128;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Expected JSON.' }, { status: 400 });
  }

  const text = (body as { text?: unknown } | null)?.text;
  if (typeof text !== 'string') {
    return Response.json({ error: 'Expected a "text" string.' }, { status: 400 });
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return Response.json({ error: 'Nothing to tokenize.' }, { status: 400 });
  }
  if (trimmed.length > MAX_CHARS) {
    return Response.json(
      { error: `Keep it under ${MAX_CHARS} characters.` },
      { status: 413 }
    );
  }

  const ids = encode(trimmed).slice(0, MAX_TOKENS);
  const tokens = ids.map((id) => ({ id, text: decode([id]) }));

  return Response.json(
    { text: trimmed, tokens },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
