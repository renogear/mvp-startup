import { NextResponse } from "next/server";
import { z } from "zod";
import { planOwner, planError } from "@/lib/plan/access";
import { getReview, saveCorrection } from "@/lib/plan/local-store";
import { correctionSchema } from "@/lib/plan/schema";
import { readJson } from "@/lib/request";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const owner = await planOwner(request),
      { id } = await params;
    if (!getReview(id, owner))
      return NextResponse.json(
        { error: "Review unavailable" },
        { status: 404 },
      );
    const body = z
      .object({ jobId: z.uuid(), correction: correctionSchema })
      .parse(await readJson(request));
    return NextResponse.json({
      correction: saveCorrection(id, body.jobId, body.correction),
    });
  } catch (e) {
    return NextResponse.json(planError(e), { status: 400 });
  }
}
