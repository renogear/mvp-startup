import { beforeEach, describe, expect, it, vi } from "vitest";
import { resultSchema } from "../src/lib/plan/schema";
import {
  classifyPrintedScale,
  extractBrowserPlan,
  normalizePrintedText,
  parsePrintedDimensions,
} from "../src/lib/plan/browser-extract";

const mocks = vi.hoisted(() => ({ getDocument: vi.fn(), destroy: vi.fn() }));
vi.mock("pdfjs-dist", () => ({
  getDocument: mocks.getDocument,
  Util: {
    transform: (a: number[], b: number[]) => [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5],
    ],
  },
}));

const bytes = new TextEncoder().encode(
  "%PDF-1.7\nSynthetic PDF.js transport fixture; not a construction plan.",
);
let hash: string;
type Item = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  dir: string;
  hasEOL: boolean;
};
function text(
  str: string,
  x: number,
  baselineY: number,
  width = str.length * 4,
  height = 6,
): Item {
  return {
    str,
    transform: [height, 0, 0, height, x, 800 - baselineY],
    width,
    height,
    fontName: "test-font",
    dir: "ltr",
    hasEOL: false,
  };
}
function fakeDocument(
  items: Item[] = [],
  options: {
    pages?: number;
    rotation?: number;
    transform?: number[];
    width?: number;
    height?: number;
  } = {},
) {
  const page = {
    getViewport: () => ({
      width: options.width ?? 1200,
      height: options.height ?? 800,
      scale: 1,
      rotation: options.rotation ?? 0,
      transform: options.transform ?? [1, 0, 0, -1, 0, 800],
    }),
    getTextContent: async () => ({
      items,
      styles: { "test-font": { ascent: 0.8, descent: -0.2 } },
    }),
  };
  const document = {
    numPages: options.pages ?? 1,
    getPage: vi.fn(async () => page),
  };
  mocks.getDocument.mockReturnValue({
    promise: Promise.resolve(document),
    destroy: mocks.destroy,
  });
  return document;
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.destroy.mockResolvedValue(undefined);
  hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  fakeDocument();
});

describe("source-only printed measurement parsing", () => {
  it("parses composite feet, standalone fractions, mixed fractions, and explicit metric units", () => {
    const values = parsePrintedDimensions(
      '10\'-2"; 1/2"; 2-3/4 inches; 12.5 cm; 900 mm; 2 m',
    );
    const expected = [
      122,
      0.5,
      2.75,
      12.5 / 2.54,
      900 / 25.4,
      (2 * 1000) / 25.4,
    ];
    expect(values).toHaveLength(expected.length);
    values.forEach((value, index) =>
      expect(value.inches).toBeCloseTo(expected[index], 10),
    );
    expect(values[0].text).toBe("10'-2\"");
    expect(values[0].unit).toBe("ft");
  });
  it("normalizes unicode drafting primes and fractions without inventing unitless dimensions", () => {
    expect(normalizePrintedText("8′–6½″")).toBe("8'-6 1/2\"");
    expect(parsePrintedDimensions("8′–6½″")[0].inches).toBe(102.5);
    expect(parsePrintedDimensions("Room 120 x 240; area 600 SF")).toEqual([]);
  });
  it("does not accept invalid fractions, negative measurements, or invalid composite inches", () => {
    expect(parsePrintedDimensions('1/0"; -5 ft; 5\'-14"; 5.6.7 mm')).toEqual(
      [],
    );
  });
  it("retains offsets and repeated tokens rather than guessing a room association", () => {
    const source = "Pair (3'-0\" x 3'-0\")";
    const values = parsePrintedDimensions(source);
    expect(values).toHaveLength(2);
    for (const value of values)
      expect(source.slice(value.start, value.end)).toBe(value.text);
  });
  it.each(['1/4" = 1\'-0"', "SCALE 1:50", "N.T.S.", "NOT TO SCALE"])(
    "recognizes printed scale %s",
    (scale) => {
      expect(classifyPrintedScale(scale)).toBe(true);
    },
  );
  it("does not mistake an ordinary dimension or prose equality for drawing scale", () => {
    expect(classifyPrintedScale("8'-0\" CEILING")).toBe(false);
    expect(classifyPrintedScale("AREA = 600 SF")).toBe(false);
  });
});

