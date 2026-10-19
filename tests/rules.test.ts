import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRules } from "../src/lib/rules";
const row = {
  id: "test-version",
  requirement_id: "test-rule",
  version: 2,
  title: "Synthetic test rule",
  description: "Test only",
  source_url: "https://example.gov/test",
  effective_date: null,
  verified_at: "2026-10-19",
  verification_status: "verified",
  required_support: "Product specifications",
  limitations: "Synthetic fixture",
  conditions: {},
  requirements: { jurisdiction_id: "san-jose", category: "HVAC / mechanical" },
};
const db = (data: unknown[]) =>
  ({
    from: () => ({
      select: () => ({ order: async () => ({ data, error: null }) }),
    }),
  }) as unknown as SupabaseClient;
it("loads only the latest verified version", async () => {
  const rules = await loadRules(db([row, { ...row, id: "older", version: 1 }]));
  expect(rules).toHaveLength(1);
  expect(rules[0].version).toBe(2);
});
it("does not resurrect a retired or unverified requirement", async () => {
  for (const state of ["retired", "unverified"])
    expect(
      await loadRules(
        db([
          { ...row, verification_status: state },
          { ...row, version: 1 },
        ]),
      ),
    ).toEqual([]);
});
it("fails closed for unsupported applicability conditions", async () => {
  expect(
    await loadRules(db([{ ...row, conditions: { unknownFlag: true } }])),
  ).toEqual([]);
});
