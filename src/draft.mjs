// Drafts a warm, friendly opener for each undrafted lead. The agent is NOT
// the closer — drafts are starter lines, surfacing value, not pitching.
import * as db from "./db.mjs";

const SYSTEM_PROMPT = [
  "You are a warm, friendly DevRel scout drafting a starter reply for the",
  "operator (a human) to send themselves. The operator will edit and send;",
  "you are NOT closing the deal.",
  "",
  "Rules:",
  "- ≤ 90 words, plain English, conversational.",
  "- Open by acknowledging what the person actually said. No 'Hey there!'.",
  "- Add ONE concrete observation or question that helps them — value first.",
  "- Mention Signal MCP / Interchained ONLY if it naturally fits. Never sell.",
  "- No emojis. No 'feel free to'. No 'happy to chat'. No CTAs.",
  "- End with a single low-pressure offer or open question.",
  "- Output the draft body only. No preamble, no quotes, no signature.",
].join("\n");

function userPrompt(lead) {
  return [
    `SOURCE: ${lead.source}${lead.subreddit ? ` / r/${lead.subreddit}` : ""}`,
    `TITLE: ${lead.title}`,
    lead.excerpt ? `EXCERPT: ${lead.excerpt}` : "",
    lead.intent ? `DETECTED INTENT: ${lead.intent}` : "",
    lead.match_reason ? `WHY THIS MATCHED: ${lead.match_reason}` : "",
    "",
    "Draft a warm starter reply per the rules.",
  ].filter(Boolean).join("\n");
}

async function chatCompletion({ messages }) {
  const base = (process.env.AIAS_API_BASE_URL ?? "https://api.aiassist.net").replace(/\/$/, "");
  const key = process.env.AIAS_API_KEY;
  if (!key) throw new Error("AIAS_API_KEY env var is required");
  const provider = process.env.AIAS_PROVIDER;
  const model = process.env.AIAS_MODEL;

  const body = {
    messages,
    temperature: 0.6,
    max_tokens: 240,
    ...(model ? { model } : {}),
  };
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(provider ? { "x-AiAssist-provider": provider } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`chat-completions ${res.status}: ${text.slice(0, 300)}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`non-JSON response: ${text.slice(0, 200)}`); }
  return {
    content: json.choices?.[0]?.message?.content?.trim() ?? "",
    model: json.model ?? model ?? null,
    provider: provider ?? null,
  };
}

export async function draftAll({ limit = 20 } = {}) {
  const conn = db.open();
  const summary = { drafted: 0, skipped: 0, errors: [] };
  try {
    const pending = db.leadsNeedingDraft(conn, limit);
    for (const lead of pending) {
      try {
        const out = await chatCompletion({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt(lead) },
          ],
        });
        if (!out.content) { summary.skipped++; continue; }
        db.saveDraft(conn, {
          leadId: lead.id,
          body: out.content,
          model: out.model,
          provider: out.provider,
          createdAt: new Date().toISOString(),
        });
        summary.drafted++;
      } catch (e) {
        summary.errors.push({ id: lead.id, error: e?.message ?? String(e) });
      }
    }
  } finally {
    conn.close();
  }
  return summary;
}
