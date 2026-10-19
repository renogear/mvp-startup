import {
  PDFDocument,
  PDFString,
  StandardFonts,
  rgb,
  type PDFPage,
} from "pdf-lib";
import { evaluateReview } from "./evaluation";
import { browserPdfOptions } from "./browser-pdf-assets";
import {
  effectiveElements,
  type Correction,
  type PlanJob,
  type Review,
} from "./schema";

// Standard PDF fonts cannot encode arbitrary uploaded text. Keep punctuation
// readable, then replace unsupported glyphs instead of failing the download.
function printable(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00b0/g, " degrees ")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e\n]/g, " ");
}

async function renderOriginal(
  original: Blob,
  mime: string,
  pageNumber: number,
) {
  const canvas = document.createElement("canvas");
  if (mime === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    // The browser entry point configures its bundled PDF.js worker. Do not
    // replace it with an absolute URL, which breaks downloadable prototypes.
    const task = pdfjs.getDocument({
      ...browserPdfOptions(),
      data: new Uint8Array(await original.arrayBuffer()),
    });
    try {
      const source = await task.promise;
      if (pageNumber > source.numPages)
        throw new Error("The source page is no longer available.");
      const page = await source.getPage(pageNumber);
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.min(2, 2600 / Math.max(natural.width, natural.height)),
      });
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      await page.render({ canvas, viewport, background: "rgb(255,255,255)" })
        .promise;
      return canvas.toDataURL("image/png");
    } finally {
      await task.destroy();
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  if (!["image/png", "image/jpeg"].includes(mime))
    throw new Error(
      "This source file type cannot be included in a PDF report.",
    );
  const url = URL.createObjectURL(original);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 2600 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("The browser cannot render the source image.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Fully client-side export: source bytes and review data never leave the browser. */
export async function browserReport(
  review: Review,
  job: PlanJob,
  corrections: Correction[],
  original: Blob,
): Promise<Uint8Array> {
  if (!job.result || job.state !== "complete")
    throw new Error("Complete extraction before downloading a review report.");
  const result = job.result;
  if (
    job.reviewId !== review.id ||
    result.documentId !== review.id ||
    result.sourceSha256 !== review.sha256 ||
    result.page.number !== job.page
  )
    throw new Error("The extraction does not match this document and page.");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await original.arrayBuffer(),
  );
  const actualSha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (actualSha256 !== review.sha256)
    throw new Error(
      "The original file does not match the extraction evidence.",
    );

  const effective = effectiveElements(result, corrections);
  const compliance = evaluateReview(review.context, result, corrections);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle("PermitPilot - preliminary drawing evidence review");
  pdf.setSubject(
    "Extracted facts and human review; code compliance not evaluated",
  );
  pdf.setProducer("PermitPilot browser prototype");
  let page = pdf.addPage([595, 842]);
  let y = 790;
  const ink = rgb(0.16, 0.22, 0.19);

  function line(text: string, size = 10, heavy = false) {
    const typeface = heavy ? bold : font;
    let first: { page: PDFPage; y: number } | undefined;
    const draw = (value: string) => {
      if (y < 58) {
        page = pdf.addPage([595, 842]);
        y = 790;
      }
      first ??= { page, y };
      page.drawText(value, { x: 45, y, size, font: typeface, color: ink });
      y -= size + 6;
    };
    let current = "";
    for (const token of printable(text).split(/\s+/)) {
      let word = token;
      while (typeface.widthOfTextAtSize(word, size) > 500) {
        if (current) {
          draw(current);
          current = "";
        }
        let fit = "";
        while (word && typeface.widthOfTextAtSize(fit + word[0], size) <= 500) {
          fit += word[0];
          word = word.slice(1);
        }
        draw(fit);
      }
      const next = current + (current ? " " : "") + word;
      if (typeface.widthOfTextAtSize(next, size) > 500) {
        draw(current);
        current = word;
      } else current = next;
    }
    if (current) draw(current);
    y -= 4;
    return first;
  }

  line("PermitPilot | Preliminary plan review", 20, true);
  line("DRAWING EVIDENCE & HUMAN REVIEW - NOT A CODE APPROVAL", 9, true);
  y -= 10;
  line(review.context.projectName, 16, true);
  line(`Property: ${review.context.address || "Unknown - reference drawing"}`);
  line(`Source: ${review.name} | Page ${job.page} of ${result.pageCount}`);
  line(`Generated: ${new Date().toISOString()} | Analysis: ${job.id}`, 8);
  line(`Original file SHA-256: ${actualSha256}`, 8);
  line(
    `Declared source URL: ${review.context.sourceUrl || "Not provided"}. Source identity is not independently authenticated by this prototype.`,
    8,
  );
  line("REGULATORY CONTEXT AND COMPLIANCE", 12, true);
  line(
    `Selected authority: ${review.context.ahj}. Jurisdiction status: ${review.context.jurisdictionStatus}. Mailing address alone does not verify the authority.`,
  );
  line(
    `Jurisdiction evidence: ${review.context.jurisdictionEvidence || "Unknown"}`,
    9,
  );
  line(
    `Actual application date: ${review.context.applicationDate || "Unknown"}. Classification: ${review.context.classification}. Construction: ${review.context.construction}.`,
    9,
  );
  line(
    `Declared code edition: ${review.context.codeEdition || "Unknown"}. Code applicability, adopted amendments, rule version, sources, and effective dates have not been verified.`,
    9,
  );
  line(
    "Verified active rules: none. Compliance checks completed: 0. Passed checks: 0.",
    10,
    true,
  );
  for (const finding of compliance.findings)
    line(`${finding.status}: ${finding.title}. ${finding.reason}`, 9);
  for (const blocker of compliance.blockers) line(`Unresolved: ${blocker}`, 9);
  line(
    "The San Diego reference plan is an extraction baseline, not evidence of current code compliance. San Jose-specific rules are not applied to out-of-jurisdiction drawings.",
    9,
  );
  line("EXTRACTED FACTS AND HUMAN REVIEW", 12, true);
  line(
    `${result.elements.length} extracted candidates; ${effective.filter((value) => value.kind === "dimension").length} dimension annotations; ${effective.filter((value) => value.kind === "room_label").length} room/space labels.`,
  );
  line(
    `${effective.filter((value) => ["confirmed", "corrected"].includes(value.status)).length} human-reviewed facts; ${effective.filter((value) => value.status === "unreviewed").length} unreviewed candidates; ${effective.filter((value) => ["rejected", "irrelevant"].includes(value.status)).length} rejected or irrelevant candidates. Human confirmation is not a compliance determination.`,
  );
  line(
    `Processing: ${result.metrics.processingMs.toFixed(2)} ms. Rotation: ${result.page.rotation} degrees. Method: ${result.page.kind}. Schema: ${result.schemaVersion}.`,
    9,
  );
  line(
    "Accuracy, false detections, and missed dimensions: unknown until independently compared with the source drawing. Printed annotations are not geometric measurements. No room boundaries or physical door/window locations are inferred.",
    9,
  );
  for (const warning of result.warnings)
    line(`Unknown / limitation: ${warning}`, 9);
  line("EVIDENCE REGISTER", 12, true);
  const destinations = effective.map((value, index) => {
    const destination = line(
      `${index + 1}. ${value.label} | ${value.kind} | ${value.status}`,
      10,
      true,
    );
    line(
      `Original extracted text: ${value.element.label}. Page: ${value.element.page}. Method: ${value.element.method}. Extraction confidence: ${value.element.confidence} (not verified).`,
      8,
    );
    if (value.element.originalValue)
      line(
        `Original numeric interpretation: ${value.element.originalValue.value} ${value.element.originalValue.unit} (${value.element.originalValue.inches} in).`,
        8,
      );
    if (value.correction) {
      line(
        `Human review: ${value.correction.status}; label: ${value.correction.label}; numeric value: ${value.correction.value === null ? "unknown / not supplied" : `${value.correction.value} ${value.correction.unit}`}; recorded: ${value.correction.createdAt}.`,
        8,
      );
      if (value.correction.note)
        line(`Reviewer note: ${value.correction.note}`, 8);
    }
    line(
      `Source evidence: ${value.element.evidence}. Normalized displayed-page box: ${Object.entries(
        value.element.bbox,
      )
        .map(([key, number]) => `${key}=${number.toFixed(4)}`)
        .join(", ")}.`,
      8,
    );
    return destination;
  });
  line("RECOMMENDED NEXT ACTIONS", 12, true);
  line(
    "Compare each candidate with the printed drawing, correct or reject false detections, and record missed information. Verify the actual parcel authority, application date, project classification, and applicable code with authoritative sources before any technical evaluation. A qualified professional must assess technical design requirements.",
    9,
  );
  line(
    "Document completeness, administrative preparation, technical code compliance, and government permit approval are separate decisions. This preliminary evidence report does not certify a complete submission, technical compliance, or permit approval.",
    9,
  );

  const image = await pdf.embedPng(
    await renderOriginal(original, review.mime, job.page),
  );
  const drawing = pdf.addPage([1190, 842]);
  drawing.drawText("Actual source drawing - extracted candidate locations", {
    x: 30,
    y: 810,
    font: bold,
    size: 16,
    color: ink,
  });
  drawing.drawText(
    "Amber: unreviewed. Green: human-reviewed. Gray: rejected/irrelevant. Colors never indicate code compliance.",
    { x: 30, y: 789, font, size: 9, color: ink },
  );
  const width = Math.min(1130, (710 * image.width) / image.height);
  const height = (width * image.height) / image.width;
  const x = (1190 - width) / 2;
  const y0 = 55;
  drawing.drawImage(image, { x, y: y0, width, height });
  effective.forEach((value, index) => {
    if (value.element.page !== job.page) return;
    const box = value.element.bbox;
    const left = x + box.x * width;
    const bottom = y0 + (1 - box.y - box.height) * height;
    const boxWidth = box.width * width;
    const boxHeight = box.height * height;
    const reviewed = ["confirmed", "corrected"].includes(value.status);
    const excluded = ["rejected", "irrelevant"].includes(value.status);
    const color = excluded
      ? rgb(0.5, 0.5, 0.5)
      : reviewed
        ? rgb(0.2, 0.5, 0.3)
        : rgb(0.78, 0.52, 0.13);
    drawing.drawRectangle({
      x: left,
      y: bottom,
      width: boxWidth,
      height: boxHeight,
      borderColor: color,
      borderWidth: 0.8,
    });
    drawing.drawText(String(index + 1), {
      x: left,
      y: bottom + boxHeight + 1,
      size: 6,
      font: bold,
      color,
    });
    const destination = destinations[index];
    if (destination) {
      // Internal GoTo links only: uploaded text never becomes an executable URI.
      drawing.node.addAnnot(
        pdf.context.register(
          pdf.context.obj({
            Type: "Annot",
            Subtype: "Link",
            Rect: [left, bottom, left + boxWidth, bottom + boxHeight],
            Border: [0, 0, 0],
            Contents: PDFString.of(
              printable(`Evidence ${index + 1}: ${value.label}`),
            ),
            Dest: [destination.page.ref, "XYZ", 45, destination.y + 14, null],
          }),
        ),
      );
    }
  });
  drawing.drawText(
    `Source page ${job.page}. Orientation matches displayed original. Click a numbered box to open its evidence entry.`,
    { x: 30, y: 25, font, size: 9, color: ink },
  );
  return new Uint8Array(await pdf.save());
}
