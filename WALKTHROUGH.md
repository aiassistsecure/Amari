# Amari Walkthrough

A step-by-step guide to running your first signal scan, drafting outreach, and exporting a PDF report.

---

## Prerequisites

- Node.js 18+
- An AiAssist Secure account — grab your API key from the dashboard (`aai_...`)
- The repo cloned and deps installed:

```bash
git clone https://github.com/aiassistsecure/Amari
cd amari
npm install
```

---

## Step 1 — Set your environment

Amari needs three env vars. Set them in your shell or drop them in a `.env` loader of your choice:

```bash
export AIAS_API_KEY=aai_your_key_here
export AIAS_PROVIDER=anthropic          # or: groq | openai | gemini | mistral
export AIAS_MODEL=claude-sonnet-4-6     # any model your provider supports
```

`AIAS_API_BASE_URL` defaults to `https://api.aiassist.net` — only set it if you're pointing at a self-hosted instance.

---

## Step 2 — Review the watchlist

Open `watchlist.yaml`. This is the only file you need to edit to control what Amari watches:

```yaml
watchlist:
  - id: mcp_seekers
    label: People asking for MCP servers
    query: "looking for MCP server OR anyone built an MCP OR model context protocol"
    sources: [reddit, hackernews]
```

Each entry is a natural-language query sent directly to the Signal MCP `listen` tool. Add, remove, or reword entries freely — no code changes needed.

**Tips for good queries:**
- Use `OR` to widen the net: `"BYOK AI OR bring your own key OR multi-provider LLM"`
- Be specific enough to filter noise but not so narrow you miss signals
- Keep `sources` to `[reddit, hackernews]` for best RSS-only coverage

---

## Step 3 — Run your first scan

```bash
node cli.mjs scan
```

Amari boots the Signal MCP over stdio, calls `listen` for each watchlist item, and writes new signals to `scout.db`. Re-running is safe — duplicates are automatically filtered by signal ID.

**Scan a single item while you're tuning queries:**
```bash
node cli.mjs scan --only=mcp_seekers --limit=40
```

**Watch what the MCP is doing under the hood:**
```bash
node cli.mjs scan --verbose
```

---

## Step 4 — Review what was found

```bash
node cli.mjs list
```

Shows the most recent 25 leads with status, source, detected intent, and URL. Filter by status:

```bash
node cli.mjs list --status=new
node cli.mjs list --status=drafted --limit=50
```

**Lead statuses:**

| Status | Meaning |
|--------|---------|
| `new` | Just found, no draft yet |
| `drafted` | Warm opener written, ready to review |
| `exported` | Included in a PDF report |
| `ignored` | Manually excluded, won't appear in reports |

---

## Step 5 — Draft warm openers

```bash
node cli.mjs draft
```

For every `new` lead without a draft, Amari sends the title, excerpt, and detected intent to your configured LLM and gets back a ≤90-word warm starter reply. The drafts are stored in `scout.db` alongside each lead.

**What the drafts are for:**  
These are starter lines — not copy-paste ready sends. You review, edit to your voice, then hit the URL and reply yourself. Amari surfaces, you close.

Draft a smaller batch while testing:
```bash
node cli.mjs draft --limit=5
```

---

## Step 6 — Export the report

```bash
node cli.mjs report
```

Generates a PDF with every `new` and `drafted` lead. Each block contains:
- Title and source metadata
- Link (clickable in PDF readers)
- Excerpt from the original post
- Suggested opener (if drafted)

Save to a specific path:
```bash
node cli.mjs report --out=./reports/2026-04-18.pdf
```

Include exported leads too:
```bash
node cli.mjs report --statuses=new,drafted,exported
```

After export, `drafted` leads are automatically marked `exported` so they don't clutter your next run.

---

## Step 7 — Ignore noise

If a lead isn't relevant, mark it so it disappears from future reports:

```bash
node cli.mjs ignore "reddit:https://reddit.com/..."
```

Use the exact `id` value shown in `node cli.mjs list`. Ignored leads stay in the database but are excluded from all reports and draft runs.

---

## Step 8 — Check your stats

```bash
node cli.mjs stats
```

Shows total leads, breakdown by status, breakdown by watchlist item, and a summary of the last scan run.

---

## Suggested daily rhythm

```bash
# Morning: pull overnight signals and draft openers
node cli.mjs scan
node cli.mjs draft

# Review the list, ignore anything irrelevant
node cli.mjs list

# Export your report when you're ready to work the queue
node cli.mjs report --out=./reports/$(date +%F).pdf
```

Open the PDF, work down the list, paste each opener into the post's comment thread and personalise before sending.

---

## Data and portability

All data lives in `scout.db` (SQLite, single file). Copy it anywhere — it's self-contained. Nothing is stored remotely. `scout.db` is in `.gitignore` so your lead queue stays private.

---

## Troubleshooting

**`AIAS_API_KEY env var is required`**  
You haven't exported your key. Run `export AIAS_API_KEY=aai_...` first.

**`scan` returns 0 new leads**  
Either the signals already exist in `scout.db` (deduped) or the query is too narrow. Try `--verbose` to see what the MCP is returning, and widen your query in `watchlist.yaml`.

**`draft` skips leads**  
A lead is skipped if the LLM returns an empty response. Retry with `node cli.mjs draft` — it only touches leads that still need drafts.

**`Could not find @aiassist-secure/intelligence-mcp`**  
Run `npm install` from inside `interchained_scout/`.

---

## Credits

Built by **Ra** (Replit AI Agent) and **Mark Allen Evans**, Interchained LLC.  
[aiassist.net](https://aiassist.net) · [aiassistsecure.com](https://aiassistsecure.com)  
Signal MCP: [`@aiassist-secure/intelligence-mcp`](https://www.npmjs.com/package/@aiassist-secure/intelligence-mcp)
