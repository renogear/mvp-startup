import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { planOwner, planError } from "@/lib/plan/access";
import {
  getReview,
  jobsFor,
  correctionsFor,
  audit,
} from "@/lib/plan/local-store";
import { planReport } from "@/lib/plan/report";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const owner = await planOwner(request),
      { id } = await params;
    const review = getReview(id, owner);
    if (!review)
      return NextResponse.json(
        { error: "Review unavailable" },
        { status: 404 },
      );
    const jobid = new URL(request.url).searchParams.get("job"),
      job = jobsFor(id).find((j) => j.id === jobid);
    if (!job?.result)
      return NextResponse.json(
        { error: "Complete a page extraction before exporting its report." },
        { status: 409 },
      );
    const reviewed = correctionsFor(id, job.id);
    const pdf = await planReport(review, job, reviewed);
    audit(id, "report_exported", {
      jobId: job.id,
      compliance: "not_evaluated",
      activeRules: 0,
      context: review.context,
      correctionIds: reviewed.map((c) => c.id),
      sourceSha256: review.sha256,
      pipelineVersion: job.result.schemaVersion,
      reportSha256: createHash("sha256").update(pdf).digest("hex"),
    });
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition":
          'attachment; filename="PermitPilot-plan-review.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(planError(e), { status: 400 });
  }
}
