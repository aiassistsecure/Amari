#!/usr/bin/env node
// Amari — Interchained Signal Scout — CLI entrypoint.
//
//   node cli.mjs scan              # scan all watchlist items via the MCP
//   node cli.mjs scan --only=mcp_seekers --limit=15 --verbose
//   node cli.mjs draft             # write warm openers for undrafted leads
//   node cli.mjs draft --limit=10
//   node cli.mjs list              # show recent leads
//   node cli.mjs list --status=drafted
//   node cli.mjs report            # export the queue to a PDF
//   node cli.mjs report --out=./reports/today.pdf
//   node cli.mjs stats             # quick counters
//   node cli.mjs ignore <lead_id>  # mark a lead ignored
//
// Env:
//   AIAS_API_KEY        required (the MCP uses it to hit api.aiassist.net)
//   AIAS_API_BASE_URL   optional, defaults to https://api.aiassist.net
//   AIAS_MODEL          optional, override the LLM used for drafts
//   AIAS_PROVIDER       optional, override provider routing for drafts

import { runScout } from "./src/scout.mjs";
import { draftAll } from "./src/draft.mjs";
import { exportReport } from "./src/report.mjs";
import * as db from "./src/db.mjs";

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  cyan: "\x1b[36m", blue: "\x1b[34m", magenta: "\x1b[35m",
  brightCyan: "\x1b[96m", brightYellow: "\x1b[93m", brightWhite: "\x1b[97m",
};

function banner() {
  const art = [
    ` █████╗ ███╗   ███╗ █████╗ ██████╗ ██╗`,
    `██╔══██╗████╗ ████║██╔══██╗██╔══██╗██║`,
    `███████║██╔████╔██║███████║██████╔╝██║`,
    `██╔══██║██║╚██╔╝██║██╔══██║██╔══██╗██║`,
    `██║  ██║██║ ╚═╝ ██║██║  ██║██║  ██║██║`,
    `╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝`,
  ];

  const width = 60;
  const border = `${C.dim}${"═".repeat(width)}${C.reset}`;

  process.stdout.write("\n");
  process.stdout.write(border + "\n");
  for (const line of art) {
    process.stdout.write(`${C.bold}${C.brightCyan}  ${line}${C.reset}\n`);
  }
  process.stdout.write("\n");
  process.stdout.write(
    `${C.dim}  ${"─".repeat(width - 2)}${C.reset}\n`
  );
  process.stdout.write(
    `${C.brightYellow}${C.bold}  Signal Scout · Interchained LLC · aiassist.net${C.reset}\n`
  );
  process.stdout.write(
    `${C.dim}  Powered by @aiassist-secure/intelligence-mcp · MIT License${C.reset}\n`
  );
  process.stdout.write(border + "\n\n");
}

function parseFlags(argv) {
  const flags = {}; const positional = [];
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      flags[k] = v ?? true;
    } else positional.push(a);
  }
  return { flags, positional };
}

function printUsage() {
  process.stdout.write([
    `${C.bold}usage:${C.reset} node cli.mjs <command> [flags]`,
    ``,
    `  ${C.cyan}scan${C.reset}                       pull fresh signals via the MCP listen tool`,
    `    ${C.dim}--only=<id>${C.reset}              run a single watchlist item`,
    `    ${C.dim}--limit=<n>${C.reset}              signals per item  ${C.dim}(default 25)${C.reset}`,
    `    ${C.dim}--verbose${C.reset}                stream MCP server stderr`,
    `  ${C.cyan}draft${C.reset}   ${C.dim}[--limit=<n>]${C.reset}      write warm openers for new leads`,
    `  ${C.cyan}list${C.reset}    ${C.dim}[--status=<s>] [--limit=<n>]${C.reset}`,
    `  ${C.cyan}report${C.reset}  ${C.dim}[--out=<path>] [--statuses=new,drafted]${C.reset}`,
    `  ${C.cyan}stats${C.reset}                      counters + last run`,
    `  ${C.cyan}ignore${C.reset} <lead_id>           exclude a lead from future reports`,
    ``,
  ].join("\n"));
}

const [cmd, ...rest] = process.argv.slice(2);
const { flags, positional } = parseFlags(rest);

banner();

