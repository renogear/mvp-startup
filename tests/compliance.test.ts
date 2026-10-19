import { describe, expect, it } from "vitest";
import {
  approvedBuildingCodeRules,
  buildingCodeRuleSchema,
  evaluateCompliance,
  regulatoryBlockers,
  type BuildingCodeRule,
  type ComplianceMeasurement,
  type RegulatoryContext,
} from "../src/lib/compliance";

// Independently authored synthetic predicates. No threshold is a building rule.
const syntheticRule: BuildingCodeRule = {
  id: "synthetic-test-dimension",
  version: 1,
  status: "active",
  title: "Synthetic numerical predicate — not a code requirement",
  description:
    "Test fixture only; this does not represent any official requirement.",
  ahj: "san-jose",
  codeEdition: "SYNTHETIC TEST EDITION — NOT LAW",
  codeSection: "SYNTHETIC-TEST-ONLY",
  sourceUrl: "https://example.invalid/synthetic",
  adoptionSourceUrls: ["https://example.invalid/synthetic-adoption"],
  effectiveFrom: "2030-01-01",
  effectiveTo: "2030-12-31",
  sourceVerified: true,
  applicabilityReviewed: true,
  validated: true,
  review: {
    reviewer: "Synthetic test reviewer",
    verifiedAt: "2030-01-01",
    method: "Synthetic unit-test fixture",
    validationEvidence: "No real regulatory authority",
  },
  applicability: {
    classifications: ["adu"],
    construction: ["new"],
    exceptionsReviewed: true,
    exceptionConditions: [],
    limitations: "Synthetic unit tests only",
  },
  check: {
    measurementLabel: "synthetic dimension",
    comparison: "minimum",
    thresholdInches: 123.45,
  },
};
function context(): RegulatoryContext {
  return {
    ahj: "san-jose",
    jurisdictionStatus: "authoritative",
    jurisdictionEvidence: "Synthetic authority evidence for unit tests only",
    documentAhj: "san-jose",
    documentJurisdictionEvidence: "Synthetic title-block evidence",
    applicationDate: "2030-06-01",
    classification: "adu",
    construction: "new",
    codeEdition: syntheticRule.codeEdition,
    codeContextVerified: true,
    codeContextProvenance: {
      ahj: "san-jose",
      codeEdition: syntheticRule.codeEdition,
      sourceUrls: ["https://example.invalid/synthetic-context"],
      verifiedAt: "2030-01-01",
      reviewer: "Synthetic reviewer",
      codeEditionVerified: true,
      localAmendmentsReviewed: true,
      residentialInstructionsReviewed: true,
      applicationApplicabilityReviewed: true,
    },
  };
}
function measurement(): ComplianceMeasurement {
  return {
    id: "measurement-test",
    label: "synthetic dimension",
    inches: 123.45,
    verification: "confirmed",
    bbox: { x: 0.1, y: 0.2, width: 0.2, height: 0.05 },
    page: 5,
    sourceDocumentId: "synthetic-document",
  };
}
function run(
  c: RegulatoryContext = context(),
  rules: unknown[] = [syntheticRule],
  measurements: ComplianceMeasurement[] = [measurement()],
) {
  return evaluateCompliance(c, measurements, rules);
}
function inactive(result: ReturnType<typeof evaluateCompliance>) {
  expect(result.enabledRuleCount).toBe(0);
  expect(
    result.findings.every((finding) => finding.status === "not_evaluated"),
  ).toBe(true);
  expect(result.blockers.length).toBeGreaterThan(0);
}

