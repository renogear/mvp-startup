import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import demoProject from "../../fixtures/demo-project.json";
import { test, expect } from "@playwright/test";
test("local workflow persists intake and generates an honest PDF report", async ({
  page,
}) => {
  await page.goto("/projects");
  await page.getByRole("button", { name: "Explore local demo" }).click();
  await page.getByRole("button", { name: "Create your first project" }).click();
  await page.getByLabel("Project name").fill("DEMO — Oak Street renovation");
  await page.getByLabel("Street address").fill("123 Example Street");
  await page.getByLabel("Mailing city").fill("San Jose");
  await page.getByLabel("ZIP code").fill("95112");
  await page.getByLabel("Kitchen / bathroom remodel", { exact: true }).check();
  await page.getByLabel("HVAC / mechanical", { exact: true }).check();
  await page
    .getByLabel("Describe the proposed work")
    .fill("Renovate kitchen and replace existing furnace.");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "DEMO — Oak Street renovation" }),
  ).toBeVisible();
  await page.getByLabel("Building jurisdiction").selectOption("san-jose");
  await page.getByLabel("I checked the property").check();
  await page.getByRole("button", { name: "Requirements", exact: true }).click();
  await expect(
    page.getByText("Official requirements are not yet verified"),
  ).toBeVisible();
  await page
    .getByLabel("Checklist item")
    .fill("Confirm application form with department");
  await page.getByRole("button", { name: "Add item" }).click();
  await page
    .getByLabel("Status for Confirm application")
    .selectOption("Complete");
  await page
    .getByRole("button", { name: "Readiness Report", exact: true })
    .click();
  await expect(
    page.getByText("Not verified or unsupported", { exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toContain(".pdf");
  await file.saveAs("artifacts/demo-readiness.pdf");
  const pdf = await PDFDocument.load(
    await readFile("artifacts/demo-readiness.pdf"),
  );
  expect(pdf.getPageCount()).toBeGreaterThan(0);
  await page.screenshot({
    path: "artifacts/readiness-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "Explore local demo" }).click();
  await page.getByRole("button", { name: /DEMO — Oak Street/ }).click();
  await expect(
    page.getByRole("heading", { name: "DEMO — Oak Street renovation" }),
  ).toBeVisible();
  await expect(page.getByLabel("Building jurisdiction")).toHaveValue(
    "san-jose",
  );
  await page.getByRole("button", { name: "All projects" }).click();
  await page.screenshot({
    path: "artifacts/dashboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/dashboard-mobile.png",
    fullPage: true,
  });
});
test("private endpoints reject unauthenticated requests", async ({
  request,
}) => {
  for (const endpoint of [
    "projects",
    "analyze",
    "report",
    "documents",
    "settings",
  ]) {
    const r = await request.post("/api/" + endpoint, {
      data: { projectId: "11111111-1111-4111-8111-111111111111" },
    });
    expect(r.ok()).toBe(false);
  }
});

test("edit, authority invalidation, upload restrictions, and delete are functional", async ({
  page,
}) => {
  await page.addInitScript(
    (project) =>
      localStorage.setItem("permitpilot-demo", JSON.stringify([project])),
    demoProject,
  );
  await page.goto("/projects");
  await page.getByRole("button", { name: "Explore local demo" }).click();
  await page.getByRole("button", { name: /DEMO — Oak Street/ }).click();
  await page.getByLabel("Building jurisdiction").selectOption("san-jose");
  await page.getByLabel("I checked the property").check();
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await page.getByLabel("Street address").fill("456 Updated Example Street");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByLabel("I checked the property")).not.toBeChecked();
  await expect(page.getByText("456 Updated Example Street,")).toBeVisible();
  await page
    .getByRole("button", { name: "Documents", exact: false })
    .filter({ hasText: "Documents" })
    .first()
    .click();
  await page.locator("input[type=file]").setInputFiles({
    name: "test.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 test document"),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "Private uploads" }),
  ).toContainText("Private uploads require a connected Supabase account");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Make room for your next project" }),
  ).toBeVisible();
});
