import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const response = NextResponse.redirect(new URL("/projects", url.origin));
  if (
    code &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    const db = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll: () =>
            request.headers
              .get("cookie")
              ?.split(";")
              .map((s) => {
                const [name, ...value] = s.trim().split("=");
                return { name, value: value.join("=") };
              }) || [],
          setAll: (items) =>
            items.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            ),
        },
      },
    );
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (error)
      return NextResponse.redirect(
        new URL("/?auth_error=confirmation", url.origin),
      );
  }
  return response;
}
