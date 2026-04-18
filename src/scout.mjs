// Walk the watchlist, ask the MCP `listen` tool for fresh signals, and persist
// new ones as leads. The MCP is the source of truth — we don't touch the
// production REST API directly.
import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import * as db from "./db.mjs";
import { connectMcp, callListen } from "./mcp.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WATCHLIST = resolve(__dirname, "..", "watchlist.yaml");

export function loadWatchlist(path = DEFAULT_WATCHLIST) {
  const doc = yaml.load(readFileSync(path, "utf8")) ?? {};
  return doc.watchlist ?? [];
}

function nowIso() { return new Date().toISOString(); }

function normaliseSignal(raw, watchlistId) {
  // Signal MCP returns an array under `signals`; each item already carries
  // `id`, `source`, `headline`, `url`, `intent`. Older shapes used `title`/
  // `body`; we accept both.
  const id = raw.id ?? raw.signal_id ?? raw.url ?? raw.headline ?? raw.title;
  const source = raw.source ?? "unknown";
  const title = raw.headline ?? raw.title ?? "";
  const body = raw.body ?? raw.content ?? raw.excerpt ?? raw.summary ?? "";
  let posted = raw.posted_at ?? raw.created_at ?? null;
  if (!posted && raw.created_utc) {
    try { posted = new Date(Number(raw.created_utc) * 1000).toISOString(); } catch {}
  }
  return {
    id: String(id).startsWith(`${source}:`) ? String(id) : `${source}:${id}`,
    watchlist_id: watchlistId,
    source,
    subreddit: raw.subreddit ?? null,
    url: raw.url ?? "",
    title: String(title).slice(0, 500),
    excerpt: String(body).slice(0, 400).trim(),
    author: raw.author ?? null,
    score: raw.score ?? null,
    num_comments: raw.num_comments ?? null,
    posted_at: posted,
    captured_at: nowIso(),
    intent: raw.intent ?? (Array.isArray(raw.intents) ? raw.intents[0] : null),
    intent_conf: raw.intent_confidence ?? raw.confidence ?? null,
    match_reason: raw.match_reason ?? raw.reason ?? null,
    raw,
  };
}

export async function runScout({ only = null, limitPerItem = 25, verbose = false } = {}) {
  if (!process.env.AIAS_API_KEY) {
    throw new Error("AIAS_API_KEY env var is required (the MCP needs it to hit the production API).");
  }

  let items = loadWatchlist();
  if (only) {
    items = items.filter(i => i.id === only);
    if (!items.length) throw new Error(`watchlist id '${only}' not found`);
  }

  const conn = db.open();
  const { client, transport } = await connectMcp({ verbose });
  const summary = { runs: [], totalNew: 0, totalSignals: 0 };

  try {
    for (const item of items) {
      const startedAt = nowIso();
      const runId = db.startRun(conn, {
        watchlistId: item.id,
        query: item.query,
        sources: item.sources ?? [],
        startedAt,
      });

      try {
        const result = await callListen(client, {
          query: item.query,
          sources: item.sources,
          limit: limitPerItem,
        });
        const signals = result.signals ?? [];
        let added = 0;
        for (const sig of signals) {
          const lead = normaliseSignal(sig, item.id);
          if (!lead.url || !lead.title) continue;
          if (db.upsertLead(conn, lead)) added++;
        }
        db.finishRun(conn, runId, { finishedAt: nowIso(), signalsFound: signals.length, leadsAdded: added });
        summary.runs.push({ id: item.id, signals: signals.length, newLeads: added });
        summary.totalSignals += signals.length;
        summary.totalNew += added;
      } catch (e) {
        const msg = e?.message ?? String(e);
        db.finishRun(conn, runId, { finishedAt: nowIso(), error: msg });
        summary.runs.push({ id: item.id, error: msg });
      }
    }
  } finally {
    await transport.close().catch(() => {});
    conn.close();
  }

  return summary;
}
