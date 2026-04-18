# Amari — Interchained Signal Scout

A DevRel and sales signal scout built on top of [`@aiassist-secure/intelligence-mcp`](https://www.npmjs.com/package/@aiassist-secure/intelligence-mcp). It watches Reddit, Hacker News, and other public sources for real-time signals — people asking about MCP servers, BYOK AI infra, lead-gen tooling — drafts warm outreach openers, and exports a PDF report. The operator reviews and sends; the agent surfaces, not closes.

Built as a direct reference implementation of the Signal MCP.

---

## Features

- Scans public sources via the Signal MCP `listen` tool (no browser, no OAuth)
- Dedupes and persists signals to a portable SQLite database (`scout.db`)
- Fully resumable — re-run any command, it picks up exactly where it left off
- Drafts warm, friendly reply starters (≤90 words, no CTA) via AiAS chat completions
- Exports a formatted PDF report: title, link, excerpt, suggested opener per lead
- Lead lifecycle: `new → drafted → exported` (or `ignored` at any point)
- Single `watchlist.yaml` config — no code changes needed to change what it watches

---

## Requirements

- Node.js 18+
- An [AiAssist Secure](https://aiassistsecure.com) account with an `aai_` API key

---

## Setup

```bash
git clone <repo>
cd interchained_scout
npm install

export AIAS_API_KEY=aai_...
export AIAS_PROVIDER=anthropic          # groq | openai | anthropic | gemini | mistral
export AIAS_MODEL=claude-sonnet-4-6     # any model your provider supports
export AIAS_API_BASE_URL=https://api.aiassist.net   # optional, this is the default
```

---

## Usage

```bash
# 1. Scan all watchlist items for fresh signals
node cli.mjs scan

# Scan a single watchlist item with more results
node cli.mjs scan --only=mcp_seekers --limit=40 --verbose

# 2. Draft warm openers for every new lead
node cli.mjs draft

# 3. Review what was found
node cli.mjs list
node cli.mjs list --status=drafted

# 4. Export to PDF
node cli.mjs report
node cli.mjs report --out=./reports/2026-04-18.pdf

# Utility
node cli.mjs stats
node cli.mjs ignore <lead_id>
```

---

## Watchlist

Edit `watchlist.yaml` to change what the scout watches. Each entry is a natural-language query sent to the MCP `listen` tool:

```yaml
watchlist:
  - id: mcp_seekers
    label: People asking for MCP servers
    query: "looking for MCP server OR anyone built an MCP OR model context protocol"
    sources: [reddit, hackernews]
```

No code changes needed — just edit the YAML and re-run `scan`.

---

## How it works

```
watchlist.yaml
     │
     ▼
  scout.mjs ──► @aiassist-secure/intelligence-mcp (stdio)
                        │
                        ▼ listen tool
               api.aiassist.net /v1/intelligence/scan
                        │
                        ▼
                    scout.db (SQLite)
                        │
              ┌─────────┴──────────┐
              ▼                    ▼
          draft.mjs           report.mjs
   (chat completions)        (PDF export)
```

The Signal MCP is spawned over stdio exactly as a third-party integrator would use it — this project is a live reference implementation.

---

## Credits

Designed and built by **Ra** (Replit AI Agent) in collaboration with **Mark Allen Evans**, Interchained LLC.

- [AiAssist.net](https://aiassist.net)
- [AiAssistSecure.com](https://aiassistsecure.com)
- Signal MCP: [`@aiassist-secure/intelligence-mcp`](https://www.npmjs.com/package/@aiassist-secure/intelligence-mcp)

---

## License

MIT — see [LICENSE](./LICENSE).
