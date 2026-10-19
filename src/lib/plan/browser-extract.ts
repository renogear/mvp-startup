import type { TextItem, TextStyle } from "pdfjs-dist/types/src/display/api";
import { browserPdfOptions } from "./browser-pdf-assets";
import {
  resultSchema,
  type Box,
  type Element,
  type PlanResult,
} from "./schema";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_SPANS = 30_000;
const MAX_ELEMENTS = 10_000;
const NUMBER = String.raw`(?:\d+[- ]+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?)`;
const ROOM =
  /^(?:(?:PRIMARY|MASTER|GUEST|FAMILY|GREAT|LIVING|DINING|LAUNDRY|UTILITY|MECHANICAL|STORAGE|MUD|BED)\s*(?:ROOM|RM)|BEDROOM|BATH(?:ROOM)?|KITCHEN|CLOSET|W\.?I\.?C\.?|GARAGE|PANTRY|FOYER|ENTRY|HALL(?:WAY)?|CORRIDOR|OFFICE|DEN|PORCH|DECK|BALCONY|LAUNDRY)(?:\s*(?:#?\d+|[A-Z]))?$/i;

export type PrintedDimension = {
  start: number;
  end: number;
  text: string;
  value: number;
  unit: "ft" | "in" | "mm" | "cm" | "m";
  inches: number;
};

/** Offsets refer to normalized text, whose unicode fractions can be longer. */
export function normalizePrintedText(text: string): string {
  const substitutions: Record<string, string> = {
    "′": "'",
    "’": "'",
    "‘": "'",
    "″": '"',
    "“": '"',
    "”": '"',
    "–": "-",
    "−": "-",
    "½": " 1/2",
    "¼": " 1/4",
    "¾": " 3/4",
    "⅛": " 1/8",
    "⅜": " 3/8",
    "⅝": " 5/8",
    "⅞": " 7/8",
  };
  return text.replace(
    /[′’‘″“”–−½¼¾⅛⅜⅝⅞]/g,
    (character) => substitutions[character],
  );
}

function printedNumber(text: string): number {
  let result = 0;
  for (const part of text.replaceAll("-", " ").trim().split(/\s+/)) {
    if (part.includes("/")) {
      const [numerator, denominator] = part.split("/").map(Number);
      if (!denominator) throw new Error("Invalid fraction");
      result += numerator / denominator;
    } else result += Number(part);
  }
  if (!Number.isFinite(result) || result < 0)
    throw new Error("Invalid printed measurement");
  return result;
}

/** Parse only explicit printed units. No inferred geometry or unitless dimensions. */
export function parsePrintedDimensions(source: string): PrintedDimension[] {
  const text = normalizePrintedText(source);
  const occupied: [number, number][] = [];
  const output: PrintedDimension[] = [];
  const patterns: [RegExp, "ft" | "in" | "metric"][] = [
    [
      new RegExp(
        String.raw`(?<![\w.\-/])(${NUMBER})\s*(?:'|ft\b|feet\b)\s*(?:-?\s*(${NUMBER})\s*(?:"|in\b|inches\b))?`,
        "gi",
      ),
      "ft",
    ],
    [
      new RegExp(
        String.raw`(?<![\w.\-/])(${NUMBER})\s*(?:"|in\b|inches\b)`,
        "gi",
      ),
      "in",
    ],
    [
      new RegExp(String.raw`(?<![\w.\-/])(${NUMBER})\s*(mm|cm|m)\b`, "gi"),
      "metric",
    ],
  ];
  for (const [pattern, family] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (occupied.some(([left, right]) => start < right && end > left))
        continue;
      occupied.push([start, end]);
      try {
        let value = printedNumber(match[1]);
        let unit: PrintedDimension["unit"] =
          family === "metric"
            ? (match[2].toLowerCase() as "mm" | "cm" | "m")
            : family;
        let inches = value;
        if (family === "ft") {
          const residual = match[2] ? printedNumber(match[2]) : 0;
          if (residual >= 12) continue;
          inches = value * 12 + residual;
          value += residual / 12;
          unit = "ft";
        } else if (family === "metric") {
          inches =
            value *
            { mm: 1 / 25.4, cm: 1 / 2.54, m: 1000 / 25.4 }[
              unit as "mm" | "cm" | "m"
            ];
        }
        output.push({ start, end, text: match[0], value, unit, inches });
      } catch {
        /* Invalid source tokens remain unknown. */
      }
    }
  }
  return output.sort((left, right) => left.start - right.start);
}

export function classifyPrintedScale(source: string): boolean {
  const text = normalizePrintedText(source).trim();
  return (
    (/=/.test(text) && parsePrintedDimensions(text).length >= 2) ||
    /^(?:SCALE\s*[:=]?\s*)?(?:\d+\s*:\s*\d+|N\.?T\.?S\.?|NOT TO SCALE)\s*$/i.test(
      text,
    )
  );
}

type Rect = { x: number; y: number; width: number; height: number };
type Span = {
  text: string;
  rect: Rect;
  baseline: number[];
  fontHeight: number;
  ascent: number;
  descent: number;
};

function boundedRect(rect: Rect, width: number, height: number): Rect | null {
  const x = Math.max(0, Math.min(width, rect.x));
  const y = Math.max(0, Math.min(height, rect.y));
  const right = Math.max(x, Math.min(width, rect.x + rect.width));
  const bottom = Math.max(y, Math.min(height, rect.y + rect.height));
  if (
    ![x, y, right, bottom].every(Number.isFinite) ||
    right - x < 0.0001 ||
    bottom - y < 0.0001
  )
    return null;
  return { x, y, width: right - x, height: bottom - y };
}

function normalizedBox(rect: Rect, width: number, height: number): Box {
  return {
    x: rect.x / width,
    y: rect.y / height,
    width: rect.width / width,
    height: rect.height / height,
  };
}

function textRect(
  baseline: number[],
  advance: number,
  height: number,
  ascent: number,
  descent: number,
  start = 0,
  end = 1,
): Rect {
  const [a, b, c, d, x, y] = baseline;
  const baseLength = Math.hypot(a, b) || 1;
  const upLength = Math.hypot(c, d) || 1;
  const ux = a / baseLength,
    uy = b / baseLength;
  const vx = c / upLength,
    vy = d / upLength;
  const corners = [start, end].flatMap((fraction) =>
    [ascent, descent].map((offset) => ({
      x: x + ux * advance * fraction + vx * height * offset,
      y: y + uy * advance * fraction + vy * height * offset,
    })),
  );
  const left = Math.min(...corners.map((point) => point.x));
  const top = Math.min(...corners.map((point) => point.y));
  return {
    x: left,
    y: top,
    width: Math.max(...corners.map((point) => point.x)) - left,
    height: Math.max(...corners.map((point) => point.y)) - top,
  };
}

function unionRects(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return {
    x,
    y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
  };
}

function overlapFraction(rect: Rect, other: Rect): number {
  const width = Math.max(
    0,
    Math.min(rect.x + rect.width, other.x + other.width) -
      Math.max(rect.x, other.x),
  );
  const height = Math.max(
    0,
    Math.min(rect.y + rect.height, other.y + other.height) -
      Math.max(rect.y, other.y),
  );
  return (width * height) / (rect.width * rect.height);
}

/** Extract the selected real PDF page. Every result remains a candidate for review. */
export async function extractBrowserPlan(
  bytes: Uint8Array,
  documentId: string,
  pageNumber: number,
  sourceSha256: string,
): Promise<PlanResult> {
  const started = performance.now();
  if (!bytes.length || bytes.length > MAX_BYTES)
    throw new Error("Choose a PDF no larger than 20 MB.");
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-")
    throw new Error(
      "Automatic browser extraction requires a PDF. Image measurements remain unknown.",
    );
  if (!Number.isInteger(pageNumber) || pageNumber < 1)
    throw new Error("Choose a valid page number.");
  if (!documentId || documentId.length > 128)
    throw new Error("A valid source document identifier is required.");
  if (!/^[a-f0-9]{64}$/.test(sourceSha256))
    throw new Error("A source SHA-256 fingerprint is required.");
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
  );
  const actualHash = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (actualHash !== sourceSha256)
    throw new Error(
      "The PDF does not match its source fingerprint. Upload it again.",
    );

  const pdfjs = await import("pdfjs-dist");
  // Copy because PDF.js transfers the underlying buffer to its worker.
  const task = pdfjs.getDocument({
    ...browserPdfOptions(),
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  try {
    const document = await task.promise;
    if (document.numPages > 100)
      throw new Error(
        "The browser prototype supports documents up to 100 pages.",
      );
    if (pageNumber > document.numPages)
      throw new Error(`Choose a page between 1 and ${document.numPages}.`);
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const { width, height } = viewport;
    if (Math.min(width, height) <= 0 || Math.max(width, height) > 20_000)
      throw new Error(
        "This PDF page is too large to analyze safely in the browser.",
      );
    const content = await page.getTextContent();
    const spans: Span[] = [];
    const warnings = [
      "These are printed text candidates, not measured physical geometry, room boundaries, or verified building-code results.",
      "Bounding boxes are approximate text extents. Substring positions use average character widths and require visual review.",
      "Browser extraction reads embedded PDF text only. OCR, image-only regions, wall detection, and physical door/window locations are not analyzed; unread information remains unknown.",
      "No compliance checks have been executed. Jurisdiction, application date, code edition, and independently verified rules must be established separately.",
    ];
    for (const raw of content.items) {
      if (!("str" in raw) || !raw.str.trim()) continue;
      const item: TextItem = raw;
      const baseline = pdfjs.Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.hypot(baseline[2], baseline[3]);
      const style: TextStyle | undefined = content.styles[item.fontName];
      const ascent = Number.isFinite(style?.ascent) ? style.ascent : 0.8;
      const descent = Number.isFinite(style?.descent) ? style.descent : -0.2;
      const advance = Math.abs(item.width * viewport.scale);
      const rect = boundedRect(
        textRect(baseline, advance, fontHeight, ascent, descent),
        width,
        height,
      );
      if (!rect) continue;
      spans.push({
        text: item.str,
        rect,
        baseline: [...baseline, advance],
        fontHeight,
        ascent,
        descent,
      });
      if (spans.length >= MAX_SPANS) {
        warnings.push(
          `Text spans were limited to ${MAX_SPANS}. Additional content remains unknown.`,
        );
        break;
      }
    }
    const elements: Element[] = [];
    let candidatesTruncated = false;
    function add(
      kind: Element["kind"],
      label: string,
      rect: Rect,
      evidence: string,
      extra: Record<string, unknown> = {},
    ) {
      if (elements.length >= MAX_ELEMENTS) {
        candidatesTruncated = true;
        return;
      }
      const bounded = boundedRect(rect, width, height);
      if (!bounded) return;
      elements.push({
        id: `${documentId.slice(0, 70)}-p${pageNumber}-candidate-${elements.length + 1}`,
        kind,
        label: label.slice(0, 4000),
        bbox: normalizedBox(bounded, width, height),
        page: pageNumber,
        method: "embedded_text",
        confidence: "medium",
        evidence: evidence.slice(0, 16000),
        verification: "unreviewed",
        ...extra,
      });
    }

    // Recognize rows only beneath explicit schedule headings and a MARK column.
    // Their boxes identify table evidence, never physical door/window locations.
    const scheduleRegions: Rect[] = [];
    for (const heading of spans) {
      const headingText = heading.text.trim();
      if (!/^(?:DOOR|WINDOW)\s+SCHEDULE$/i.test(headingText)) continue;
      const family = /^DOOR/i.test(headingText) ? "door" : "window";
      const near = spans.filter(
        (span) =>
          span.rect.y >= heading.rect.y + heading.rect.height - 2 &&
          span.rect.y < heading.rect.y + heading.rect.height + 30 &&
          Math.abs(span.rect.x - heading.rect.x) < 180 &&
          /^(?:MARK|DIMENSION|SIZE|TYPE|TEMPERED|NOTES)$/i.test(
            span.text.trim(),
          ),
      );
      const mark = near
        .filter((span) => /^MARK$/i.test(span.text.trim()))
        .sort(
          (a, b) =>
            Math.abs(a.rect.x - heading.rect.x) -
            Math.abs(b.rect.x - heading.rect.x),
        )[0];
      if (!mark) {
        add(`${family}_schedule`, headingText, heading.rect, headingText, {
          confidence: "low",
          context: "schedule_heading_only",
        });
        scheduleRegions.push(heading.rect);
        continue;
      }
      const columns = near.filter(
        (span) =>
          Math.abs(span.rect.y - mark.rect.y) < 3 &&
          span.rect.x >= mark.rect.x - 3,
      );
      const right =
        Math.max(...columns.map((span) => span.rect.x + span.rect.width)) + 100;
      const candidates = spans.filter(
        (span) =>
          span.rect.x >= mark.rect.x - 15 &&
          span.rect.x < right &&
          span.rect.y > mark.rect.y + 5 &&
          span.rect.y < mark.rect.y + 100,
      );
      const marks = candidates
        .filter(
          (span) =>
            /^(?:[A-Z]|\d{1,2})$/.test(span.text.trim()) &&
            Math.abs(span.rect.x - mark.rect.x) < 12,
        )
        .sort((a, b) => a.rect.y - b.rect.y);
      for (const rowMark of marks) {
        const row = candidates
          .filter((span) => Math.abs(span.rect.y - rowMark.rect.y) < 2.5)
          .sort((a, b) => a.rect.x - b.rect.x);
        const evidence = row.map((span) => span.text.trim()).join(" | ");
        const dimensions = row.find((span) => /\s[x×]\s/i.test(span.text));
        const parsed = dimensions
          ? parsePrintedDimensions(dimensions.text)
          : [];
        const types = row.filter((span) =>
          /^(?:SLIDING|SWINGING|BI[- ]?FOLD|FIXED|CASEMENT|AWNING|SINGLE[- ]HUNG|DOUBLE[- ]HUNG)$/i.test(
            span.text.trim(),
          ),
        );
        const rect = unionRects(row.map((span) => span.rect));
        add(
          `${family}_schedule`,
          `${family === "door" ? "Door" : "Window"} ${rowMark.text.trim()}: ${evidence}`,
          rect,
          evidence,
          {
            context: "schedule_row_not_physical_location",
            schedule: {
              mark: rowMark.text.trim(),
              dimensionText: dimensions?.text ?? null,
              type: types[0]?.text ?? null,
              notes: row
                .filter(
                  (span) =>
                    span !== rowMark &&
                    span !== dimensions &&
                    !types.includes(span),
                )
                .map((span) => span.text),
              ...(parsed.length >= 2
                ? {
                    widthInches: parsed[0].inches,
                    heightInches: parsed[1].inches,
                  }
                : {}),
            },
          },
        );
        scheduleRegions.push({
          x: rect.x - 2,
          y: rect.y - 2,
          width: rect.width + 4,
          height: rect.height + 4,
        });
      }
      scheduleRegions.push(heading.rect);
    }

    for (const span of spans) {
      if (
        scheduleRegions.some(
          (region) => overlapFraction(span.rect, region) > 0.5,
        )
      )
        continue;
      const clean = span.text.replace(/\s+/g, " ").trim();
      if (ROOM.test(clean))
        add("room_label", clean, span.rect, span.text, {
          context: "label_only_boundary_unknown",
        });
      if (classifyPrintedScale(clean)) {
        add("scale", clean, span.rect, span.text, {
          context: "printed_scale_requires_calibration",
        });
        continue;
      }
      const normalized = normalizePrintedText(span.text);
      for (const measurement of parsePrintedDimensions(span.text)) {
        const remaining =
          normalized.slice(0, measurement.start) +
          normalized.slice(measurement.end);
        const prose = (remaining.match(/[A-Za-z]{2,}/g) ?? []).length > 5;
        const context = prose
          ? "note_text_not_geometric_measurement"
          : /CEILING/i.test(clean)
            ? "printed_ceiling_height"
            : /HEIGHT/i.test(clean)
              ? "printed_height_annotation"
              : /\s[x×]\s/i.test(clean)
                ? "printed_dimension_pair_not_geometric_measurement"
                : "printed_dimension_unassociated";
        // Expanded unicode fractions cannot preserve character offsets reliably.
        const rect =
          normalized === span.text
            ? textRect(
                span.baseline,
                span.baseline[6],
                span.fontHeight,
                span.ascent,
                span.descent,
                measurement.start / span.text.length,
                measurement.end / span.text.length,
              )
            : span.rect;
        add(
          prose ? "annotation" : "dimension",
          measurement.text,
          rect,
          span.text,
          {
            confidence: "low",
            context,
            originalValue: {
              value: measurement.value,
              unit: measurement.unit,
              inches: measurement.inches,
            },
          },
        );
      }
    }
    if (!spans.length)
      warnings.push(
        "No embedded text was readable on this page. All architectural facts remain unknown; upload a text-based PDF or enter human-reviewed corrections.",
      );
    if (candidatesTruncated)
      warnings.push(
        `Candidates were limited to ${MAX_ELEMENTS}. Additional elements remain unknown.`,
      );
    elements.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
    return resultSchema.parse({
      schemaVersion: "1.0",
      documentId,
      sourceSha256: actualHash,
      pageCount: document.numPages,
      page: {
        number: pageNumber,
        width,
        height,
        rotation: viewport.rotation,
        kind: "embedded_text_analysis",
        coordinateSystem: "normalized_top_left_displayed_page",
        boundingBoxPrecision: "approximate_text_extents",
      },
      elements,
      textSpans: spans.map((span) => ({
        text: span.text,
        bbox: normalizedBox(span.rect, width, height),
        page: pageNumber,
        method: "embedded_text",
      })),
      warnings,
      metrics: {
        processingMs: performance.now() - started,
        textSpanCount: spans.length,
        embeddedTextSpanCount: spans.length,
        ocrTextSpanCount: 0,
        elementCount: elements.length,
        dimensionCount: elements.filter(
          (element) => element.kind === "dimension",
        ).length,
        roomLabelCount: elements.filter(
          (element) => element.kind === "room_label",
        ).length,
        accuracy: "unknown_until_independent_review",
        engine: "pdfjs-browser-embedded-text",
      },
    });
  } finally {
    await task.destroy();
  }
}
