import { readJson } from "@/lib/request";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticated } from "@/lib/server";
export async function POST(request: Request) {
  try {
    const { db } = await authenticated();
    const v = z
      .object({
        organizationId: z.uuid(),
        name: z.string().trim().min(1).max(120),
      })
      .parse(await readJson(request));
    const { error, data } = await db
      .from("organizations")
      .update({ name: v.name })
      .eq("id", v.organizationId)
      .select("id")
      .single();
    if (error || !data) throw new Error("Organization owner access required");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Unable to update organization. Owner access is required." },
      { status: 403 },
    );
  }
}
