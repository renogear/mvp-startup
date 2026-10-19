import type { SupabaseClient } from "@supabase/supabase-js";
import type { Requirement } from "./domain";
import { z } from "zod";
const rowSchema = z.object({
  id: z.string(),
  version: z.number(),
  title: z.string(),
  description: z.string(),
  source_url: z.url(),
  effective_date: z.string().nullable(),
  verified_at: z.string(),
  verification_status: z.literal("verified"),
  required_support: z.string(),
  limitations: z.string(),
  conditions: z.strictObject({ propertyTypes: z.array(z.string()).optional() }),
  requirements: z.object({ jurisdiction_id: z.string(), category: z.string() }),
});
// New versions are immutable records; evaluate only the latest verified version per rule.
export async function loadRules(db: SupabaseClient): Promise<Requirement[]> {
  const { data, error } = await db
    .from("requirement_versions")
    .select("*, requirements!inner(jurisdiction_id,category)")
    .order("version", { ascending: false });
  if (error) throw error;
  const seen = new Set<string>();
  return (data || []).flatMap((raw) => {
    if (typeof raw.requirement_id !== "string" || seen.has(raw.requirement_id))
      return [];
    seen.add(raw.requirement_id);
    const row = rowSchema.safeParse(raw);
    if (!row.success) return [];
    const r = row.data;
    return [
      {
        id: r.id,
        version: r.version,
        jurisdiction: r.requirements.jurisdiction_id,
        category: r.requirements.category,
        title: r.title,
        description: r.description,
        sourceUrl: r.source_url,
        effectiveDate: r.effective_date,
        verifiedAt: r.verified_at,
        verification: "verified" as const,
        documentCategory: r.required_support,
        limitations: r.limitations,
        propertyTypes: r.conditions.propertyTypes,
      },
    ];
  });
}
