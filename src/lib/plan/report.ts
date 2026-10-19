import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { dataRoot, filePath } from "./local-store";
import {
  effectiveElements,
  type Review,
  type PlanJob,
  type Correction,
} from "./schema";
import { evaluateReview } from "./evaluation";
export async function planReport(
  review: Review,
  job: PlanJob,
  corrections: Correction[],
) {
  if (!job.result) throw new Error("No completed extraction for this page");
  const result = job.result,
    effective = effectiveElements(result, corrections),
    compliance = evaluateReview(review.context, result, corrections);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle("PermitPilot — preliminary drawing evidence review");
  pdf.setSubject(
    "Extraction and human-review evidence; compliance not evaluated",
  );
  pdf.setProducer("PermitPilot");
  let page = pdf.addPage([595, 842]),
    y = 790;
  const clean = (s: string) => s.replace(/[^\x20-\x7E\n]/g, " ");
  function line(s: string, size = 10, heavy = false) {
    const words = clean(s).split(/\s+/);
    let current = "";
    function draw(v: string) {
      if (y < 58) {
        page = pdf.addPage([595, 842]);
        y = 790;
      }
      page.drawText(v, {
        x: 45,
        y,
        size,
        font: heavy ? bold : font,
        color: rgb(0.2, 0.28, 0.22),
      });
      y -= size + 6;
    }
    for (const word of words) {
      let w = word;
      while (font.widthOfTextAtSize(w, size) > 500) {
        if (current) {
          draw(current);
          current = "";
        }
        let fit = "";
        while (w && font.widthOfTextAtSize(fit + w[0], size) <= 500) {
          fit += w[0];
          w = w.slice(1);
        }
        draw(fit);
      }
      if (font.widthOfTextAtSize(current + " " + w, size) > 500) {
        draw(current);
        current = w;
      } else current += (current ? " " : "") + w;
    }
    if (current) draw(current);
    y -= 4;
  }
  line("PermitPilot | Preliminary plan review", 20, true);
  line("DRAWING EXTRACTION & HUMAN REVIEW — NOT A CODE APPROVAL", 9, true);
  y -= 10;
  line(review.context.projectName, 16, true);
  line(
    "Property: " +
      (review.context.address || "Not established — reference drawing"),
  );
  line(
    `Source: ${review.name} | PDF/image page ${job.page} of ${result.pageCount}`,
  );
  line(`Generated: ${new Date().toISOString()} | Analysis ${job.id}`);
  line(`File SHA-256: ${review.sha256}`, 8);
  line(
    "Document source URL: " +
      (review.context.sourceUrl ||
        "User upload; original download not independently authenticated."),
    8,
  );
  line("REGULATORY CONTEXT", 12, true);
  line(
    `Selected AHJ: ${review.context.ahj} | Verification: ${review.context.jurisdictionStatus}`,
  );
  line(
    `Application date: ${review.context.applicationDate || "Unknown"} | Classification: ${review.context.classification} | Work: ${review.context.construction}`,
  );
  line(
    `Declared code edition: ${review.context.codeEdition || "Unknown"} — applicability not independently verified`,
  );
  line(
    "Verified active rule set: none. Checks evaluated: 0. Passed compliance checks: 0.",
    10,
    true,
  );
  for (const finding of compliance.findings)
    line(`${finding.status}: ${finding.title} — ${finding.reason}`, 9);
  for (const blocker of compliance.blockers) line("Unresolved: " + blocker, 9);
  line("EXTRACTION SUMMARY", 12, true);
  line(
    `${result.elements.length} candidates; ${result.elements.filter((e) => e.kind === "dimension").length} printed dimension candidates; ${result.elements.filter((e) => e.kind === "room_label").length} room/space labels.`,
  );
  line(
    `Processing time: ${result.metrics.processingMs.toFixed(2)} ms. Page rotation: ${result.page.rotation} degrees. Extraction: ${result.page.kind} page, schema ${result.schemaVersion}.`,
  );
  line(
    `${effective.filter((v) => v.status === "confirmed" || v.status === "corrected").length} human-reviewed candidates. No geometric room boundaries or comprehensive plan review are claimed.`,
  );
  for (const warning of result.warnings)
    line("Unknown / limitation: " + warning, 9);
  line("EVIDENCE REGISTER", 12, true);
  effective.forEach((v, i) => {
    line(`${i + 1}. ${v.label} | ${v.kind} | ${v.status}`, 10, true);
    line(
      `Original: ${v.element.label} | Page ${v.element.page} | ${v.element.method} | ${v.element.confidence} extraction confidence.`,
      8,
    );
    if (v.element.originalValue)
      line(
        `Original numeric value: ${v.element.originalValue.value} ${v.element.originalValue.unit} (${v.element.originalValue.inches} in)`,
        8,
      );
    if (v.correction) {
      line(
        `Human review: ${v.correction.status}; label ${v.correction.label}; value ${v.correction.value === null ? "unknown" : `${v.correction.value} ${v.correction.unit}`}; recorded ${v.correction.createdAt}.`,
        8,
      );
      if (v.correction.note) line("Reviewer note: " + v.correction.note, 8);
    }
    line(
      `Normalized displayed box: ${Object.entries(v.element.bbox)
        .map(([k, n]) => `${k}=${n.toFixed(4)}`)
        .join(", ")}`,
      8,
    );
  });
  line("LIMITATIONS", 12, true);
  line(
    "This is an automated pre-submission extraction review. It separates printed facts, human corrections, unknown information, and unevaluated compliance. It does not certify technical code compliance or guarantee permit approval. Governing requirements and final decisions belong to the authority and qualified professionals.",
    9,
  );
  line(
    "The San Diego reference drawing is an extraction baseline. San Jose-specific rules are not applied to it. Publication/revision text on a standard plan does not establish the actual permit application date or project regulatory applicability.",
    9,
  );
  const renderPath = join(dataRoot(), `render-${randomUUID()}.png`);
  try {
    await promisify(execFile)(
      process.env.PERMITPILOT_PYTHON || "python",
      [
        resolve("scripts/render-plan-page.py"),
        filePath(review.id),
        String(job.page),
        renderPath,
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    const image = await pdf.embedPng(await readFile(renderPath));
    const drawing = pdf.addPage([1190, 842]);
    drawing.drawText("Actual source drawing — candidate locations", {
      x: 30,
      y: 810,
      font: bold,
      size: 16,
      color: rgb(0.2, 0.3, 0.23),
    });
    drawing.drawText(
      "Amber: unreviewed source evidence. Green: human-reviewed fact. Neither color indicates code compliance.",
      { x: 30, y: 789, font, size: 9, color: rgb(0.5, 0.57, 0.47) },
    );
    const width = Math.min(1130, (710 * image.width) / image.height),
      height = (width * image.height) / image.width,
      x = (1190 - width) / 2,
      y0 = 55;
    drawing.drawImage(image, { x, y: y0, width, height });
    effective.forEach((v, i) => {
      const b = v.element.bbox,
        reviewed = ["confirmed", "corrected"].includes(v.status);
      drawing.drawRectangle({
        x: x + b.x * width,
        y: y0 + (1 - b.y - b.height) * height,
        width: b.width * width,
        height: b.height * height,
        borderColor: reviewed ? rgb(0.22, 0.55, 0.31) : rgb(0.75, 0.55, 0.2),
        borderWidth: 0.7,
      });
      drawing.drawText(String(i + 1), {
        x: x + b.x * width,
        y: y0 + (1 - b.y) * height + 1,
        size: 6,
        font: bold,
        color: rgb(0.35, 0.4, 0.28),
      });
    });
    drawing.drawText(
      `Source page ${job.page}; orientation matches displayed original. Numbered boxes reference the evidence register.`,
      { x: 30, y: 25, font, size: 9, color: rgb(0.5, 0.57, 0.47) },
    );
  } finally {
    await unlink(renderPath).catch(() => {});
  }
  return new Uint8Array(await pdf.save());
}
