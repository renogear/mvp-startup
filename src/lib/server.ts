import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
export async function authenticated() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Database not configured");
  const jar = await cookies();
  const db = createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (items) => {
        items.forEach(({ name, value, options }) =>
          jar.set(name, value, options),
        );
      },
    },
  });
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new Error("Authentication required");
  return { db, user };
}
