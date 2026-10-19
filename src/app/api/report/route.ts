import { readJson } from "@/lib/request";
import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import { loadRules } from "@/lib/rules";
import { authenticated } from "@/lib/server";
import {
  findings,
  projectRecordSchema,
  type Project,
  jurisdictions,
} from "@/lib/domain";
export async function POST(request: Request) {
  try {
    const body = z
      .object({
        demo: z.boolean().optional(),
        project: z.unknown().optional(),
        projectId: z.string().optional(),
      })
      .parse(await readJson(request));
    let p: Project;
    let context: Awaited<ReturnType<typeof authenticated>> | null = null;
    if (body.demo === true) {
      if (process.env.NEXT_PUBLIC_SUPABASE_URL)
        return NextResponse.json(
          { error: "Demo report unavailable in connected mode" },
          { status: 403 },
        );
      const v = projectRecordSchema.parse(body.project);
      p = v as Project;
    } else {
      context = await authenticated();
      const { projectId } = z.object({ projectId: z.uuid() }).parse(body);
      const { data, error } = await context.db
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();
      if (error || !data)
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 },
        );
      p = projectRecordSchema.parse({
        ...data.data,
        id: data.id,
        organization_id: data.organization_id,
        created_at: data.created_at,
      });
    }
    const rules = context ? await loadRules(context.db) : [];
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica),
      bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page = pdf.addPage([595, 842]),
      y = 788;
    const clean = (s: string) => s.replace(/[^\x20-\x7E\n]/g, " ");
    function text(s: string, size = 10, heavy = false) {
      const words = clean(s).split(/\s+/);
      let line = "";
      for (const w of words) {
        if (font.widthOfTextAtSize(line + " " + w, size) > 480) {
          draw(line);
          line = w;
        } else line += (line ? " " : "") + w;
      }
      if (line) draw(line);
      function draw(v: string) {
        if (y < 65) {
          page = pdf.addPage([595, 842]);
          y = 788;
        }
        page.drawText(v, {
          x: 52,
          y,
          size,
          font: heavy ? bold : font,
          color: rgb(0.17, 0.24, 0.2),
        });
        y -= size + 7;
      }
      y -= 5;
    }
    text("PermitPilot | Submission-readiness report", 20, true);
    text(
      body.demo
        ? "LOCAL DEMO - not a verified permit assessment"
        : "Administrative preparation assessment",
      10,
    );
    text(p.name, 16, true);
    text(`${p.address}, ${p.city}, ${p.state} ${p.zip}`);
    text(
      `Generated ${new Date().toISOString().slice(0, 10)} | ${p.categories.join(", ")}`,
    );
    text(
      `Coverage: ${rules.length} verified rule versions in the database. Applicability and coverage remain limited; see findings below.`,
    );
    for (const f of findings(p, rules)) {
      y -= 12;
      text(`${f.status.toUpperCase()} | ${f.title}`, 11, true);
      text(f.reason);
      text("Next action: " + f.action);
      if ("sourceUrl" in f && typeof f.sourceUrl === "string")
        text("Official source: " + f.sourceUrl);
    }
    const j = jurisdictions.find((j) => j.id === p.jurisdiction);
    if (j) {
      text("Official department reference", 11, true);
      text(j.url);
      text("Directory reference only; requirements not verified.");
    }
    y -= 15;
    text(
      "Document completeness and administrative preparation are separate from technical code compliance and government approval. This report does not certify compliance or guarantee permit approval.",
      10,
      true,
    );
    if (context) {
      const { error } = await context.db.from("readiness_reports").insert({
        project_id: p.id,
        organization_id: p.organization_id,
        snapshot: { findings: findings(p, rules), version: 1 },
      });
      if (error) throw error;
    }
    return new Response(new Uint8Array(await pdf.save()), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition":
          'attachment; filename="PermitPilot-readiness.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          (e as Error).message === "Authentication required"
            ? "Authentication required"
            : "Unable to generate report. Check project access and input.",
      },
      { status: 400 },
    );
  }
}