describe("technical evaluation starts closed", () => {
  it("ships no approved real-world rules or fabricated compliance results", () => {
    expect(approvedBuildingCodeRules).toEqual([]);
    inactive(evaluateCompliance(context(), [measurement()]));
    expect(evaluateCompliance(context(), []).findings[0].sourceUrl).toBeNull();
  });
  it("does not treat a 2025 code-edition string as verified law", () => {
    const c = {
      ...context(),
      codeEdition: "2025 California Residential Code",
      codeContextVerified: false,
    };
    inactive(run(c));
    expect(regulatoryBlockers(c).join(" ")).toContain("independently verified");
  });
  it.each(["unverified", "user_confirmed", "unsupported"] as const)(
    "does not treat %s jurisdiction status as authoritative",
    (jurisdictionStatus) => {
      inactive(run({ ...context(), jurisdictionStatus }));
    },
  );
  it("requires actual recorded jurisdiction evidence", () => {
    inactive(run({ ...context(), jurisdictionEvidence: " " }));
  });
  it("requires known document jurisdiction and provenance", () => {
    inactive(run({ ...context(), documentAhj: undefined }));
    inactive(run({ ...context(), documentJurisdictionEvidence: "" }));
  });
  it("never evaluates a San Diego drawing against San José rules", () => {
    const result = run({
      ...context(),
      documentAhj: "san-diego-county",
      documentJurisdictionEvidence:
        "County of San Diego PDS Plan F source and title block",
    });
    inactive(result);
    expect(result.findings[0].reason).toContain("Cross-jurisdiction");
  });
  it("keeps unincorporated Santa Clara County separate from the city", () => {
    inactive(
      run({
        ...context(),
        ahj: "santa-clara-county",
        documentAhj: "santa-clara-county",
      }),
    );
  });
  it.each(["other", "unverified"] as const)(
    "blocks unsupported authority %s",
    (ahj) => {
      inactive(run({ ...context(), ahj }));
    },
  );
  it("requires reviewed code-context provenance", () => {
    inactive(run({ ...context(), codeContextProvenance: undefined }));
  });
  it.each([
    "codeEditionVerified",
    "localAmendmentsReviewed",
    "residentialInstructionsReviewed",
    "applicationApplicabilityReviewed",
  ] as const)("requires %s review", (field) => {
    const c = context();
    c.codeContextProvenance![field] = false;
    inactive(run(c));
  });
  it("binds source provenance to the exact authority and edition", () => {
    const c = context();
    c.codeContextProvenance!.ahj = "san-diego-county";
    inactive(run(c));
    c.codeContextProvenance!.ahj = "san-jose";
    c.codeContextProvenance!.codeEdition = "OTHER SYNTHETIC EDITION";
    inactive(run(c));
  });
  it("rejects missing source/reviewer metadata and insecure source URLs", () => {
    for (const patch of [
      { reviewer: "" },
      { sourceUrls: [] },
      { sourceUrls: ["http://example.invalid/test"] },
      { verifiedAt: "2030-02-30" },
    ]) {
      const c = context();
      Object.assign(c.codeContextProvenance!, patch);
      inactive(run(c));
    }
  });
});

describe("deterministic regulatory applicability", () => {
  it.each(["", "2030-02-30", "2030-13-01", "30-01-01"])(
    "rejects absent or impossible actual application date %s",
    (applicationDate) => {
      inactive(run({ ...context(), applicationDate }));
    },
  );
  it("checks dates at both inclusive rule boundaries", () => {
    expect(
      run({ ...context(), applicationDate: "2030-01-01" }).findings[0].status,
    ).toBe("passed");
    expect(
      run({ ...context(), applicationDate: "2030-12-31" }).findings[0].status,
    ).toBe("passed");
    inactive(run({ ...context(), applicationDate: "2029-12-31" }));
    inactive(run({ ...context(), applicationDate: "2031-01-01" }));
  });
  it("does not substitute another code edition", () => {
    const c = context();
    c.codeEdition = "OTHER SYNTHETIC EDITION";
    c.codeContextProvenance!.codeEdition = c.codeEdition;
    inactive(run(c));
  });
  it("requires reviewed classification and construction applicability", () => {
    inactive(run({ ...context(), classification: "other" }));
    inactive(run({ ...context(), classification: "remodel" }));
    inactive(run({ ...context(), construction: "existing" }));
    inactive(run({ ...context(), construction: "unknown" }));
  });
  it.each(["sourceVerified", "applicabilityReviewed", "validated"] as const)(
    "requires positive %s for the rule",
    (field) => {
      inactive(run(context(), [{ ...syntheticRule, [field]: false }]));
    },
  );
  it("does not activate a rule with unreviewed exceptions", () => {
    inactive(
      run(context(), [
        {
          ...syntheticRule,
          applicability: {
            ...syntheticRule.applicability,
            exceptionsReviewed: false,
          },
        },
      ]),
    );
  });
  it("does not interpret an exception as a compliance pass", () => {
    inactive(
      run(context(), [
        {
          ...syntheticRule,
          applicability: {
            ...syntheticRule.applicability,
            exceptionConditions: [{ field: "classification", equals: "adu" }],
          },
        },
      ]),
    );
  });
  it("rejects unknown applicability fields and unknown exception conditions", () => {
    for (const applicability of [
      { ...syntheticRule.applicability, sprinklerPresent: true },
      {
        ...syntheticRule.applicability,
        exceptionConditions: [{ field: "unknown", equals: true }],
      },
      {
        ...syntheticRule.applicability,
        exceptionConditions: [
          { field: "classification", equals: "not-a-classification" },
        ],
      },
    ])
      inactive(run(context(), [{ ...syntheticRule, applicability }]));
  });
  it.each(["draft", "retired"] as const)(
    "cannot resurrect an older active version after %s",
    (status) => {
      inactive(
        run(context(), [
          syntheticRule,
          { ...syntheticRule, version: 2, status },
        ]),
      );
    },
  );
  it("does not fall back around broken current source or version metadata", () => {
    for (const newer of [
      { ...syntheticRule, version: 2, effectiveFrom: "" },
      {
        ...syntheticRule,
        version: 2,
        review: { ...syntheticRule.review, reviewer: "" },
      },
      { ...syntheticRule, version: 2, sourceUrl: "" },
      { ...syntheticRule, version: 2, codeSection: "" },
      { ...syntheticRule, version: 2, effectiveTo: "2029-01-01" },
      { ...syntheticRule, version: NaN },
    ])
      inactive(run(context(), [syntheticRule, newer]));
  });
  it("rejects ambiguous duplicate current rule versions", () => {
    inactive(run(context(), [syntheticRule, { ...syntheticRule }]));
  });
  it("records the selected rule version, code section, and source", () => {
    const result = run(context(), [
      syntheticRule,
      { ...syntheticRule, version: 2 },
    ]);
    expect(result.findings[0]).toMatchObject({
      ruleVersion: 2,
      codeSection: syntheticRule.codeSection,
      sourceUrl: syntheticRule.sourceUrl,
      effectiveFrom: "2030-01-01",
      effectiveTo: "2030-12-31",
    });
    expect(result.blockers).toEqual([]);
  });
});

