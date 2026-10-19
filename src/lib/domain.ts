import { z } from "zod";
export const categories = [
  "ADU / garage conversion",
  "Residential addition",
  "Kitchen / bathroom remodel",
  "Whole-home renovation",
  "New single-family home",
  "Structural alteration",
  "HVAC / mechanical",
  "Electrical",
  "Plumbing",
  "Roofing",
  "Solar / battery storage",
] as const;
export const projectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(200),
  city: z.string().trim().min(2).max(100),
  state: z.string().length(2),
  zip: z.string().regex(/^\d{5}$/),
  propertyType: z.enum([
    "Single-family",
    "Duplex",
    "Townhouse",
    "Other residential",
  ]),
  categories: z.array(z.enum(categories)).min(1),
  description: z.string().trim().min(10).max(4000),
  details: z.string().max(2000),
});
export type Intake = z.infer<typeof projectSchema>;
export type Fact = {
  field: string;
  value: string | null;
  page: number | null;
  confidence: "high" | "medium" | "low";
  confirmed: boolean;
};
export type Doc = {
  id: string;
  name: string;
  type: string;
  size: number;
  category: string;
  path?: string;
  facts?: Fact[];
};
export type ManualItem = {
  id: string;
  title: string;
  status: Status;
  note: string;
};
export type Project = Intake & {
  id: string;
  organization_id?: string;
  created_at: string;
  jurisdiction: string;
  confirmed: boolean;
  documents: Doc[];
  checklist: ManualItem[];
};
export const statuses = [
  "Complete",
  "Missing",
  "Needs clarification",
  "Needs professional review",
  "Not applicable",
  "Not verified or unsupported",
] as const;
export type Status = (typeof statuses)[number];
export const jurisdictions = [
  {
    id: "san-jose",
    name: "City of San José",
    department: "San José Building Division",
    url: "https://www.sanjoseca.gov/your-government/departments-offices/planning-building-code-enforcement/building-division",
    portal: "https://sjpermits.org",
  },
  {
    id: "santa-clara",
    name: "Santa Clara County (unincorporated)",
    department: "County Department of Planning and Development",
    url: "https://plandev.santaclaracounty.gov/",
    portal: "https://aca-prod.accela.com/SCCGOV/",
  },
];
export const extractionSchema = z.object({
  facts: z.array(
    z.object({
      field: z.string(),
      value: z.string().nullable(),
      page: z.number().int().positive().nullable(),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
});
export type Requirement = {
  id: string;
  version: number;
  jurisdiction: string;
  category: string;
  title: string;
  description: string;
  sourceUrl: string;
  effectiveDate: string | null;
  verifiedAt: string | null;
  verification: "verified" | "unverified";
  documentCategory: string;
  limitations: string;
  propertyTypes?: string[];
};
// Deliberately empty until an official source has been retrieved and reviewed.
export const requirements: Requirement[] = [];
export function applicable(
  p: Project,
  rules: Requirement[] = requirements,
  onDate = new Date().toISOString().slice(0, 10),
) {
  return rules.filter(
    (r) =>
      r.verification === "verified" &&
      r.verifiedAt &&
      (!r.effectiveDate || r.effectiveDate <= onDate) &&
      r.jurisdiction === p.jurisdiction &&
      p.confirmed &&
      p.categories.includes(r.category as (typeof categories)[number]) &&
      (!r.propertyTypes?.length || r.propertyTypes.includes(p.propertyType)),
  );
}
export function findings(p: Project, rules: Requirement[] = requirements) {
  const matched = applicable(p, rules);
  return [
    {
      id: "authority",
      title: "Confirm the permitting authority",
      status: (p.confirmed ? "Complete" : "Needs clarification") as Status,
      reason: p.confirmed
        ? "Manually confirmed by the project owner; parcel boundaries have not been independently verified."
        : "Mailing city and ZIP do not establish jurisdiction.",
      action:
        "Check the parcel with the city or county, then record your confirmation.",
    },
    {
      id: "coverage",
      title: "Official requirements coverage",
      status: "Not verified or unsupported" as Status,
      reason: matched.length
        ? `${matched.length} verified requirement version(s) match. Coverage may be incomplete; remaining categories remain unsupported. Manual tasks are not official requirements.`
        : "No official requirement versions have been verified for this project. Manual items are preparation tasks, not government requirements.",
      action: "Confirm the application checklist with the building department.",
    },
    {
      id: "documents",
      title: "Application documents",
      status: (p.documents.length
        ? "Needs clarification"
        : "Missing") as Status,
      reason: p.documents.length
        ? `${p.documents.length} document(s) uploaded. Presence alone does not establish completeness or suitability.`
        : "No project documents have been uploaded.",
      action:
        "Compare uploaded documents with the department checklist and confirm their content.",
    },
    ...p.documents.flatMap((d) =>
      (d.facts || [])
        .filter((f) => !f.confirmed || !f.value)
        .map((f, i) => ({
          id: `fact-${d.id}-${i}`,
          title: `Review ${f.field}`,
          status: "Needs clarification" as Status,
          reason: `${d.name}${f.page ? `, page ${f.page}` : ""}: ${f.value || "Unknown"}. ${f.confirmed ? "Value missing." : "Not human-confirmed."}`,
          action:
            "Inspect the source document, correct the value if needed, then confirm it in AI Review.",
        })),
    ),
    ...p.documents.flatMap((d) =>
      (d.facts || [])
        .filter(
          (f) =>
            f.confirmed &&
            f.value &&
            /address/i.test(f.field) &&
            !f.value.toLowerCase().includes(p.address.toLowerCase()),
        )
        .map((f, i) => ({
          id: `address-${d.id}-${i}`,
          title: "Reconcile project address",
          status: "Needs clarification" as Status,
          reason: `${d.name}${f.page ? `, page ${f.page}` : ""} lists ${f.value}, which does not match the intake address exactly. Address abbreviations may need manual review.`,
          action:
            "Check the intake and source document against the property record.",
        })),
    ),
    ...matched.map((r) => ({
      id: r.id,
      title: r.title,
      status: (p.documents.some((d) => d.category === r.documentCategory)
        ? "Needs clarification"
        : "Missing") as Status,
      reason: `${r.description} Required support: ${r.documentCategory}. ${r.limitations}`,
      action:
        "Review the supporting document against the cited requirement. Document presence does not verify its content.",
      sourceUrl: r.sourceUrl,
      version: r.version,
    })),
    ...p.checklist.map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      reason:
        i.note ||
        "User-maintained preparation item; no official requirement attached.",
      action:
        i.status === "Complete"
          ? "Retain supporting evidence."
          : "Review this item and attach supporting information.",
    })),
  ];
}
export function validateFile(file: { size: number; type: string }) {
  if (file.size > 20 * 1024 * 1024 || file.size === 0)
    throw new Error("Choose a nonempty file up to 20 MB.");
  if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type))
    throw new Error("Only PDF, JPG, and PNG files are supported.");
}
export const projectRecordSchema = projectSchema
  .extend({
    id: z.uuid(),
    created_at: z.iso.datetime(),
    organization_id: z.uuid().optional(),
    jurisdiction: z.enum(["", "san-jose", "santa-clara", "other"]),
    confirmed: z.boolean(),
    documents: z
      .array(
        z.object({
          id: z.uuid(),
          name: z.string().max(255),
          type: z.enum(["application/pdf", "image/jpeg", "image/png"]),
          size: z.number().positive().max(20971520),
          category: z.string().max(100),
          path: z.string().optional(),
          facts: z
            .array(
              z.object({
                field: z.string().max(200),
                value: z.string().max(4000).nullable(),
                page: z.number().int().positive().nullable(),
                confidence: z.enum(["high", "medium", "low"]),
                confirmed: z.boolean(),
              }),
            )
            .max(100)
            .optional(),
        }),
      )
      .max(100),
    checklist: z
      .array(
        z.object({
          id: z.uuid(),
          title: z.string().min(1).max(300),
          status: z.enum(statuses),
          note: z.string().max(3000),
        }),
      )
      .max(100),
  })
  .refine(
    (p) => !p.confirmed || ["san-jose", "santa-clara"].includes(p.jurisdiction),
    "Select a known jurisdiction before confirmation.",
  );
