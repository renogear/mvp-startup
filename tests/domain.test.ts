import { describe, it, expect } from "vitest";
import {
  projectSchema,
  projectRecordSchema,
  applicable,
  findings,
  extractionSchema,
  validateFile,
  categories,
  type Project,
  type Requirement,
} from "../src/lib/domain";
const project: Project = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Demo — Oak Street",
  address: "123 Example Street",
  city: "San Jose",
  state: "CA",
  zip: "95112",
  propertyType: "Single-family",
  categories: ["HVAC / mechanical"],
  description: "Replace an existing heating system",
  details: "",
  jurisdiction: "san-jose",
  confirmed: false,
  documents: [],
  checklist: [],
  created_at: "2026-10-19T00:00:00.000Z",
};
const fixture: Requirement = {
  id: "test-only",
  version: 1,
  jurisdiction: "san-jose",
  category: "HVAC / mechanical",
  title: "Synthetic applicability fixture",
  description: "Not an official rule",
  sourceUrl: "https://example.gov/test",
  effectiveDate: null,
  verifiedAt: "2026-10-19",
  verification: "verified",
  documentCategory: "Product specifications",
  limitations: "Test fixture only",
};
describe("project intake", () => {
  it("requires a real scope and selected category", () => {
    expect(
      projectSchema.safeParse({ ...project, categories: [] }).success,
    ).toBe(false);
    expect(
      projectSchema.safeParse({ ...project, description: "x" }).success,
    ).toBe(false);
  });
  it("accepts every residential category", () => {
    for (const c of categories)
      expect(
        projectSchema.safeParse({ ...project, categories: [c] }).success,
      ).toBe(true);
  });
  it("rejects confirmation of unknown jurisdiction", () =>
    expect(
      projectRecordSchema.safeParse({
        ...project,
        jurisdiction: "other",
        confirmed: true,
      }).success,
    ).toBe(false));
});
describe("deterministic coverage", () => {
  it("does not infer authority from mailing address", () =>
    expect(applicable(project, [fixture])).toEqual([]));
  it("matches confirmed authority and category only", () => {
    expect(applicable({ ...project, confirmed: true }, [fixture])).toHaveLength(
      1,
    );
    expect(
      applicable({ ...project, confirmed: true, jurisdiction: "santa-clara" }, [
        fixture,
      ]),
    ).toEqual([]);
  });
  it("excludes unverified and undated rules", () => {
    expect(
      applicable({ ...project, confirmed: true }, [
        { ...fixture, verification: "unverified" },
        { ...fixture, verifiedAt: null },
      ]),
    ).toEqual([]);
  });
  it("does not fabricate coverage for supported or unsupported categories", () => {
    for (const c of categories)
      expect(
        applicable({ ...project, categories: [c], confirmed: true }),
      ).toEqual([]);
  });
});
describe("readiness", () => {
  it("keeps coverage unsupported despite completed manual tasks", () => {
    const rows = findings({
      ...project,
      confirmed: true,
      checklist: [
        { id: "1", title: "Call department", status: "Complete", note: "Done" },
      ],
    });
    expect(rows.find((r) => r.id === "coverage")?.status).toBe(
      "Not verified or unsupported",
    );
    expect(rows.find((r) => r.id === "1")?.status).toBe("Complete");
  });
  it("requires jurisdiction confirmation independently", () =>
    expect(findings(project)[0].status).toBe("Needs clarification"));
});
describe("document validation", () => {
  it("rejects dangerous, oversized, and empty files", () => {
    for (const file of [
      { type: "text/html", size: 20 },
      { type: "application/pdf", size: 21 * 1024 * 1024 },
      { type: "image/png", size: 0 },
    ])
      expect(() => validateFile(file)).toThrow();
  });
  it("accepts supported files", () =>
    expect(() =>
      validateFile({ type: "application/pdf", size: 100 }),
    ).not.toThrow());
  it("accepts unknown extracted facts but rejects invented confidence/page types", () => {
    expect(
      extractionSchema.safeParse({
        facts: [
          { field: "address", value: null, page: null, confidence: "low" },
        ],
      }).success,
    ).toBe(true);
    expect(
      extractionSchema.safeParse({
        facts: [
          { field: "address", value: "123", page: 0, confidence: "verified" },
        ],
      }).success,
    ).toBe(false);
  });
});
describe("extraction review findings", () => {
  it("requires human review and retains source page", () => {
    const rows = findings({
      ...project,
      documents: [
        {
          id: "doc",
          name: "plans.pdf",
          type: "application/pdf",
          size: 100,
          category: "Floor plans",
          facts: [
            {
              field: "address",
              value: null,
              page: 2,
              confidence: "low",
              confirmed: false,
            },
          ],
        },
      ],
    });
    expect(
      rows.some((r) => r.reason.includes("plans.pdf, page 2: Unknown")),
    ).toBe(true);
  });
  it("flags a conflicting confirmed address", () => {
    const rows = findings({
      ...project,
      documents: [
        {
          id: "doc",
          name: "plans.pdf",
          type: "application/pdf",
          size: 100,
          category: "Floor plans",
          facts: [
            {
              field: "Project address",
              value: "999 Other Road",
              page: 1,
              confidence: "high",
              confirmed: true,
            },
          ],
        },
      ],
    });
    expect(
      rows.find((r) => r.title === "Reconcile project address")?.status,
    ).toBe("Needs clarification");
  });
});
it("does not apply future-dated requirements early", () =>
  expect(
    applicable(
      { ...project, confirmed: true },
      [{ ...fixture, effectiveDate: "2030-01-01" }],
      "2026-10-19",
    ),
  ).toEqual([]));
