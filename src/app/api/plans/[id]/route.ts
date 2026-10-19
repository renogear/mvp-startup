import { NextResponse } from "next/server";
import { planOwner, planError } from "@/lib/plan/access";
import {
  getReview,
  jobsFor,
  correctionsFor,
  eventsFor,
  updateContext,
  deleteReview,
} from "@/lib/plan/local-store";
import { contextSchema } from "@/lib/plan/schema";
import { readJson } from "@/lib/request";
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Params) {
  try {
    const owner = await planOwner(request),
      { id } = await params;
    const review = getReview(id, owner);
    if (!review)
      return NextResponse.json(
        { error: "Review unavailable" },
        { status: 404 },
      );
    return NextResponse.json(
      {
        review,
        jobs: jobsFor(id),
        corrections: correctionsFor(id),
        events: eventsFor(id),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(planError(e), { status: 401 });
  }
}
export async function PATCH(request: Request, { params }: Params) {
  try {
    const owner = await planOwner(request),
      { id } = await params;
    const context = contextSchema.parse(await readJson(request));
    return NextResponse.json({ review: updateContext(id, owner, context) });
  } catch (e) {
    return NextResponse.json(planError(e), { status: 400 });
  }
}
export async function DELETE(request: Request, { params }: Params) {
  try {
    await readJson(request);
    const owner = await planOwner(request),
      { id } = await params;
    deleteReview(id, owner);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(planError(e), { status: 400 });
  }
}
