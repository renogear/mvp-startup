import { readJson } from "@/lib/request";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticated } from "@/lib/server";
import { validateFile } from "@/lib/domain";
export async function POST(request: Request) {
  try {
    const { db } = await authenticated();
    const v = z
      .object({
        id: z.uuid(),
        projectId: z.uuid(),
        organizationId: z.uuid(),
        name: z.string().min(1).max(255),
        type: z.enum(["application/pdf", "image/jpeg", "image/png"]),
        size: z.number().positive().max(20971520),
      })
      .parse(await readJson(request));
    const path = `${v.organizationId}/${v.projectId}/${v.id}`;
    const { data: file, error } = await db.storage
      .from("project-documents")
      .download(path);
    if (error || !file) throw new Error("Private file unavailable");
    validateFile({ size: file.size, type: v.type });
    if (file.size !== v.size) throw new Error("Size mismatch");
    const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const valid =
      v.type === "application/pdf"
        ? String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-"
        : v.type === "image/png"
          ? bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10"
          : bytes.slice(0, 3).join(",") === "255,216,255";
    if (!valid) {
      await db.storage.from("project-documents").remove([path]);
      throw new Error("File signature does not match its type");
    }
    const { error: saveError } = await db.from("documents").insert({
      id: v.id,
      project_id: v.projectId,
      organization_id: v.organizationId,
      path,
      name: v.name,
      mime_type: v.type,
      size: v.size,
    });
    if (saveError) throw saveError;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          (e as Error).message === "Authentication required"
            ? "Authentication required"
            : "Document could not be validated or registered.",
      },
      { status: 400 },
    );
  }
}
