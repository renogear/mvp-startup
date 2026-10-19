import { planOwner, planError } from "@/lib/plan/access";
import { getReview, originalBytes } from "@/lib/plan/local-store";
import { NextResponse } from "next/server";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const owner = await planOwner(request),
      { id } = await params,
      review = getReview(id, owner);
    if (!review)
      return NextResponse.json(
        { error: "Review unavailable" },
        { status: 404 },
      );
    const bytes = originalBytes(id, owner);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": review.mime,
        "Content-Length": String(bytes.length),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="plan-${id}.${review.mime === "application/pdf" ? "pdf" : "image"}"`,
      },
    });
  } catch (e) {
    return NextResponse.json(planError(e), { status: 401 });
  }
}