describe("measurement evidence never becomes a guess", () => {
  it("evaluates an independently confirmed boundary deterministically", () => {
    const before = JSON.stringify({
      c: context(),
      m: measurement(),
      syntheticRule,
    });
    const result = run();
    expect(result.findings[0].status).toBe("passed");
    expect(result.findings[0].evidence).toEqual([
      {
        measurementId: "measurement-test",
        page: 5,
        bbox: measurement().bbox,
        sourceDocumentId: "synthetic-document",
      },
    ]);
    expect(result.context.applicationDate).toBe("2030-06-01");
    expect(result.findings[0].reason).toContain("not whole-plan compliance");
    expect(
      JSON.stringify({ c: context(), m: measurement(), syntheticRule }),
    ).toBe(before);
    expect(run()).toEqual(run());
  });
  it("reports a failed numerical predicate as a potential issue", () => {
    const result = run(
      context(),
      [syntheticRule],
      [{ ...measurement(), inches: 123.44 }],
    );
    expect(result.findings[0].status).toBe("potential_issue");
    expect(result.findings[0].reason).toContain("qualified professional");
  });
  it("supports an explicitly reviewed maximum predicate", () => {
    const rule = {
      ...syntheticRule,
      check: { ...syntheticRule.check, comparison: "maximum" },
    };
    expect(run(context(), [rule]).findings[0].status).toBe("passed");
    expect(
      run(context(), [rule], [{ ...measurement(), inches: 123.46 }]).findings[0]
        .status,
    ).toBe("potential_issue");
  });
  it.each(["unreviewed", "unknown", "rejected", "irrelevant"] as const)(
    "does not accept %s measurements",
    (verification) => {
      expect(
        run(context(), [syntheticRule], [{ ...measurement(), verification }])
          .findings[0].status,
      ).toBe("needs_clarification");
    },
  );
  it("accepts an explicit human correction with source evidence", () => {
    expect(
      run(
        context(),
        [syntheticRule],
        [{ ...measurement(), verification: "corrected" }],
      ).findings[0].status,
    ).toBe("passed");
  });
  it("marks missing and ambiguous measurements for clarification", () => {
    expect(run(context(), [syntheticRule], []).findings[0].status).toBe(
      "needs_clarification",
    );
    expect(
      run(
        context(),
        [syntheticRule],
        [measurement(), { ...measurement(), id: "duplicate" }],
      ).findings[0].status,
    ).toBe("needs_clarification");
  });
  it("does not fuzzy-match labels or infer an unstated dimension", () => {
    expect(
      run(
        context(),
        [syntheticRule],
        [{ ...measurement(), label: "Synthetic dimension?" }],
      ).findings[0].status,
    ).toBe("needs_clarification");
  });
  it("requires a finite positive dimension and valid document/page/box references", () => {
    for (const patch of [
      { inches: null },
      { inches: NaN },
      { inches: Infinity },
      { inches: 0 },
      { inches: -1 },
      { page: 0 },
      { sourceDocumentId: undefined },
      { bbox: { x: 0.99, y: 0, width: 0.2, height: 0.05 } },
    ]) {
      expect(
        run(context(), [syntheticRule], [{ ...measurement(), ...patch }])
          .findings[0].status,
      ).toBe("needs_clarification");
    }
  });
  it("rejects non-finite thresholds instead of inventing a fallback", () => {
    expect(
      buildingCodeRuleSchema.safeParse({
        ...syntheticRule,
        check: {
          ...syntheticRule.check,
          thresholdInches: Infinity,
        },
      }).success,
    ).toBe(false);
  });
});
