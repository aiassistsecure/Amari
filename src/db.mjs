// Single-file SQLite store. Portable: copy scout.db anywhere, it just works.
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = resolve(__dirname, "..", "scout.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  watchlist_id  TEXT NOT NULL,
  query         TEXT NOT NULL,
  sources       TEXT NOT NULL,
  signals_found INTEGER DEFAULT 0,
  leads_added   INTEGER DEFAULT 0,
  error         TEXT
);

CREATE TABLE IF NOT EXISTS leads (
  id           TEXT PRIMARY KEY,
  watchlist_id TEXT NOT NULL,
  source       TEXT NOT NULL,
  subreddit    TEXT,
  url          TEXT NOT NULL,
  title        TEXT NOT NULL,
  excerpt      TEXT,
  author       TEXT,
  score        INTEGER,
  num_comments INTEGER,
  posted_at    TEXT,
  captured_at  TEXT NOT NULL,
  intent       TEXT,
  intent_conf  REAL,
  match_reason TEXT,
  status       TEXT DEFAULT 'new',
  raw          TEXT
);

CREATE TABLE IF NOT EXISTS drafts (
  lead_id    TEXT PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  model      TEXT,
  provider   TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_captured ON leads(captured_at);
CREATE INDEX IF NOT EXISTS idx_runs_started   ON runs(started_at);
`;

export function open(path = DEFAULT_DB_PATH) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

// ─── runs ───────────────────────────────────────────────────────────────────

export function startRun(db, { watchlistId, query, sources, startedAt }) {
  const info = db.prepare(
    `INSERT INTO runs (started_at, watchlist_id, query, sources) VALUES (?, ?, ?, ?)`,
  ).run(startedAt, watchlistId, query, sources.join(","));
  return Number(info.lastInsertRowid);
}

export function finishRun(db, id, { finishedAt, signalsFound = 0, leadsAdded = 0, error = null }) {
  db.prepare(
    `UPDATE runs SET finished_at=?, signals_found=?, leads_added=?, error=? WHERE id=?`,
  ).run(finishedAt, signalsFound, leadsAdded, error, id);
}

// ─── leads ──────────────────────────────────────────────────────────────────

export function upsertLead(db, lead) {
  const exists = db.prepare(`SELECT 1 FROM leads WHERE id = ?`).get(lead.id);
  if (exists) return false;
  db.prepare(
    `INSERT INTO leads
     (id, watchlist_id, source, subreddit, url, title, excerpt, author,
      score, num_comments, posted_at, captured_at, intent, intent_conf,
      match_reason, status, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
  ).run(
    lead.id, lead.watchlist_id, lead.source, lead.subreddit ?? null,
    lead.url, lead.title, lead.excerpt ?? null, lead.author ?? null,
    lead.score ?? null, lead.num_comments ?? null, lead.posted_at ?? null,
    lead.captured_at, lead.intent ?? null, lead.intent_conf ?? null,
    lead.match_reason ?? null, JSON.stringify(lead.raw ?? {}),
  );
  return true;
}

export function listLeads(db, { status = null, limit = 100 } = {}) {
  if (status) {
    return db.prepare(`SELECT * FROM leads WHERE status = ? ORDER BY captured_at DESC LIMIT ?`).all(status, limit);
  }
  return db.prepare(`SELECT * FROM leads ORDER BY captured_at DESC LIMIT ?`).all(limit);
}

export function leadsNeedingDraft(db, limit = 50) {
  return db.prepare(
    `SELECT l.* FROM leads l LEFT JOIN drafts d ON d.lead_id = l.id
     WHERE l.status = 'new' AND d.lead_id IS NULL
     ORDER BY l.captured_at DESC LIMIT ?`,
  ).all(limit);
}

export function setStatus(db, id, status) {
  db.prepare(`UPDATE leads SET status = ? WHERE id = ?`).run(status, id);
}

// ─── drafts ─────────────────────────────────────────────────────────────────

export function saveDraft(db, { leadId, body, model, provider, createdAt }) {
  db.prepare(
    `INSERT INTO drafts (lead_id, body, model, provider, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(lead_id) DO UPDATE SET
       body = excluded.body, model = excluded.model,
       provider = excluded.provider, created_at = excluded.created_at`,
  ).run(leadId, body, model ?? null, provider ?? null, createdAt);
  db.prepare(`UPDATE leads SET status = 'drafted' WHERE id = ? AND status = 'new'`).run(leadId);
}

export function leadsWithDrafts(db, statuses = ["drafted"]) {
  const placeholders = statuses.map(() => "?").join(",");
  return db.prepare(
    `SELECT l.*, d.body AS draft_body, d.model AS draft_model, d.provider AS draft_provider
     FROM leads l LEFT JOIN drafts d ON d.lead_id = l.id
     WHERE l.status IN (${placeholders})
     ORDER BY l.captured_at DESC`,
  ).all(...statuses);
}

// ─── stats ──────────────────────────────────────────────────────────────────

export function stats(db) {
  const total = db.prepare(`SELECT COUNT(*) AS n FROM leads`).get().n;
  const byStatus = db.prepare(`SELECT status, COUNT(*) AS n FROM leads GROUP BY status`).all();
  const byWatchlist = db.prepare(`SELECT watchlist_id, COUNT(*) AS n FROM leads GROUP BY watchlist_id`).all();
  const lastRun = db.prepare(`SELECT * FROM runs ORDER BY started_at DESC LIMIT 1`).get();
  return { total, byStatus, byWatchlist, lastRun };
}
