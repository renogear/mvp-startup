import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { PDFArray, PDFDocument, PDFName } from "pdf-lib";
import type { PlanJob, Correction } from "../../src/lib/plan/schema";

async function exportJson(page: Page, path: string) {
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Structured JSON", exact: true })
    .click();
  await (await download).saveAs(path);
  return JSON.parse(await readFile(path, "utf8")) as {
    job: PlanJob;
    corrections: Correction[];
    compliance: { activeRules: number; status: string };
  };
}

test("real sample, clickable evidence, saved correction, offline operation and annotated PDF", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      !request.url().startsWith("http://127.0.0.1:3089/PermitPilot.html")
    )
      external.push(request.url());
  });
  await page.goto("/PermitPilot.html");
  await expect(
    page.getByRole("heading", {
      name: "San Diego Plan F · A1 reference",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "65 evidence candidates", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".plan-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByTestId("plan-annotation")).toHaveCount(65);
  const baseline = await exportJson(page, info.outputPath("baseline.json"));
  const result = baseline.job.result!;
  expect(result.elements.filter((e) => e.kind === "dimension")).toHaveLength(
    49,
  );
  expect(result.elements.filter((e) => e.kind === "room_label")).toHaveLength(
    6,
  );
  expect(baseline.compliance).toMatchObject({
    activeRules: 0,
    status: "not_evaluated",
  });

  await page.getByLabel("Filter evidence").selectOption("room_label");
  const annotation = page.getByTestId("plan-annotation").filter({
    has: page.locator(".plan-canvas-annotation-label", {
      hasText: /^BEDROOM$/,
    }),
  });
  await annotation.click();
  await expect(page.locator(".original-evidence strong")).toHaveText("BEDROOM");
  await expect(annotation).toHaveAttribute("aria-pressed", "true");
  const bedroom = result.elements.find(
    (e) => e.kind === "room_label" && e.label === "BEDROOM",
  )!;
  const sheet = await page.locator(".plan-canvas-sheet").boundingBox();
  const box = await annotation.boundingBox();
  expect(
    Math.abs(box!.x - sheet!.x - bedroom.bbox.x * sheet!.width),
  ).toBeLessThan(2);
  expect(
    Math.abs(box!.y - sheet!.y - bedroom.bbox.y * sheet!.height),
  ).toBeLessThan(2);
  await page
    .getByRole("button", { name: "All drawing evidence", exact: true })
    .click();
  await page.getByLabel("Filter evidence").selectOption("dimension");
  const measurement = result.elements.find(
    (e) => e.kind === "dimension" && e.originalValue,
  )!;
  await page
    .locator(`[data-testid="element-row"][data-element-id="${measurement.id}"]`)
    .click();
  await page
    .getByLabel("Measurement value", { exact: true })
    .fill(String(measurement.originalValue!.inches));
  await page
    .getByRole("combobox", { name: "Unit", exact: true })
    .selectOption("in");
  await page
    .getByLabel("Review note")
    .fill("Re-expressed the printed dimension in inches; text review only.");
  await page
    .getByRole("button", { name: "Save human review", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Review recorded");
  const corrected = await exportJson(page, info.outputPath("corrected.json"));
  expect(corrected.corrections).toHaveLength(1);
  expect(corrected.corrections[0]).toMatchObject({
    unit: "in",
    value: measurement.originalValue!.inches,
  });
  expect(
    corrected.job.result!.elements.find((e) => e.id === measurement.id)!
      .originalValue,
  ).toEqual(measurement.originalValue);
  await page.reload();
  await page
    .getByRole("button", { name: /San Diego Plan F · A1 reference/ })
    .click();
  const restored = await exportJson(page, info.outputPath("restored.json"));
  expect(restored.corrections).toEqual(corrected.corrections);

  // The loaded application does not need its static host to remain online.
  await page.context().setOffline(true);
  const pdfDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export review", exact: true })
    .click();
  const pdfPath = info.outputPath("actual-browser-report.pdf");
  await (await pdfDownload).saveAs(pdfPath);
  const pdf = await PDFDocument.load(await readFile(pdfPath));
  expect(pdf.getPageCount()).toBeGreaterThan(2);
  expect(pdf.getSubject()).toContain("code compliance not evaluated");
  const drawing = pdf.getPages().at(-1)!;
  expect(drawing.node.Resources()?.toString()).toContain("/XObject");
  expect(drawing.node.lookup(PDFName.of("Annots"), PDFArray).size()).toBe(65);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({
    path: "artifacts/browser-prototype.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("upload the full 14-page drawing, extract page5, preserve it and delete it", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const source =
    process.env.PERMITPILOT_TEST_PDF ||
    "/workspace/attachments/bd1c58a9-9060-4e0f-83b2-d287702ca2a7/SAN DIEGO COUNTY PLOT PLAN.pdf";
  test.skip(
    !existsSync(source),
    "A lawfully obtained full source PDF is required for this regression.",
  );
  await page.goto("/PermitPilot.html");
  await expect(
    page.getByRole("heading", { name: "65 evidence candidates", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "All reviews", exact: true }).click();
  await page
    .getByRole("button", { name: "New plan review", exact: true })
    .click();
  await page
    .getByLabel("Project / review name")
    .fill("Uploaded original Plan F");
  await page
    .getByLabel("Authority having jurisdiction")
    .selectOption("san-diego-county");
  await page.getByLabel("Original floor plan").setInputFiles(source);
  await page
    .getByRole("button", { name: "Save original & open viewer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Uploaded original Plan F",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".plan-canvas-page-count")).toHaveText("of 14");
  const number = page.getByRole("spinbutton", { name: "PDF page number" });
  await number.fill("5");
  await number.press("Enter");
  await page
    .getByRole("button", { name: "Extract this page", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "65 evidence candidates", exact: true }),
  ).toBeVisible();
  const extracted = await exportJson(
    page,
    info.outputPath("uploaded-original.json"),
  );
  expect(extracted.job.page).toBe(5);
  expect(extracted.job.result!.sourceSha256).toBe(
    "89dbbd8f7977d772df44a4eea1a0ec35d795d9830538e3aa1e29f8d5bfe10bdc",
  );
  await page.reload();
  await page.getByRole("button", { name: /Uploaded original Plan F/ }).click();
  await expect(number).toHaveValue("5");
  await expect(
    page.getByRole("heading", { name: "65 evidence candidates", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete local review", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Uploaded original Plan F/ }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Uploaded original Plan F/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /San Diego Plan F · A1 reference/ }),
  ).toHaveCount(1);
});

test("blocked browser storage still permits honest temporary review", async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "indexedDB", { get: () => undefined }),
  );
  await page.goto("/PermitPilot.html");
  await expect(page.locator(".prototype-notice")).toContainText(
    "Temporary session",
  );
  await expect(
    page.getByRole("heading", { name: "65 evidence candidates", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".plan-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByLabel("Filter evidence").selectOption("room_label");
  await page.getByTestId("element-row").filter({ hasText: "BEDROOM" }).click();
  await page
    .getByLabel("Review note")
    .fill("Temporary-session review; exported before closing.");
  await page
    .getByRole("button", { name: "Save human review", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Review recorded" }),
  ).toBeVisible();
  const exported = await exportJson(
    page,
    info.outputPath("temporary-review.json"),
  );
  expect(exported.corrections).toHaveLength(1);
  expect(exported.compliance.activeRules).toBe(0);
  await page.reload();
  await expect(page.locator(".prototype-notice")).toContainText(
    "Temporary session",
  );
  await expect(
    page.getByRole("heading", { name: "65 evidence candidates", exact: true }),
  ).toBeVisible();
  const reset = await exportJson(
    page,
    info.outputPath("new-temporary-session.json"),
  );
  expect(reset.corrections).toHaveLength(0);
});
