import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { planOwner, planError } from "@/lib/plan/access";
import { listReviews, saveReview } from "@/lib/plan/local-store";
import { contextSchema } from "@/lib/plan/schema";
import { validateFile } from "@/lib/domain";
import { assertSameOrigin } from "@/lib/request";
export async function GET(request: Request) {
  try {
    const owner = await planOwner(request);
    return NextResponse.json(
      { reviews: listReviews(owner) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(planError(e), { status: 401 });
  }
}
export async function POST(request: Request) {
  try {
    const owner = await planOwner(request);
    assertSameOrigin(request);
    if (!request.body) throw new Error("Missing file");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > 21 * 1024 * 1024) {
        await reader.cancel();
        return NextResponse.json(
          { error: "File exceeds the 20 MB limit" },
          { status: 413 },
        );
      }
      chunks.push(r.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    const parsed = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: bytes,
    });
    const form = await parsed.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Missing file");
    validateFile(file);
    const context = contextSchema.parse(
      JSON.parse(String(form.get("context") || "{}")),
    );
    const raw = new Uint8Array(await file.arrayBuffer());
    const valid =
      file.type === "application/pdf"
        ? Buffer.from(raw.slice(0, 5)).toString() === "%PDF-"
        : file.type === "image/png"
          ? raw.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10"
          : raw.slice(0, 3).join(",") === "255,216,255";
    if (!valid)
      return NextResponse.json(
        { error: "File contents do not match the selected type." },
        { status: 400 },
      );
    if (file.type === "application/pdf") {
      const pdf = await PDFDocument.load(raw);
      if (pdf.getPageCount() > 100)
        return NextResponse.json(
          { error: "Select a PDF with no more than 100 pages." },
          { status: 400 },
        );
    }
    const review = saveReview(
      owner,
      file.name.slice(0, 255),
      file.type,
      raw,
      context,
    );
    return NextResponse.json({ review }, { status: 201 });
  } catch (e) {
    return NextResponse.json(planError(e), { status: 400 });
  }
}
