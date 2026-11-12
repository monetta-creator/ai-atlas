// Prints the MCP admin bearer token for THIS environment's AUTH_SECRET
// (local differs from production). Local only; never commit or paste it.
// Run: npx -y tsx scripts/mcp-token.mts
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
const { mcpAdminToken } = await import('../lib/mcp/auth');
process.stdout.write(`${mcpAdminToken()}\n`);
