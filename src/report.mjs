// PDF export of the current scout queue. Each lead = one block: title,
// metadata strip, link, excerpt, suggested opener.
import PDFDocument from "pdfkit";
import { createWriteStream } from "node:fs";
import { resolve } from "node:path";

import * as db from "./db.mjs";

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.valueOf()) ? iso : d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export async function exportReport({
  outPath = resolve(process.cwd(), `scout-report-${Date.now()}.pdf`),
  statuses = ["new", "drafted"],
} = {}) {
  const conn = db.open();
  const leads = db.leadsWithDrafts(conn, statuses);
  conn.close();

  return await new Promise((resolveP, rejectP) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 54, info: {
      Title: "Interchained Signal Scout Report",
      Author: "Interchained LLC",
      Subject: "Signals surfaced via @aiassist-secure/intelligence-mcp",
    } });
    const stream = createWriteStream(outPath);
    doc.pipe(stream);

    // ── Cover ────────────────────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(22).fillColor("#111").text("Signal Scout Report");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10).fillColor("#555")
      .text(`Interchained LLC · @aiassist-secure/intelligence-mcp`)
      .text(`Generated ${formatDate(new Date().toISOString())}`)
      .text(`${leads.length} signal${leads.length === 1 ? "" : "s"} in queue (${statuses.join(", ")})`);

    doc.moveDown(0.8);
    doc.strokeColor("#ddd").lineWidth(0.5)
      .moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
    doc.moveDown(0.8);

    if (!leads.length) {
      doc.font("Helvetica-Oblique").fontSize(11).fillColor("#666")
        .text("No signals in queue. Run `node cli.mjs scan` first.");
      doc.end();
      stream.on("finish", () => resolveP(outPath));
      stream.on("error", rejectP);
      return;
    }

    // ── Per-lead blocks ──────────────────────────────────────────────────
    leads.forEach((lead, i) => {
      if (i > 0) doc.moveDown(1.2);

      // Keep each block on one page when possible.
      if (doc.y > doc.page.height - 220) doc.addPage();

      doc.font("Helvetica-Bold").fontSize(13).fillColor("#0b2545")
        .text(`${i + 1}. ${lead.title}`, { paragraphGap: 4 });

      const meta = [
        lead.source + (lead.subreddit ? ` / r/${lead.subreddit}` : ""),
        lead.author ? `@${lead.author}` : null,
        lead.intent ? `intent: ${lead.intent}` : null,
        Number.isFinite(lead.score) ? `score ${lead.score}` : null,
        Number.isFinite(lead.num_comments) ? `${lead.num_comments} comments` : null,
        formatDate(lead.posted_at ?? lead.captured_at),
      ].filter(Boolean).join("  ·  ");
      doc.font("Helvetica").fontSize(9).fillColor("#777").text(meta, { paragraphGap: 4 });

      if (lead.url) {
        doc.font("Helvetica").fontSize(9).fillColor("#1a73e8")
          .text(lead.url, { link: lead.url, underline: true, paragraphGap: 6 });
      }

      if (lead.excerpt) {
        doc.font("Helvetica").fontSize(10).fillColor("#222")
          .text(lead.excerpt, { paragraphGap: 6 });
      }

      if (lead.draft_body) {
        doc.moveDown(0.2);
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#0b6e3f").text("Suggested opener");
        doc.font("Helvetica").fontSize(10).fillColor("#222").text(lead.draft_body, { paragraphGap: 4 });
      }

      doc.moveDown(0.4);
      doc.strokeColor("#eee").lineWidth(0.5)
        .moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
    });

    // ── Footer ───────────────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font("Helvetica").fontSize(8).fillColor("#999")
        .text(
          `Interchained Signal Scout · page ${i + 1} of ${range.count}`,
          doc.page.margins.left,
          doc.page.height - doc.page.margins.bottom + 10,
          { align: "center", width: doc.page.width - doc.page.margins.left - doc.page.margins.right },
        );
    }

    doc.end();
    stream.on("finish", () => resolveP(outPath));
    stream.on("error", rejectP);

    // After writing, mark drafted leads as exported.
    stream.on("finish", () => {
      const conn2 = db.open();
      const ids = leads.filter(l => l.status === "drafted").map(l => l.id);
      const stmt = conn2.prepare(`UPDATE leads SET status = 'exported' WHERE id = ?`);
      const tx = conn2.transaction(() => { for (const id of ids) stmt.run(id); });
      tx();
      conn2.close();
    });
  });
}
