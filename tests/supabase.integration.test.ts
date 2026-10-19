import { test, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
const url = process.env.TEST_SUPABASE_URL,
  key = process.env.TEST_SUPABASE_ANON_KEY;
// Run only against a dedicated disposable Supabase project with email confirmation disabled.
test.skipIf(!url || !key)(
  "live signup, organization provisioning, logout/login persistence and tenant isolation",
  async () => {
    const make = () =>
      createClient(url!, key!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    const a = make(),
      b = make();
    const password = crypto.randomUUID() + "!Aa7";
    const email = `permitpilot-${crypto.randomUUID()}@example.com`;
    const signup = await a.auth.signUp({ email, password });
    expect(signup.error).toBeNull();
    expect(signup.data.session).toBeTruthy();
    const org = await a.rpc("create_organization", {
      org_name: "Integration A",
    });
    expect(org.error).toBeNull();
    const id = crypto.randomUUID();
    const project = {
      id,
      name: "DEMO integration project",
      address: "123 Example Street",
      city: "San Jose",
      state: "CA",
      zip: "95112",
      propertyType: "Single-family",
      categories: ["HVAC / mechanical"],
      description: "Replace an existing furnace",
      details: "",
      jurisdiction: "san-jose",
      confirmed: false,
      documents: [],
      checklist: [],
      created_at: new Date().toISOString(),
    };
    const saved = await a.rpc("save_project", {
      project_data: project,
      oid: org.data,
    });
    expect(saved.error).toBeNull();
    await a.auth.signOut();
    const session = make();
    expect(
      (await session.auth.signInWithPassword({ email, password })).error,
    ).toBeNull();
    const restored = await session
      .from("projects")
      .select("*")
      .eq("id", id)
      .single();
    expect(restored.data?.data.address).toBe(project.address);
    const other = await b.auth.signUp({
      email: `permitpilot-${crypto.randomUUID()}@example.com`,
      password,
    });
    expect(other.data.session).toBeTruthy();
    expect((await b.from("projects").select("id").eq("id", id)).data).toEqual(
      [],
    );
    const forbidden = await b.from("projects").insert({
      organization_id: org.data,
      name: "Cross tenant attack",
      data: project,
    });
    expect(forbidden.error).toBeTruthy();
    await session.from("projects").delete().eq("id", id);
    await session.auth.signOut();
    await b.auth.signOut();
  },
  30000,
);
