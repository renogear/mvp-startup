import { z } from "zod";
export const boxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine(
    (b) => b.x + b.width <= 1.002 && b.y + b.height <= 1.002,
    "Box outside displayed page",
  );
export const measurementSchema = z.object({
  value: z.number().finite().nonnegative(),
  unit: z.enum(["in", "ft", "mm", "cm", "m"]),
  inches: z.number().finite().nonnegative(),
});
export const elementSchema = z
  .object({
    id: z.string().min(1).max(128),
    kind: z.enum([
      "room_label",
      "dimension",
      "scale",
      "door_schedule",
      "window_schedule",
      "annotation",
    ]),
    label: z.string().max(4000),
    bbox: boxSchema,
    page: z.number().int().positive(),
    method: z.enum(["embedded_text", "ocr"]),
    confidence: z.enum(["high", "medium", "low"]),
    originalValue: measurementSchema.nullable().optional(),
    evidence: z.string().max(16000),
    verification: z.literal("unreviewed"),
  })
  .passthrough();
export type Element = z.infer<typeof elementSchema>;
export type Box = z.infer<typeof boxSchema>;
export const resultSchema = z
  .object({
    schemaVersion: z.string(),
    documentId: z.string(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    pageCount: z.number().int().positive(),
    page: z
      .object({
        number: z.number().int().positive(),
        width: z.number().positive(),
        height: z.number().positive(),
        rotation: z.number(),
        kind: z.string(),
      })
      .passthrough(),
    elements: z.array(elementSchema).max(10000),
    textSpans: z
      .array(
        z.object({
          text: z.string(),
          bbox: boxSchema,
          page: z.number(),
          method: z.string(),
        }),
      )
      .max(30000)
      .optional(),
    warnings: z.array(z.string()),
    metrics: z
      .object({
        processingMs: z.number().nonnegative(),
        textSpanCount: z.number().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();
export type PlanResult = z.infer<typeof resultSchema>;
export const contextSchema = z.object({
  projectName: z.string().trim().min(2).max(120),
  address: z.string().max(300),
  ahj: z.enum([
    "unverified",
    "san-jose",
    "santa-clara-county",
    "san-diego-county",
    "other",
  ]),
  jurisdictionStatus: z.enum([
    "unverified",
    "user_confirmed",
    "authoritative",
    "unsupported",
  ]),
  jurisdictionEvidence: z.string().max(2000),
  applicationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal("")),
  classification: z.enum([
    "adu",
    "new-single-family",
    "addition",
    "garage-conversion",
    "remodel",
    "whole-home",
    "structural",
    "other",
  ]),
  construction: z.enum(["new", "existing", "unknown"]),
  codeEdition: z.string().max(120),
  sourceUrl: z.string().url().or(z.literal("")),
});
export type ReviewContext = z.infer<typeof contextSchema>;
export const correctionSchema = z.object({
  elementId: z.string().max(128),
  label: z.string().trim().min(1).max(4000),
  kind: z.enum([
    "room_label",
    "dimension",
    "scale",
    "door_schedule",
    "window_schedule",
    "annotation",
  ]),
  status: z.enum(["confirmed", "corrected", "rejected", "irrelevant"]),
  value: z.number().finite().nonnegative().nullable(),
  unit: z.enum(["in", "ft", "mm", "cm", "m"]),
  note: z.string().max(3000),
});
export type Correction = z.infer<typeof correctionSchema> & {
  id: string;
  createdAt: string;
};
export type Review = {
  id: string;
  ownerId: string;
  organizationId: string | null;
  projectId: string | null;
  documentId: string | null;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  context: ReviewContext;
  pageCount: number | null;
  createdAt: string;
};
export type PlanJob = {
  id: string;
  reviewId: string;
  page: number;
  state: "queued" | "processing" | "complete" | "failed";
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  result: PlanResult | null;
};
export const defaultContext: ReviewContext = {
  projectName: "Untitled plan review",
  address: "",
  ahj: "unverified",
  jurisdictionStatus: "unverified",
  jurisdictionEvidence: "",
  applicationDate: "",
  classification: "adu",
  construction: "unknown",
  codeEdition: "",
  sourceUrl: "",
};
export function unitInches(value: number, unit: string) {
  const multipliers: Record<string, number> = {
    in: 1,
    ft: 12,
    mm: 1 / 25.4,
    cm: 1 / 2.54,
    m: 1000 / 25.4,
  };
  if (!(unit in multipliers) || !Number.isFinite(value) || value < 0)
    throw new Error("Invalid measurement");
  return value * multipliers[unit];
}
export function effectiveElements(
  result: PlanResult,
  corrections: Correction[],
) {
  const latest = new Map<string, Correction>();
  for (const c of corrections) latest.set(c.elementId, c);
  return result.elements.map((e) => {
    const c = latest.get(e.id);
    return {
      element: e,
      correction: c || null,
      label: c?.label || e.label,
      kind: c?.kind || e.kind,
      status: c?.status || "unreviewed",
      measurement:
        c && c.value !== null
          ? {
              value: c.value,
              unit: c.unit,
              inches: unitInches(c.value, c.unit),
            }
          : e.originalValue || null,
    };
  });
}
