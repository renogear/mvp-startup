import { z } from "zod";

/** Technical checks are deliberately separate from administrative checklists. */
export const authoritySchema = z.enum([
  "unverified",
  "san-jose",
  "santa-clara-county",
  "san-diego-county",
  "other",
]);
const classificationSchema = z.enum([
  "adu",
  "new-single-family",
  "addition",
  "garage-conversion",
  "remodel",
  "whole-home",
  "structural",
  "other",
]);
const text = z.string().trim().min(1);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "A valid calendar date is required");
const httpsUrl = z
  .string()
  .url()
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return (
        parsed.protocol === "https:" && !parsed.username && !parsed.password
      );
    } catch {
      return false;
    }
  }, "A public HTTPS source without embedded credentials is required");
const provenanceSchema = z.object({
  ahj: authoritySchema,
  codeEdition: text,
  sourceUrls: z.array(httpsUrl).min(1),
  verifiedAt: date,
  reviewer: text,
  codeEditionVerified: z.boolean().optional(),
  localAmendmentsReviewed: z.boolean().optional(),
  residentialInstructionsReviewed: z.boolean().optional(),
  applicationApplicabilityReviewed: z.boolean().optional(),
});
export const regulatoryContextSchema = z.object({
  ahj: authoritySchema,
  jurisdictionStatus: z.enum([
    "unverified",
    "user_confirmed",
    "authoritative",
    "unsupported",
  ]),
  jurisdictionEvidence: z.string(),
  applicationDate: z.string(),
  classification: classificationSchema,
  construction: z.enum(["new", "existing", "unknown"]),
  codeEdition: z.string(),
  sourceUrl: z.string().optional(),
  documentAhj: authoritySchema.optional(),
  documentJurisdictionEvidence: z.string().optional(),
  codeContextVerified: z.boolean(),
  codeContextProvenance: provenanceSchema.optional(),
});
export type RegulatoryContext = z.infer<typeof regulatoryContextSchema>;

const bboxSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .refine(
    (box) => box.x + box.width <= 1.002 && box.y + box.height <= 1.002,
    "Evidence must remain within the source page",
  );
export const complianceMeasurementSchema = z.object({
  id: text,
  label: text,
  inches: z.number().finite().positive().nullable(),
  verification: z.enum([
    "unreviewed",
    "confirmed",
    "corrected",
    "rejected",
    "irrelevant",
    "unknown",
  ]),
  bbox: bboxSchema,
  page: z.number().int().positive(),
  sourceDocumentId: text.optional(),
});
export type ComplianceMeasurement = z.infer<typeof complianceMeasurementSchema>;

// Only these explicit predicates are executable. Unknown predicates fail validation.
const conditionSchema = z.discriminatedUnion("field", [
  z.strictObject({
    field: z.literal("classification"),
    equals: classificationSchema,
  }),
  z.strictObject({
    field: z.literal("construction"),
    equals: z.enum(["new", "existing"]),
  }),
]);
export const buildingCodeRuleSchema = z
  .strictObject({
    id: text,
    version: z.number().int().positive(),
    status: z.enum(["draft", "active", "retired"]),
    title: text,
    description: text,
    ahj: authoritySchema.exclude(["unverified"]),
    codeEdition: text,
    codeSection: text,
    sourceUrl: httpsUrl,
    adoptionSourceUrls: z.array(httpsUrl).min(1),
    effectiveFrom: date,
    effectiveTo: date.nullable(),
    sourceVerified: z.boolean(),
    applicabilityReviewed: z.boolean(),
    validated: z.boolean(),
    review: z.strictObject({
      reviewer: text,
      verifiedAt: date,
      method: text,
      validationEvidence: text,
    }),
    applicability: z.strictObject({
      classifications: z.array(classificationSchema).min(1),
      construction: z.array(z.enum(["new", "existing"])).min(1),
      exceptionsReviewed: z.boolean(),
      // Each matching predicate excludes the check. No inferred exceptions.
      exceptionConditions: z.array(conditionSchema),
      limitations: text,
    }),
    check: z.strictObject({
      measurementLabel: text,
      comparison: z.enum(["minimum", "maximum"]),
      thresholdInches: z.number().finite().positive(),
    }),
  })
  .refine(
    (rule) => !rule.effectiveTo || rule.effectiveTo >= rule.effectiveFrom,
    "The rule's final effective date cannot precede its first effective date",
  );
export type BuildingCodeRule = z.infer<typeof buildingCodeRuleSchema>;
export type ComplianceStatus =
  | "potential_issue"
  | "passed"
  | "missing_information"
  | "needs_clarification"
  | "not_evaluated";
export type ComplianceFinding = {
  id: string;
  title: string;
  status: ComplianceStatus;
  reason: string;
  ruleVersion: number | null;
  codeSection: string | null;
  sourceUrl: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  evidence: Array<{
    measurementId: string;
    page: number;
    bbox: ComplianceMeasurement["bbox"];
    sourceDocumentId?: string;
  }>;
};

