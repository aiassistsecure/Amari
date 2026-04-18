// Boot the published Signal MCP over stdio. Mirrors the test agent pattern
// at mcp_test_agent/agent.mjs so the MCP package is exercised end-to-end the
// same way an external integrator would use it.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve the MCP binary — check the scout-local node_modules first, then
// fall back to the workspace root (where Replit installs shared packages).
import { existsSync } from "node:fs";
function resolveMcpBin() {
  const candidates = [
    resolve(__dirname, "..", "node_modules", "@aiassist-secure", "intelligence-mcp", "dist", "cli.js"),
    resolve(__dirname, "..", "..", "node_modules", "@aiassist-secure", "intelligence-mcp", "dist", "cli.js"),
  ];
  for (const c of candidates) { if (existsSync(c)) return c; }
  throw new Error(`Could not find @aiassist-secure/intelligence-mcp dist/cli.js. Run: npm install @aiassist-secure/intelligence-mcp`);
}
const MCP_BIN = resolveMcpBin();

export async function connectMcp({ verbose = false } = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    env: {
      ...process.env,
      ...(process.env.AIAS_API_KEY ? { AIAS_API_KEY: process.env.AIAS_API_KEY } : {}),
      ...(process.env.AIAS_API_BASE_URL ? { AIAS_API_BASE_URL: process.env.AIAS_API_BASE_URL } : {}),
    },
    stderr: "pipe",
  });

  const client = new Client(
    { name: "amari-signal-scout", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);

  if (verbose && transport.stderr) {
    transport.stderr.on("data", (chunk) => {
      const line = chunk.toString().trim();
      if (line) process.stderr.write(`[mcp] ${line}\n`);
    });
  }

  return { client, transport };
}

export function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export async function callListen(client, { query, sources, limit = 25, freshness, minEngagement }) {
  // Per the MCP listen schema, `sources`, `freshness`, and `min_engagement`
  // live INSIDE a `scope` object. `query` and `limit` are top-level.
  const args = { query, limit: Math.min(100, Math.max(1, limit)) };
  const scope = {};
  if (sources && sources.length) scope.sources = sources;
  if (freshness) scope.freshness = freshness;
  if (Number.isFinite(minEngagement)) scope.min_engagement = minEngagement;
  if (Object.keys(scope).length) args.scope = scope;

  const r = await client.callTool({ name: "listen", arguments: args });
  const text = r.content?.map(c => c.text).filter(Boolean).join("\n") ?? "";
  return safeJson(text) ?? { signals: [] };
}

export async function readResource(client, uri) {
  const r = await client.readResource({ uri });
  return r.contents?.[0]?.text ?? "";
}
