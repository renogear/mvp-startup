import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { browserReport } from "../src/lib/plan/browser-report";
import {
  defaultContext,
  type Correction,
  type PlanJob,
  type Review,
} from "../src/lib/plan/schema";

const { loadPdf, renderPage, destroyPdf } = vi.hoisted(() => ({
  loadPdf: vi.fn(),
  renderPage: vi.fn(),
  destroyPdf: vi.fn(),
}));
vi.mock("pdfjs-dist", () => ({ getDocument: loadPdf }));
// Actual, tiny PNG bytes used to exercise PDF embedding. The DOM renderer is
// mocked here; Playwright covers rendering of the real uploaded source PDF.
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, toDataURL: () => png }),
  });
  renderPage.mockReturnValue({ promise: Promise.resolve() });
  loadPdf.mockReturnValue({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 100 * scale,
          height: 70 * scale,
        }),
        render: renderPage,
      }),
    }),
    destroy: destroyPdf.mockResolvedValue(undefined),
  });
});
afterEach(() => vi.unstubAllGlobals());

async function fixture() {
  const source = await PDFDocument.create();
  source.addPage([100, 70]);
  const bytes = new Uint8Array(await source.save());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  const review: Review = {
    id: "synthetic-document",
    ownerId: "synthetic-owner",
    organizationId: null,
    projectId: null,
    documentId: null,
    name: "Synthetic report test.pdf",
    mime: "application/pdf",
    size: bytes.length,
    sha256,
    context: { ...defaultContext, projectName: "Synthetic report test" },
    pageCount: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const job: PlanJob = {
    id: "synthetic-job",
    reviewId: review.id,
    page: 1,
    state: "complete",
    attempts: 1,
    createdAt: review.createdAt,
    startedAt: review.createdAt,
    finishedAt: review.createdAt,
    error: null,
    result: {
      schemaVersion: "synthetic-test-v1",
      documentId: review.id,
      sourceSha256: sha256,
      pageCount: 1,
      page: { number: 1, width: 100, height: 70, rotation: 0, kind: "vector" },
      elements: [
        {
          id: "synthetic-element",
          kind: "dimension",
          label: "7 ft",
          bbox: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 },
          page: 1,
          method: "embedded_text",
          confidence: "high",
          originalValue: { value: 7, unit: "ft", inches: 84 },
          evidence: "Synthetic unit-test evidence, not a code rule",
          verification: "unreviewed",
        },
      ],
      warnings: ["Synthetic fixture only"],
      metrics: { processingMs: 10, textSpanCount: 1 },
    },
  };
  return {
    review,
    job,
    original: new Blob([bytes], { type: review.mime }),
    bytes,
  };
}

describe("browser PDF evidence report", () => {
  it("renders the original bytes and creates clickable internal evidence references", async () => {
    const { review, job, original, bytes } = await fixture();
    const exported = await browserReport(review, job, [], original);
    expect(loadPdf.mock.calls[0][0].data).toEqual(bytes);
    expect(renderPage).toHaveBeenCalledOnce();
    expect(destroyPdf).toHaveBeenCalledOnce();
    const pdf = await PDFDocument.load(exported);
    expect(pdf.getSubject()).toContain("code compliance not evaluated");
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
    const drawing = pdf.getPages().at(-1)!;
    const annotations = drawing.node.lookup(PDFName.of("Annots"), PDFArray);
    expect(annotations.size()).toBe(1);
    const link = annotations.lookup(0, PDFDict);
    expect(link.lookup(PDFName.of("Subtype"), PDFName).toString()).toBe(
      "/Link",
    );
    expect(link.has(PDFName.of("A"))).toBe(false);
    const destination = link.lookup(PDFName.of("Dest"), PDFArray);
    expect(destination.get(0)).not.toEqual(drawing.ref);
    expect(pdf.getPages().some((page) => page.ref === destination.get(0))).toBe(
      true,
    );
    expect(drawing.node.Resources()?.toString()).toContain("/XObject");
  });

  it("rejects mismatched documents and stale source evidence before rendering", async () => {
    const { review, job, original } = await fixture();
    await expect(
      browserReport(
        review,
        { ...job, reviewId: "another-document" },
        [],
        original,
      ),
    ).rejects.toThrow("does not match");
    await expect(
      browserReport(review, job, [], new Blob(["replaced original"])),
    ).rejects.toThrow("does not match");
    expect(loadPdf).not.toHaveBeenCalled();
  });

  it("requires completed extraction and matching source page", async () => {
    const { review, job, original } = await fixture();
    await expect(
      browserReport(review, { ...job, state: "failed" }, [], original),
    ).rejects.toThrow("Complete extraction");
    await expect(
      browserReport(review, { ...job, page: 2 }, [], original),
    ).rejects.toThrow("does not match");
  });

  it("handles unicode corrections and long unbroken evidence without losing export", async () => {
    const { review, job, original } = await fixture();
    const correction: Correction = {
      id: "synthetic-correction",
      elementId: "synthetic-element",
      label: "Séjour — 7′–8″ 🏡",
      kind: "dimension",
      status: "corrected",
      value: 92,
      unit: "in",
      note: "Long evidence " + "x".repeat(2000),
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const pdf = await PDFDocument.load(
      await browserReport(review, job, [correction], original),
    );
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(pdf.getSubject()).toContain("human review");
  });
});