type Candidate = {
  id: string;
  rule?: BuildingCodeRule;
  invalidReason?: string;
};
function latestRules(rules: readonly unknown[]): Candidate[] {
  const groups = new Map<string, unknown[]>();
  for (const [index, raw] of rules.entries()) {
    const id =
      typeof raw === "object" &&
      raw !== null &&
      "id" in raw &&
      typeof raw.id === "string" &&
      raw.id.trim()
        ? raw.id
        : `invalid-rule-${index}`;
    groups.set(id, [...(groups.get(id) || []), raw]);
  }
  return [...groups.entries()].map(([id, versions]) => {
    const numbered = versions.map((raw) => ({
      raw,
      version:
        typeof raw === "object" && raw !== null && "version" in raw
          ? raw.version
          : null,
    }));
    if (
      numbered.some(
        ({ version }) =>
          typeof version !== "number" ||
          !Number.isSafeInteger(version) ||
          version < 1,
      )
    )
      return {
        id,
        invalidReason:
          "Rule version metadata is invalid; earlier versions cannot be substituted.",
      };
    const newest = Math.max(
      ...numbered.map(({ version }) => version as number),
    );
    const selected = numbered.filter(({ version }) => version === newest);
    if (selected.length !== 1)
      return {
        id,
        invalidReason:
          "Duplicate current rule versions require registry review.",
      };
    const parsed = buildingCodeRuleSchema.safeParse(selected[0].raw);
    return parsed.success
      ? { id, rule: parsed.data }
      : {
          id,
          invalidReason:
            "Current rule schema, source, effective dates, or review metadata are incomplete or unsupported.",
        };
  });
}

function contextBlockers(context: RegulatoryContext): string[] {
  const parsed = regulatoryContextSchema.safeParse(context);
  if (!parsed.success)
    return [
      "Regulatory context is invalid or its verification metadata is incomplete.",
    ];
  const c = parsed.data;
  const blockers: string[] = [];
  if (
    c.ahj === "unverified" ||
    c.ahj === "other" ||
    c.jurisdictionStatus !== "authoritative" ||
    !c.jurisdictionEvidence.trim()
  )
    blockers.push(
      "The property's actual permitting authority requires authoritative verification and recorded evidence; mailing city, ZIP, and user confirmation are insufficient for technical checks.",
    );
  if (
    !c.documentAhj ||
    c.documentAhj === "unverified" ||
    !c.documentJurisdictionEvidence?.trim()
  )
    blockers.push(
      "The drawing's governing jurisdiction and supporting provenance have not been verified.",
    );
  else if (c.documentAhj !== c.ahj)
    blockers.push(
      "The drawing's jurisdiction differs from the project's authority. Cross-jurisdiction compliance evaluation is disabled.",
    );
  if (!date.safeParse(c.applicationDate).success)
    blockers.push(
      "Record the actual permit application date as a valid calendar date before selecting a code edition.",
    );
  if (c.classification === "other" || c.construction === "unknown")
    blockers.push(
      "The residential classification and new/existing construction applicability require review.",
    );
  if (!c.codeEdition.trim() || !c.codeContextVerified)
    blockers.push(
      "The applicable code edition and regulatory applicability have not been independently verified.",
    );
  const proof = c.codeContextProvenance;
  if (
    !proof ||
    proof.ahj !== c.ahj ||
    proof.codeEdition !== c.codeEdition ||
    !proof.codeEditionVerified ||
    !proof.localAmendmentsReviewed ||
    !proof.residentialInstructionsReviewed ||
    !proof.applicationApplicabilityReviewed
  )
    blockers.push(
      "Reviewed sources for the code edition, local amendments, residential instructions, and application-date applicability must be recorded for this exact authority and edition.",
    );
  return blockers;
}

function ruleBlockers(c: RegulatoryContext, rule: BuildingCodeRule): string[] {
  const blockers: string[] = [];
  if (rule.status !== "active")
    blockers.push(`Rule version ${rule.version} is ${rule.status}.`);
  if (
    !rule.sourceVerified ||
    !rule.applicabilityReviewed ||
    !rule.validated ||
    !rule.applicability.exceptionsReviewed
  )
    blockers.push(
      "The rule's source, applicability, exceptions, and executable behavior require independent review and validation.",
    );
  if (rule.ahj !== c.ahj)
    blockers.push("This rule belongs to a different permitting authority.");
  if (rule.codeEdition !== c.codeEdition)
    blockers.push("This rule belongs to a different code edition.");
  if (
    c.applicationDate < rule.effectiveFrom ||
    (rule.effectiveTo && c.applicationDate > rule.effectiveTo)
  )
    blockers.push(
      "This rule version is outside the actual permit application date's effective range.",
    );
  if (
    !rule.applicability.classifications.includes(c.classification) ||
    c.construction === "unknown" ||
    !rule.applicability.construction.includes(c.construction)
  )
    blockers.push(
      "The rule's reviewed residential classification or construction scope does not match this project.",
    );
  if (
    rule.applicability.exceptionConditions.some(
      (condition) => c[condition.field] === condition.equals,
    )
  )
    blockers.push(
      "A reviewed exception condition excludes this check; the result is not a compliance pass.",
    );
  return blockers;
}

