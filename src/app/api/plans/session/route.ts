import { NextResponse } from "next/server";
import { workbenchAccess } from "@/lib/plan/environment";
import { createSession, sessionOwner } from "@/lib/plan/local-store";
import { cookies } from "next/headers";
import { readJson } from "@/lib/request";
export async function GET(request: Request) {
  const jar = await cookies();
  const access = workbenchAccess(request);
  return NextResponse.json(
    {
      mode: access.mode,
      enabled: access.enabled,
      authenticated: Boolean(
        access.enabled &&
        sessionOwner(jar.get("pp_plan_workstation")?.value || ""),
      ),
      cloudConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      aiConfigured: Boolean(
        process.env.PERMITPILOT_OPENAI_KEY || process.env.OPENAI_API_KEY,
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  try {
    const access = workbenchAccess(request);
    if (!access.enabled)
      return NextResponse.json(
        {
          error:
            "Private workbench access is not enabled for this origin. Check workspace startup and port privacy.",
        },
        { status: 403 },
      );
    await readJson(request);
    const session = createSession();
    const response = NextResponse.json({ ok: true });
    response.cookies.set("pp_plan_workstation", session.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: access.secure,
      path: "/",
      maxAge: 7 * 86400,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json(
      { error: "Session could not be opened" },
      { status: 400 },
    );
  }
}