describe("browser PDF extraction and provenance", () => {
  it("uses transformed display coordinates, preserves source evidence, and leaves every fact unreviewed", async () => {
    const item: Item = {
      str: "BEDROOM",
      transform: [0, -12, 12, 0, 550, 900],
      width: 60,
      height: 12,
      fontName: "test-font",
      dir: "ltr",
      hasEOL: false,
    };
    const document = fakeDocument([item], {
      pages: 14,
      rotation: 270,
      transform: [0, -1, -1, 0, 1224, 792],
      width: 1224,
      height: 792,
    });
    const result = await extractBrowserPlan(bytes, "test-document", 5, hash);
    expect(resultSchema.safeParse(result).success).toBe(true);
    expect(document.getPage).toHaveBeenCalledWith(5);
    expect(result.sourceSha256).toBe(hash);
    expect(result.page.rotation).toBe(270);
    expect(result.page.number).toBe(5);
    expect(result.page.width).toBe(1224);
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]).toMatchObject({
      kind: "room_label",
      label: "BEDROOM",
      page: 5,
      verification: "unreviewed",
      context: "label_only_boundary_unknown",
    });
    expect(result.elements[0].bbox.x).toBeCloseTo(324 / 1224);
    expect(result.elements[0].bbox.y).toBeCloseTo((242 - 12 * 0.8) / 792);
    expect(result.elements[0].bbox.width).toBeCloseTo(60 / 1224);
    expect(result.metrics.accuracy).toBe("unknown_until_independent_review");
    expect(result.warnings.join(" ")).toContain("No compliance checks");
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
  it("separates scales, dimensions, and prose notes while retaining original values", async () => {
    fakeDocument([
      text('1/4" = 1\'-0"', 100, 100),
      text("8'-0\" CEILING", 100, 200),
      text(
        "Provide a continuous approved clearance of 36 inches where detailed on the plan",
        100,
        300,
      ),
    ]);
    const result = await extractBrowserPlan(bytes, "test-document", 1, hash);
    expect(result.elements.map((element) => element.kind)).toEqual([
      "scale",
      "dimension",
      "annotation",
    ]);
    expect(result.elements[1].originalValue?.inches).toBe(96);
    expect(result.elements[1].context).toBe("printed_ceiling_height");
    expect(result.elements[2].context).toBe(
      "note_text_not_geometric_measurement",
    );
    expect(
      result.elements.every((element) => element.verification === "unreviewed"),
    ).toBe(true);
  });
  it("extracts explicit schedule rows as table evidence, never physical window locations", async () => {
    fakeDocument([
      text("WINDOW SCHEDULE", 140, 200, 90, 8),
      text("MARK", 100, 212),
      text("DIMENSION", 140, 212),
      text("TYPE", 210, 212),
      text("A", 100, 224),
      text("3'-0\" x 4'-0\"", 140, 224, 55),
      text("SLIDING", 210, 224),
      text("BEDROOM", 500, 300),
    ]);
    const result = await extractBrowserPlan(
      bytes,
      "schedule-document",
      1,
      hash,
    );
    const schedules = result.elements.filter(
      (element) => element.kind === "window_schedule",
    );
    expect(schedules).toHaveLength(1);
    expect(schedules[0].context).toBe("schedule_row_not_physical_location");
    expect(schedules[0].schedule).toMatchObject({
      mark: "A",
      type: "SLIDING",
      widthInches: 36,
      heightInches: 48,
    });
    expect(
      result.elements.filter((element) => element.kind === "dimension"),
    ).toHaveLength(0);
    expect(
      result.elements.filter((element) => element.kind === "room_label"),
    ).toHaveLength(1);
  });
  it("reports unreadable image-only PDF information as unknown", async () => {
    const result = await extractBrowserPlan(bytes, "raster-document", 1, hash);
    expect(result.elements).toEqual([]);
    expect(result.metrics.ocrTextSpanCount).toBe(0);
    expect(result.warnings.join(" ")).toContain(
      "All architectural facts remain unknown",
    );
  });
  it("rejects altered source bytes before sending them to PDF.js", async () => {
    await expect(
      extractBrowserPlan(bytes, "test", 1, "0".repeat(64)),
    ).rejects.toThrow("fingerprint");
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });
  it("validates page limits and releases the PDF worker after rejection", async () => {
    fakeDocument([], { pages: 101 });
    await expect(extractBrowserPlan(bytes, "test", 1, hash)).rejects.toThrow(
      "100 pages",
    );
    expect(mocks.destroy).toHaveBeenCalledOnce();
    fakeDocument([], { pages: 4 });
    await expect(extractBrowserPlan(bytes, "test", 5, hash)).rejects.toThrow(
      "between 1 and 4",
    );
    expect(mocks.destroy).toHaveBeenCalledTimes(2);
  });
  it("rejects non-PDF inputs and excessive file size before loading the worker", async () => {
    await expect(
      extractBrowserPlan(new TextEncoder().encode("PNG"), "test", 1, hash),
    ).rejects.toThrow("requires a PDF");
    await expect(
      extractBrowserPlan(new Uint8Array(20 * 1024 * 1024 + 1), "test", 1, hash),
    ).rejects.toThrow("20 MB");
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });
});
