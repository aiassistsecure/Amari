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

function pickStr(v) {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return null;
}

function pickInt(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function normaliseSignal(raw, watchlistId) {
  // Handles the v0.1.3 Signal MCP shape:
  //   { id, source, url, headline, excerpt, intent, intent_confidence,
  //     match_reason, author: { handle, karma_bucket },
  //     engagement: { score, comments }, captured_at, freshness_bucket }
  // Plus older flat shapes for backwards compat.
  const id = raw.id ?? raw.signal_id ?? raw.url ?? raw.headline ?? raw.title;
  const source = pickStr(raw.source) ?? "unknown";
  const title = raw.headline ?? raw.title ?? "";
  const body = raw.excerpt ?? raw.body ?? raw.content ?? raw.summary ?? "";

  // author can be a string (legacy) or an object { handle, karma_bucket }
  let author = null;
  if (typeof raw.author === "string") author = raw.author;
  else if (raw.author && typeof raw.author === "object") author = pickStr(raw.author.handle ?? raw.author.name ?? raw.author.username);

  // engagement nests score / comments in v0.1.3
  const score = pickInt(raw.engagement?.score ?? raw.score);
  const numComments = pickInt(raw.engagement?.comments ?? raw.num_comments ?? raw.comments);

  let posted = pickStr(raw.posted_at ?? raw.created_at);
  if (!posted && raw.created_utc) {
    try { posted = new Date(Number(raw.created_utc) * 1000).toISOString(); } catch {}
  }

  return {
    id: String(id).startsWith(`${source}:`) ? String(id) : `${source}:${id}`,
    watchlist_id: watchlistId,
    source,
    subreddit: pickStr(raw.subreddit),
    url: pickStr(raw.url) ?? "",
    title: String(title).slice(0, 500),
    excerpt: String(body).slice(0, 400).trim(),
    author,
    score,
    num_comments: numComments,
    posted_at: posted,
    captured_at: pickStr(raw.captured_at) ?? nowIso(),
    intent: pickStr(raw.intent ?? (Array.isArray(raw.intents) ? raw.intents[0] : null)),
    intent_conf: Number.isFinite(Number(raw.intent_confidence ?? raw.confidence)) ? Number(raw.intent_confidence ?? raw.confidence) : null,
    match_reason: pickStr(raw.match_reason ?? raw.reason),
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
          freshness: item.freshness,
          minEngagement: item.min_engagement,
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
