import { NextResponse } from "next/server";
import { z } from "zod";
import { planOwner, planError } from "@/lib/plan/access";
import { getReview, enqueue, jobsFor } from "@/lib/plan/local-store";
import { readJson } from "@/lib/request";
export async function POST(
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
    const { page } = z
      .object({ page: z.number().int().min(1).max(100) })
      .parse(await readJson(request));
    if (review.pageCount && page > review.pageCount)
      return NextResponse.json(
        { error: "Page outside document" },
        { status: 400 },
      );
    const jobs = jobsFor(id);
    if (
      jobs.filter((j) => j.state === "processing" || j.state === "queued")
        .length >= 3
    )
      return NextResponse.json(
        { error: "Wait for queued pages before adding another." },
        { status: 429 },
      );
    return NextResponse.json({ job: enqueue(id, page) }, { status: 202 });
  } catch (e) {
    return NextResponse.json(planError(e), { status: 400 });
  }
}