try {
  if (cmd === "scan") {
    const summary = await runScout({
      only: flags.only ?? null,
      limitPerItem: Number(flags.limit ?? 25),
      verbose: !!flags.verbose,
    });
    console.log(`${C.cyan}━━ scan complete ━━${C.reset}`);
    for (const r of summary.runs) {
      if (r.error) console.log(`  ${C.red}✗${C.reset} ${r.id}: ${r.error}`);
      else console.log(`  ${C.green}✓${C.reset} ${r.id}: ${r.signals} signals · ${r.newLeads} new`);
    }
    console.log(`\n${C.bold}total: ${C.brightYellow}${summary.totalNew} new leads${C.reset} ${C.dim}(${summary.totalSignals} signals scanned)${C.reset}`);
  }

  else if (cmd === "draft") {
    const summary = await draftAll({ limit: Number(flags.limit ?? 20) });
    console.log(`${C.cyan}━━ draft complete ━━${C.reset}`);
    console.log(`  ${C.green}drafted${C.reset}:  ${summary.drafted}`);
    if (summary.skipped) console.log(`  ${C.dim}skipped${C.reset}:  ${summary.skipped}`);
    if (summary.errors.length) {
      console.log(`  ${C.red}errors${C.reset}:   ${summary.errors.length}`);
      for (const e of summary.errors.slice(0, 5)) console.log(`    ${C.dim}${e.id}: ${e.error?.slice(0, 100)}${C.reset}`);
    }
  }

  else if (cmd === "list") {
    const conn = db.open();
    const rows = db.listLeads(conn, {
      status: flags.status ?? null,
      limit: Number(flags.limit ?? 25),
    });
    conn.close();
    if (!rows.length) { console.log(`${C.dim}(no leads yet — run: node cli.mjs scan)${C.reset}`); }
    for (const r of rows) {
      const tag = r.status === "drafted"  ? `${C.green}  DRAFTED${C.reset}`
        : r.status === "exported" ? `${C.dim} EXPORTED${C.reset}`
        : r.status === "ignored"  ? `${C.dim}  IGNORED${C.reset}`
        : `${C.brightYellow}      NEW${C.reset}`;
      console.log(`${tag}  ${C.bold}${r.title.slice(0, 88)}${C.reset}`);
      console.log(`           ${C.dim}${r.source}${r.subreddit ? " › r/" + r.subreddit : ""} · ${r.intent ?? "?"} · ${r.url}${C.reset}`);
    }
  }

  else if (cmd === "report") {
    const out = flags.out;
    const statuses = flags.statuses ? String(flags.statuses).split(",") : ["new", "drafted"];
    const path = await exportReport({ outPath: out, statuses });
    console.log(`${C.green}✓ report written${C.reset} → ${C.bold}${path}${C.reset}`);
  }

  else if (cmd === "stats") {
    const conn = db.open();
    const s = db.stats(conn);
    conn.close();
    console.log(`${C.bold}total leads:${C.reset} ${C.brightYellow}${s.total}${C.reset}`);
    for (const row of s.byStatus) {
      console.log(`  ${C.dim}${row.status.padEnd(10)}${C.reset} ${row.n}`);
    }
    console.log(`\n${C.bold}by watchlist:${C.reset}`);
    for (const row of s.byWatchlist) {
      console.log(`  ${C.dim}${row.watchlist_id.padEnd(20)}${C.reset} ${row.n}`);
    }
    if (s.lastRun) {
      console.log(`\n${C.bold}last run:${C.reset} ${s.lastRun.watchlist_id} @ ${C.dim}${s.lastRun.started_at}${C.reset}`);
      console.log(`  signals=${s.lastRun.signals_found}  new=${s.lastRun.leads_added}${s.lastRun.error ? `  ${C.red}error=${s.lastRun.error}${C.reset}` : ""}`);
    }
  }

  else if (cmd === "ignore") {
    const id = positional[0];
    if (!id) { console.error("usage: node cli.mjs ignore <lead_id>"); process.exit(2); }
    const conn = db.open();
    db.setStatus(conn, id, "ignored");
    conn.close();
    console.log(`${C.dim}ignored${C.reset} ${id}`);
  }

  else { printUsage(); process.exit(cmd ? 2 : 0); }
} catch (e) {
  console.error(`${C.red}error:${C.reset} ${e?.message ?? e}`);
  process.exit(1);
}