/** Empty by design: no official machine-executable code rules are approved. */
export const approvedBuildingCodeRules: readonly BuildingCodeRule[] =
  Object.freeze([]);

export function regulatoryBlockers(
  context: RegulatoryContext,
  rules: readonly unknown[] = approvedBuildingCodeRules,
): string[] {
  const blockers = contextBlockers(context);
  const candidates = latestRules(rules);
  if (
    !candidates.some(
      ({ rule }) => rule && ruleBlockers(context, rule).length === 0,
    )
  )
    blockers.push(
      "No independently verified machine-executable rules are enabled for this authority, code edition, application date, and project classification.",
    );
  return blockers;
}

export function evaluateCompliance(
  context: RegulatoryContext,
  measurements: readonly ComplianceMeasurement[],
  rules: readonly unknown[] = approvedBuildingCodeRules,
) {
  const blockers = regulatoryBlockers(context, rules);
  const contextIssues = contextBlockers(context);
  const candidates = latestRules(rules);
  let enabledRuleCount = 0;
  const findings: ComplianceFinding[] = candidates.map(
    ({ id, rule, invalidReason }) => {
      const base: ComplianceFinding = {
        id,
        title: rule?.title || "Unverified rule definition",
        status: "not_evaluated",
        reason: "",
        ruleVersion: rule?.version ?? null,
        codeSection: rule?.codeSection ?? null,
        sourceUrl: rule?.sourceUrl ?? null,
        effectiveFrom: rule?.effectiveFrom ?? null,
        effectiveTo: rule?.effectiveTo ?? null,
        evidence: [],
      };
      const unavailable = [
        ...contextIssues,
        ...(rule ? ruleBlockers(context, rule) : [invalidReason!]),
      ];
      if (unavailable.length || !rule)
        return { ...base, reason: unavailable.join(" ") };
      enabledRuleCount++;
      const matches = measurements.filter(
        (measurement) =>
          measurement.label === rule.check.measurementLabel &&
          measurement.verification !== "rejected" &&
          measurement.verification !== "irrelevant",
      );
      if (matches.length !== 1)
        return {
          ...base,
          status: "needs_clarification",
          reason: matches.length
            ? "Multiple measurements match this check. Identify the intended architectural element before evaluation."
            : "The required measurement is missing. Locate and confirm its dimension on the original drawing.",
        };
      const parsed = complianceMeasurementSchema.safeParse(matches[0]);
      if (
        !parsed.success ||
        parsed.data.inches === null ||
        !parsed.data.sourceDocumentId ||
        !["confirmed", "corrected"].includes(parsed.data.verification)
      )
        return {
          ...base,
          status: "needs_clarification",
          reason:
            "The measurement, source page, and bounding box require human confirmation or correction. Extracted facts alone are not verified dimensions.",
        };
      const measurement = parsed.data;
      const passed =
        rule.check.comparison === "minimum"
          ? measurement.inches! >= rule.check.thresholdInches
          : measurement.inches! <= rule.check.thresholdInches;
      return {
        ...base,
        status: passed ? "passed" : "potential_issue",
        reason: passed
          ? "The human-confirmed dimension satisfies this single reviewed numerical predicate. This is not whole-plan compliance or permit approval."
          : "The human-confirmed dimension does not satisfy this reviewed numerical predicate. A qualified professional must assess applicability and resolve the potential issue.",
        evidence: [
          {
            measurementId: measurement.id,
            page: measurement.page,
            bbox: measurement.bbox,
            sourceDocumentId: measurement.sourceDocumentId,
          },
        ],
      };
    },
  );
  if (!findings.length)
    findings.push({
      id: "building-code-coverage",
      title: "Technical code evaluation is unavailable",
      status: "not_evaluated",
      reason: blockers.join(" "),
      ruleVersion: null,
      codeSection: null,
      sourceUrl: null,
      effectiveFrom: null,
      effectiveTo: null,
      evidence: [],
    });
  return {
    findings,
    blockers,
    enabledRuleCount,
    context: {
      ahj: context.ahj,
      jurisdictionStatus: context.jurisdictionStatus,
      jurisdictionEvidence: context.jurisdictionEvidence,
      documentAhj: context.documentAhj,
      documentJurisdictionEvidence: context.documentJurisdictionEvidence,
      applicationDate: context.applicationDate,
      classification: context.classification,
      construction: context.construction,
      codeEdition: context.codeEdition,
      codeContextVerified: context.codeContextVerified,
      codeContextProvenance: context.codeContextProvenance,
    },
  };
}
