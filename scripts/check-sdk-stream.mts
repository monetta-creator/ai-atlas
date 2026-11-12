// Landmine re-check after an SDK upgrade (lib/ask/CLAUDE.md): does
// messages.stream(...).finalMessage() keep server-tool blocks
// (server_tool_use, web_search_tool_result) and citations, or collapse them
// to bare text as the 0.100.1 accumulator did? Also counts the same blocks in
// the raw events, which is what the deep route reads. One live call on the
// deep route's model with web search (about a cent).
// Run: npx -y tsx scripts/check-sdk-stream.mts
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
dotenv.config({ path: '.env.local', quiet: true });

const client = new Anthropic();
const rawStarts: string[] = [];
const stream = client.messages.stream({
  model: 'claude-haiku-4-5',
  max_tokens: 800,
  tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 } as unknown as Anthropic.Tool],
  messages: [{ role: 'user', content: 'Search the web once: what did IDC say about AI infrastructure spending in Q2 2026? One sentence.' }],
});
stream.on('streamEvent', (e) => {
  if (e.type === 'content_block_start') rawStarts.push(e.content_block.type);
});
const final = await stream.finalMessage();
const finalTypes = final.content.map((b) => b.type);
const keeps = finalTypes.includes('web_search_tool_result') && finalTypes.includes('server_tool_use');
console.log(JSON.stringify({ rawStarts, finalTypes, accumulatorKeepsServerTools: keeps, usage: final.usage }));
process.exit(0);
