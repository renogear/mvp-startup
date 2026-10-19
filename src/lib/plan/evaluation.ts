import { evaluateCompliance, type RegulatoryContext } from "../compliance";
import {
  effectiveElements,
  type ReviewContext,
  type PlanResult,
  type Correction,
} from "./schema";
/** Publisher detection is a veto against applying another AHJ's rules, never parcel verification. */
export function evaluateReview(
  context: ReviewContext,
  result: PlanResult,
  corrections: Correction[],
) {
  const text = (result.textSpans || []).map((s) => s.text).join(" ");
  let documentAhj: RegulatoryContext["documentAhj"];
  let evidence: string | undefined;
  if (
    /COUNTY\s+OF\s+SAN\s+DIEGO/i.test(text) ||
    /^https:\/\/(www\.)?sandiegocounty\.gov\//i.test(context.sourceUrl)
  ) {
    documentAhj = "san-diego-county";
    evidence =
      "County of San Diego publisher/title-block evidence. This veto does not verify any project parcel or governing current code.";
  }
  const regulatoryContext: RegulatoryContext = {
    ...context,
    documentAhj,
    documentJurisdictionEvidence: evidence,
    codeContextVerified: false,
  };
  const facts = effectiveElements(result, corrections)
    .filter((v) => v.kind === "dimension")
    .map((v) => ({
      id: v.element.id,
      label: v.label,
      inches: v.measurement?.inches || null,
      verification: v.status as
        "unreviewed" | "confirmed" | "corrected" | "rejected" | "irrelevant",
      bbox: v.element.bbox,
      page: v.element.page,
      sourceDocumentId: result.documentId,
    }));
  return evaluateCompliance(regulatoryContext, facts);
}
