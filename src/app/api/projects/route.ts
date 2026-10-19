import { readJson } from "@/lib/request";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticated } from "@/lib/server";
import { projectRecordSchema } from "@/lib/domain";
export async function POST(request: Request) {
  try {
    const { db } = await authenticated();
    const body = z
      .object({ project: projectRecordSchema, organizationId: z.uuid() })
      .parse(await readJson(request));
    const { data, error } = await db.rpc("save_project", {
      project_data: body.project,
      oid: body.organizationId,
    });
    if (error) throw error;
    return NextResponse.json({ id: data });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          (e as Error).message === "Authentication required"
            ? "Authentication required"
            : "Project could not be saved. Check your input and organization access.",
      },
      { status: 400 },
    );
  }
}
export async function DELETE(request: Request) {
  try {
    const { db } = await authenticated();
    const { id } = z.object({ id: z.uuid() }).parse(await readJson(request));
    const { data: docs, error: read } = await db
      .from("documents")
      .select("path")
      .eq("project_id", id);
    if (read) throw read;
    if (docs?.length) {
      const { error } = await db.storage
        .from("project-documents")
        .remove(docs.map((d) => d.path));
      if (error) throw error;
    }
    const { error } = await db.from("projects").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Unable to delete project" },
      { status: 400 },
    );
  }
}
