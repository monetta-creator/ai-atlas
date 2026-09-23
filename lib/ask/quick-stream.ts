import type Anthropic from '@anthropic-ai/sdk';
import { priceUsage, recordApiCall } from '@/lib/cost';
import { deDash } from '@/lib/voice';
import { createWebSourceCollector, encodeCostReport, encodeWebSources } from '@/lib/ask/history';

// The quick-answer stream leg shared by /api/ask, /api/portal/ask and the
// per-signal /api/signals/[id]/ask: one streamed Haiku call whose text deltas
// ride out as plain text, followed by the cost sentinel line, then (web on)
// the web-sources sentinel line. Each route keeps its own gate, budget check,
// lane resolution and headers, and ends with `new Response(streamQuickAnswer(...))`.

export function streamQuickAnswer(args: {
  client: Anthropic;
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  useWeb: boolean;
  feature: string;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}): ReadableStream<Uint8Array> {
  const { client, model, system, messages, useWeb, feature, maxTokens = 1500, metadata } = args;
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const t0 = Date.now();
      try {
        const params = {
          model,
          max_tokens: maxTokens,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages,
          // The raw web-search tool object is not in the SDK Tool union, hence
          // the double-cast below (the lib/pipeline/web.ts pattern).
          ...(useWeb
            ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] }
            : {}),
        };
        const ms = client.messages.stream(
          params as unknown as Parameters<typeof client.messages.stream>[0]
        );
        // Cited web sources are captured from the RAW stream events, not from
        // finalMessage(): the pinned SDK's stream accumulator predates
        // server-tool blocks and drops both the tool results and the citations.
        const collector = createWebSourceCollector(3);
        if (useWeb) ms.on('streamEvent', (ev) => { collector.fromStreamEvent(ev); });
        // Enforce the house no-em-dash rule on live output (Haiku occasionally
        // slips one in despite the prompt). En dashes (ranges, nulls) are left alone.
        ms.on('text', (delta) => controller.enqueue(enc.encode(deDash(delta))));
        const final = await ms.finalMessage();
        // The per-turn cost line rides a trailing sentinel BEFORE the
        // web-sources one (extractWebSources parses to end of string, so its
        // line must stay last); the client strips both.
        const usage = final.usage as {
          input_tokens?: number | null; output_tokens?: number | null;
          cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null;
          server_tool_use?: { web_search_requests?: number | null } | null;
        };
        const costUsd = await priceUsage(model, final.usage);
        controller.enqueue(enc.encode(encodeCostReport({
          cost_usd: costUsd,
          input_tokens:
            (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
          output_tokens: usage.output_tokens ?? 0,
          cache_read_tokens: usage.cache_read_input_tokens ?? 0,
          searches: Math.max(usage.server_tool_use?.web_search_requests ?? 0, 0),
          rounds: 1,
          model,
        })));
        if (useWeb) {
          // Belt and braces: merge anything a future SDK's accumulator sees.
          collector.fromMessage(final);
          const list = collector.list();
          if (list.length) controller.enqueue(enc.encode(encodeWebSources(list.slice(0, 8))));
        }
        await recordApiCall({ feature, model, usage: final.usage, wallMs: Date.now() - t0, metadata });
      } catch {
        controller.enqueue(enc.encode('\n\nThe answer could not be completed. Please try again.'));
      } finally {
        controller.close();
      }
    },
  });
}
