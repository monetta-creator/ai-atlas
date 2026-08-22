import Anthropic from '@anthropic-ai/sdk';

// The one place the app builds an Anthropic client (server-only). The corporate
// deployment points the SDK at an internal gateway via ANTHROPIC_BASE_URL; the
// models are configurable the same way so an endpoint swap needs no code change.
//
// Fail-soft contract: aiConfigured() lets a surface degrade gracefully (hide or
// disable its AI affordance); makeAnthropic() throws a single, plain-language
// error when the key is missing so every AI action reports the same fixable
// message instead of a stack trace.

// The default model for structured analysis calls (dossier, pipeline, reports).
export const AI_MODEL = process.env.ATLAS_AI_MODEL || 'claude-sonnet-4-6';
// The fast/cheap model for chat surfaces (ask, per-signal ask, portal ask).
export const AI_FAST_MODEL = process.env.ATLAS_AI_FAST_MODEL || 'claude-haiku-4-5';

export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function makeAnthropic(opts: { timeout?: number; maxRetries?: number } = {}): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'AI is not configured: set ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL for a gateway) to enable the AI features. Everything else works without it.'
    );
  }
  return new Anthropic({
    apiKey,
    ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
    ...(opts.timeout != null ? { timeout: opts.timeout } : {}),
    ...(opts.maxRetries != null ? { maxRetries: opts.maxRetries } : {}),
  });
}
