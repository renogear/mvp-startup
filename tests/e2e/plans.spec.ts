import { test, expect, type Locator, type Page } from "@playwright/test";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { PlanJob, Review, Correction } from "../../src/lib/plan/schema";

// Expected labels/counts below are assertions against an independently reviewed
// fixture. They never supply values to the extraction pipeline.
const planPath =
  process.env.PERMITPILOT_TEST_PDF ||
  "/workspace/attachments/bd1c58a9-9060-4e0f-83b2-d287702ca2a7/SAN DIEGO COUNTY PLOT PLAN.pdf";
const officialSource =
  "https://www.sandiegocounty.gov/content/dam/sdc/pds/bldg/adu_info/pds671_11x17.pdf";
const reviewName = "Official Plan F extraction baseline";

async function saveHumanReview(page: Page) {
  const response = page.waitForResponse(
    (value) =>
      value.url().endsWith("/corrections") &&
      value.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Save human review", exact: true })
    .click();
  expect((await response).ok()).toBe(true);
  await expect(
    page.getByRole("button", { name: "Save human review", exact: true }),
  ).toBeEnabled();
}

async function assertAligned(
  annotation: Locator,
  page: Page,
  box: { x: number; y: number; width: number; height: number },
) {
  const sheet = await page.locator(".plan-canvas-sheet").boundingBox();
  const actual = await annotation.boundingBox();
  expect(sheet).not.toBeNull();
  expect(actual).not.toBeNull();
  if (!sheet || !actual)
    throw new Error("Original drawing or annotation is not visible");
  expect(Math.abs(actual.x - sheet.x - box.x * sheet.width)).toBeLessThan(2);
  expect(Math.abs(actual.y - sheet.y - box.y * sheet.height)).toBeLessThan(2);
  expect(Math.abs(actual.width - box.width * sheet.width)).toBeLessThan(2);
  expect(Math.abs(actual.height - box.height * sheet.height)).toBeLessThan(2);
}

test("real A1 PDF extraction, source annotations, corrections, persistence, private access, and exports", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  test.skip(
    !existsSync(planPath),
    "Set PERMITPILOT_TEST_PDF to the lawfully obtained County of San Diego Plan F PDF; this fixture is not committed.",
  );
  await page.setViewportSize({ width: 1600, height: 1100 });
  const session = await page.request.get("/api/plans/session");
  const config = await session.json();
  test.skip(
    !config.enabled,
    "The local-only test requires PERMITPILOT_LOCAL_REVIEW=1 and a running npm run plan:worker process; cloud authentication is separate.",
  );
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await mkdir("artifacts", { recursive: true });
  await page.goto("/review");
  await page.getByRole("button", { name: "Open local workbench" }).click();
  await page.getByLabel("Project / review name").fill(reviewName);
  await page
    .getByLabel("Authority having jurisdiction")
    .selectOption("san-diego-county");
  await page.getByLabel("Document source URL").fill(officialSource);
  await expect(page.getByLabel("Permit application date")).toHaveValue("");
  await page.getByLabel("Original floor plan").setInputFiles(planPath);
  const savedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/plans") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Save original & open viewer" })
    .click();
  const saved = (await (await savedResponse).json()) as { review: Review };
  expect(saved.review.id).toBeTruthy();
  expect(saved.review.context.ahj).toBe("san-diego-county");
  expect(saved.review.context.jurisdictionStatus).toBe("unverified");
  expect(saved.review.context.codeEdition).toBe("");
  const originalBytes = await readFile(planPath);
  expect(saved.review.sha256).toBe(
    createHash("sha256").update(originalBytes).digest("hex"),
  );
  await expect(
    page.getByRole("heading", { name: reviewName, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("San Diego source plan · San José checks disabled."),
  ).toBeVisible();

  const pageInput = page.getByRole("spinbutton", { name: "PDF page number" });
  await expect(pageInput).toBeEnabled({ timeout: 30_000 });
  await pageInput.fill("5");
  await pageInput.press("Enter");
  await expect(pageInput).toHaveValue("5");
  await expect(page.locator(".plan-canvas-page-count")).toHaveText("of 14");
  await expect(page.locator(".plan-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
    { timeout: 30_000 },
  );
  await expect(
    page.getByRole("img", { name: "Original PDF, page 5", exact: true }),
  ).toBeVisible();
  // A1 is stored rotated 270 degrees. The displayed page must be landscape.
  const sourceCanvas = await page
    .locator(".plan-canvas-sheet canvas")
    .boundingBox();
  expect(sourceCanvas).not.toBeNull();
  expect(sourceCanvas!.width / sourceCanvas!.height).toBeCloseTo(1224 / 792, 2);
  const inkPixels = await page
    .locator(".plan-canvas-sheet canvas")
    .evaluate((canvas: HTMLCanvasElement) => {
      const { data } = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height);
      let ink = 0;
      for (let i = 0; i < data.length; i += 4 * 7)
        if (data[i] < 180 && data[i + 1] < 180 && data[i + 2] < 180) ink++;
      return ink;
    });
  expect(inkPixels).toBeGreaterThan(200);

  await page
    .getByRole("button", { name: "Extract this page", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "65 evidence candidates", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  const detailResponse = await page.request.get(
    `/api/plans/${saved.review.id}`,
  );
  const detail = (await detailResponse.json()) as {
    review: Review;
    jobs: PlanJob[];
    corrections: Correction[];
  };
  const job = detail.jobs.find((value) => value.page === 5)!;
  expect(job.state).toBe("complete");
  expect(job.result!.page.rotation).toBe(270);
  expect(job.result!.page.number).toBe(5);
  expect(job.result!.pageCount).toBe(14);
  expect(
    job.result!.elements.filter((element) => element.kind === "dimension"),
  ).toHaveLength(49);
  expect(
    job.result!.elements.filter((element) => element.kind === "room_label"),
  ).toHaveLength(6);
  expect(
    job.result!.elements.filter((element) => element.kind === "door_schedule"),
  ).toHaveLength(4);
  expect(
    job.result!.elements.filter(
      (element) => element.kind === "window_schedule",
    ),
  ).toHaveLength(4);
  expect(job.result!.metrics.processingMs).toBeGreaterThan(0);
  expect(
    job.result!.elements.every(
      (element) => element.verification === "unreviewed",
    ),
  ).toBe(true);
  await expect(page.getByTestId("plan-annotation")).toHaveCount(65);
  await page
    .getByRole("button", { name: "Dismiss notice", exact: true })
    .click();
  await page.screenshot({
    path: "artifacts/plan-review-desktop.png",
    fullPage: true,
  });

  await page.getByLabel("Filter evidence").selectOption("room_label");
  await expect(page.getByTestId("element-row")).toHaveCount(6);
  await expect(page.getByTestId("plan-annotation")).toHaveCount(6);
  const bedroom = job.result!.elements.find(
    (element) => element.kind === "room_label" && element.label === "BEDROOM",
  )!;
  expect(bedroom).toBeTruthy();
  const bedroomAnnotation = page.getByTestId("plan-annotation").filter({
    has: page.locator(".plan-canvas-annotation-label", {
      hasText: /^BEDROOM$/,
    }),
  });
  await assertAligned(bedroomAnnotation, page, bedroom.bbox);
  await bedroomAnnotation.click();
  await expect(
    page.getByRole("heading", { name: "Review room label", exact: true }),
  ).toBeVisible();
  await expect(bedroomAnnotation).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".original-evidence strong")).toHaveText("BEDROOM");
  await expect(page.locator(".coordinate-note")).toContainText(
    "Displayed-page box:",
  );
  await page
    .getByLabel("Review note")
    .fill(
      "Confirmed the BEDROOM label against the printed source drawing. This confirms text only.",
    );
  await saveHumanReview(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Review recorded." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.locator(".plan-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await assertAligned(bedroomAnnotation, page, bedroom.bbox);
  await page.screenshot({
    path: "artifacts/plan-review-selected-annotation.png",
    fullPage: true,
  });
  // Scroll the original to exercise annotation coordinates after movement.
  await page.locator(".plan-canvas-scroll").evaluate((element) => {
    element.scrollLeft += 45;
    element.scrollTop += 30;
  });
  await assertAligned(bedroomAnnotation, page, bedroom.bbox);
  await page
    .getByRole("button", { name: "Fit entire sheet", exact: true })
    .click();
  await expect(page.locator(".plan-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
  );

  await page
    .getByRole("button", { name: "All drawing evidence", exact: true })
    .click();
  await page.getByLabel("Filter evidence").selectOption("dimension");
  const measurement = job.result!.elements.find(
    (element) => element.kind === "dimension" && element.originalValue,
  )!;
  const originalValue = measurement.originalValue!.value;
  await page
    .locator(`[data-testid="element-row"][data-element-id="${measurement.id}"]`)
    .click();
  await expect(
    page.getByRole("heading", { name: "Review measurement", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Measurement value", { exact: true }),
  ).toHaveValue(String(originalValue));
  // Re-express the printed value in a different unit to test a real correction
  // without introducing an invented measurement into the exported artifact.
  const correctedUnit = measurement.originalValue!.unit === "ft" ? "in" : "ft";
  const correctedValue =
    measurement.originalValue!.inches / (correctedUnit === "ft" ? 12 : 1);
  await page
    .getByLabel("Measurement value", { exact: true })
    .fill(String(correctedValue));
  await page
    .getByRole("combobox", { name: "Unit", exact: true })
    .selectOption(correctedUnit);
  await expect(page.getByLabel("Review decision")).toHaveValue("corrected");
  await page
    .getByLabel("Review note")
    .fill(
      "TEST: re-expressed the printed dimension in a different unit to validate correction persistence. No new measurement or technical compliance is asserted.",
    );
  await saveHumanReview(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Review recorded." }),
  ).toBeVisible();
  const updated = (await (
    await page.request.get(`/api/plans/${saved.review.id}`)
  ).json()) as { jobs: PlanJob[]; corrections: Correction[] };
  expect(updated.corrections).toHaveLength(2);
  expect(
    updated.corrections.find((value) => value.elementId === measurement.id)!
      .value,
  ).toBe(correctedValue);
  expect(
    updated.corrections.find((value) => value.elementId === measurement.id)!
      .unit,
  ).toBe(correctedUnit);
  expect(
    updated.jobs
      .find((value) => value.id === job.id)!
      .result!.elements.find((element) => element.id === measurement.id)!
      .originalValue!.value,
  ).toBe(originalValue);
  await expect(page.locator(".original-evidence strong")).toHaveText(
    measurement.label,
  );
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review history", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".history-panel")
      .getByText("element reviewed", { exact: true }),
  ).toHaveCount(2);

  const jsonDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Structured JSON", exact: true })
    .click();
  await (await jsonDownload).saveAs("artifacts/plan-review-structured.json");
  const structured = JSON.parse(
    await readFile("artifacts/plan-review-structured.json", "utf8"),
  );
  expect(structured.compliance).toMatchObject({
    status: "not_evaluated",
    activeRules: 0,
  });
  expect(structured.corrections).toHaveLength(2);
  expect(
    structured.job.result.elements.find(
      (element: { id: string }) => element.id === measurement.id,
    ).originalValue.value,
  ).toBe(originalValue);
  const pdfDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export review", exact: true })
    .click();
  const report = await pdfDownload;
  expect(report.suggestedFilename()).toBe("PermitPilot-plan-review.pdf");
  await report.saveAs("artifacts/plan-review-report.pdf");
  const pdf = await PDFDocument.load(
    await readFile("artifacts/plan-review-report.pdf"),
  );
  expect(pdf.getPageCount()).toBeGreaterThan(2);
  expect(pdf.getSubject()).toContain("compliance not evaluated");
  const drawingPage = pdf.getPages().at(-1)!;
  expect(drawingPage.getWidth()).toBe(1190);
  expect(drawingPage.getHeight()).toBe(842);
  const embeddedImages = drawingPage.node
    .Resources()
    ?.lookup(PDFName.of("XObject"), PDFDict);
  expect(embeddedImages?.keys().length).toBeGreaterThan(0);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Plan reviews", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: new RegExp(reviewName) }).click();
  await expect(
    page.getByRole("heading", { name: "65 evidence candidates", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("spinbutton", { name: "PDF page number" }),
  ).toHaveValue("5");
  await expect(page.locator(".extraction-summary p")).toContainText(
    "2 human-reviewed",
  );
  await page.getByLabel("Filter evidence").selectOption("dimension");
  await page
    .locator(`[data-testid="element-row"][data-element-id="${measurement.id}"]`)
    .click();
  await expect(
    page.getByLabel("Measurement value", { exact: true }),
  ).toHaveValue(String(correctedValue));
  await expect(
    page.getByRole("combobox", { name: "Unit", exact: true }),
  ).toHaveValue(correctedUnit);
  await expect(page.getByLabel("Review note")).toHaveValue(
    /re-expressed the printed dimension/,
  );

  // Recreate the browser context with the persistent session cookie kept only
  // in memory, without writing authentication state to any artifact.
  const returning = await browser.newContext({
    storageState: await page.context().storageState(),
  });
  try {
    const returningPage = await returning.newPage();
    returningPage.setDefaultTimeout(15_000);
    await returningPage.goto("http://localhost:3000/review");
    await returningPage
      .getByRole("button", { name: new RegExp(reviewName) })
      .click();
    await expect(
      returningPage.getByRole("heading", {
        name: "65 evidence candidates",
        exact: true,
      }),
    ).toBeVisible();
    await returningPage.getByLabel("Filter evidence").selectOption("dimension");
    await returningPage
      .locator(
        `[data-testid="element-row"][data-element-id="${measurement.id}"]`,
      )
      .click();
    await expect(
      returningPage.getByLabel("Measurement value", { exact: true }),
    ).toHaveValue(String(correctedValue));
    await expect(
      returningPage.getByRole("combobox", { name: "Unit", exact: true }),
    ).toHaveValue(correctedUnit);
  } finally {
    await returning.close();
  }

  const outsider = await browser.newContext();
  try {
    for (const endpoint of [
      `/api/plans/${saved.review.id}`,
      `/api/plans/${saved.review.id}/file`,
      `/api/plans/${saved.review.id}/report?job=${job.id}`,
    ]) {
      expect(
        (await outsider.request.get(`http://localhost:3000${endpoint}`)).ok(),
      ).toBe(false);
    }
    expect(
      (
        await outsider.request.post(
          `http://localhost:3000/api/plans/${saved.review.id}/jobs`,
          { data: { page: 5 } },
        )
      ).ok(),
    ).toBe(false);
    expect(
      (
        await outsider.request.post(
          `http://localhost:3000/api/plans/${saved.review.id}/corrections`,
          { data: { jobId: job.id, correction: updated.corrections[0] } },
        )
      ).ok(),
    ).toBe(false);
    // A different valid local session must also be unable to access this owner.
    expect(
      (
        await outsider.request.post("http://localhost:3000/api/plans/session", {
          data: {},
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await outsider.request.get(
          `http://localhost:3000/api/plans/${saved.review.id}`,
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await outsider.request.get(
          `http://localhost:3000/api/plans/${saved.review.id}/file`,
        )
      ).ok(),
    ).toBe(false);
    expect(
      (
        await outsider.request.post(
          `http://localhost:3000/api/plans/${saved.review.id}/jobs`,
          { data: { page: 5 } },
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await outsider.request.post(
          `http://localhost:3000/api/plans/${saved.review.id}/corrections`,
          { data: { jobId: job.id, correction: updated.corrections[0] } },
        )
      ).status(),
    ).toBe(404);
  } finally {
    await outsider.close();
  }
  expect(browserErrors).toEqual([]);
});
