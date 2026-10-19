import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  claimJob,
  correctionsFor,
  createSession,
  database,
  deleteReview,
  enqueue,
  eventsFor,
  failJob,
  filePath,
  finishJob,
  getReview,
  jobsFor,
  listReviews,
  originalBytes,
  saveCorrection,
  saveReview,
  sessionOwner,
  updateContext,
} from "../src/lib/plan/local-store";
import {
  defaultContext,
  effectiveElements,
  resultSchema,
  type PlanJob,
  type Review,
} from "../src/lib/plan/schema";

// These are synthetic persistence fixtures, never baseline drawing observations.
const originalEnvironment = process.env.PERMITPILOT_DATA_DIR;
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "permitpilot-store-test-"),
);
process.env.PERMITPILOT_DATA_DIR = temporaryDirectory;
let owner: ReturnType<typeof createSession>;
let anotherOwner: ReturnType<typeof createSession>;
const fixtureBytes = Buffer.from(
  "Synthetic document bytes for storage tests only",
);
function fixtureReview(name = "Synthetic persistence fixture") {
  return saveReview(
    owner.ownerId,
    `${name}.pdf`,
    "application/pdf",
    fixtureBytes,
    {
      ...defaultContext,
      projectName: name,
    },
  );
}
function fixtureResult(review: Review, job: PlanJob) {
  return resultSchema.parse({
    schemaVersion: "synthetic-test-v1",
    documentId: review.id,
    sourceSha256: review.sha256,
    pageCount: job.page,
    page: {
      number: job.page,
      width: 100,
      height: 100,
      rotation: 0,
      kind: "vector",
    },
    elements: [
      {
        id: "synthetic-dimension",
        kind: "dimension",
        label: "Synthetic annotation",
        bbox: { x: 0.1, y: 0.2, width: 0.1, height: 0.02 },
        page: job.page,
        method: "embedded_text",
        confidence: "high",
        originalValue: { value: 7, unit: "ft", inches: 84 },
        evidence: "Synthetic text used only to test persistence",
        verification: "unreviewed",
      },
    ],
    warnings: ["Synthetic fixture; no code evaluation"],
    metrics: { processingMs: 12, textSpanCount: 1 },
  });
}
function start(review: Review) {
  const queued = enqueue(review.id, 1);
  const claimed = claimJob();
  expect(claimed?.id).toBe(queued.id);
  return claimed!;
}

beforeAll(() => {
  owner = createSession();
  anotherOwner = createSession();
});
afterAll(() => {
  database().close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
  if (originalEnvironment === undefined)
    delete process.env.PERMITPILOT_DATA_DIR;
  else process.env.PERMITPILOT_DATA_DIR = originalEnvironment;
});

describe("local workstation plan persistence", () => {
  it("hashes session tokens and isolates browser owners", () => {
    expect(owner.ownerId).not.toBe(anotherOwner.ownerId);
    expect(sessionOwner(owner.token)).toBe(owner.ownerId);
    expect(sessionOwner(anotherOwner.token)).toBe(anotherOwner.ownerId);
    expect(sessionOwner("invalid-token")).toBeNull();
    const rows = database().prepare("SELECT token_hash FROM sessions").all();
    expect(rows.map((row) => row.token_hash)).toContain(
      createHash("sha256").update(owner.token).digest("hex"),
    );
    expect(rows.map((row) => row.token_hash)).not.toContain(owner.token);
    database()
      .prepare("UPDATE sessions SET expires_at=? WHERE owner_id=?")
      .run(Date.now() - 1, anotherOwner.ownerId);
    expect(sessionOwner(anotherOwner.token)).toBeNull();
  });

  it("persists original bytes and review context and rejects another owner", () => {
    const review = fixtureReview();
    expect(getReview(review.id, owner.ownerId)).toEqual(review);
    expect(listReviews(owner.ownerId).map((r) => r.id)).toContain(review.id);
    expect(listReviews(anotherOwner.ownerId)).toEqual([]);
    expect(getReview(review.id, anotherOwner.ownerId)).toBeNull();
    expect(originalBytes(review.id, owner.ownerId)).toEqual(fixtureBytes);
    expect(review.sha256).toBe(
      createHash("sha256").update(fixtureBytes).digest("hex"),
    );
    expect(() => originalBytes(review.id, anotherOwner.ownerId)).toThrow(
      "unavailable",
    );
    expect(() =>
      updateContext(review.id, anotherOwner.ownerId, defaultContext),
    ).toThrow("unavailable");
    expect(() => deleteReview(review.id, anotherOwner.ownerId)).toThrow(
      "unavailable",
    );
    const updated = updateContext(review.id, owner.ownerId, {
      ...review.context,
      projectName: "Synthetic corrected project title",
    });
    expect(getReview(review.id, owner.ownerId)?.context).toEqual(
      updated.context,
    );
    // An independent connection verifies the record is on disk, not in a JS map.
    const persisted = new DatabaseSync(
      join(temporaryDirectory, "reviews.sqlite"),
      { readOnly: true },
    );
    try {
      const row = persisted
        .prepare("SELECT data FROM reviews WHERE id=?")
        .get(review.id);
      expect(JSON.parse(row!.data as string).context.projectName).toBe(
        updated.context.projectName,
      );
    } finally {
      persisted.close();
    }
  });

  it("durably queues one job per page and claims each pending job once", () => {
    const review = fixtureReview("Synthetic queued review");
    const queued = enqueue(review.id, 1);
    expect(queued.state).toBe("queued");
    expect(enqueue(review.id, 1).id).toBe(queued.id);
    const claimed = claimJob()!;
    expect(claimed.id).toBe(queued.id);
    expect(claimed.state).toBe("processing");
    expect(claimed.attempts).toBe(1);
    expect(claimJob()).toBeNull();
    const result = fixtureResult(review, claimed);
    finishJob(claimed, result);
    expect(jobsFor(review.id)[0].result).toEqual(result);
    expect(getReview(review.id, owner.ownerId)?.pageCount).toBe(1);
    expect(enqueue(review.id, 1).state).toBe("complete");
    expect(eventsFor(review.id).map((event) => event.kind)).toEqual([
      "analysis_complete",
      "analysis_queued",
      "uploaded",
    ]);
  });

  it("requires an existing element in the selected completed job for corrections", () => {
    const review = fixtureReview("Synthetic invalid correction");
    const job = start(review);
    const correction = {
      elementId: "synthetic-dimension",
      label: "Synthetic review",
      kind: "dimension" as const,
      status: "confirmed" as const,
      value: 7,
      unit: "ft" as const,
      note: "Test only",
    };
    expect(() => saveCorrection(review.id, job.id, correction)).toThrow(
      "unavailable",
    );
    finishJob(job, fixtureResult(review, job));
    expect(() =>
      saveCorrection(review.id, job.id, {
        ...correction,
        elementId: "not-extracted",
      }),
    ).toThrow("unavailable");
    const otherReview = fixtureReview("Synthetic wrong correction owner");
    expect(() => saveCorrection(otherReview.id, job.id, correction)).toThrow(
      "unavailable",
    );
    expect(correctionsFor(review.id, job.id)).toEqual([]);
  });

  it("binds completed results to the original source, document and requested page", () => {
    const review = fixtureReview("Synthetic source identity");
    const job = start(review),
      result = fixtureResult(review, job);
    const wrongResults = [
      { ...result, sourceSha256: "b".repeat(64) },
      { ...result, documentId: "different-synthetic-document" },
      { ...result, page: { ...result.page, number: 2 } },
      {
        ...result,
        elements: result.elements.map((element) => ({ ...element, page: 2 })),
      },
    ];
    const historyBefore = eventsFor(review.id);
    for (const wrong of wrongResults) {
      expect(() => finishJob(job, wrong)).toThrow("identity mismatch");
      expect(jobsFor(review.id)[0].state).toBe("processing");
      expect(jobsFor(review.id)[0].result).toBeNull();
      expect(eventsFor(review.id)).toEqual(historyBefore);
    }
    finishJob(job, result);
    expect(jobsFor(review.id)[0].result).toEqual(result);
    expect(jobsFor(review.id)[0].state).toBe("complete");
  });

  it("retains original extraction and append-only confirmation/correction history", () => {
    const review = fixtureReview("Synthetic review history");
    const job = start(review),
      result = fixtureResult(review, job);
    finishJob(job, result);
    const common = {
      elementId: result.elements[0].id,
      label: "Synthetic reviewed dimension",
      kind: "dimension" as const,
      value: 7,
      unit: "ft" as const,
      note: "Synthetic human review",
    };
    const confirmed = saveCorrection(review.id, job.id, {
      ...common,
      status: "confirmed",
    });
    const corrected = saveCorrection(review.id, job.id, {
      ...common,
      status: "corrected",
      value: 8,
      unit: "ft",
    });
    expect(confirmed.id).not.toBe(corrected.id);
    expect(correctionsFor(review.id, job.id)).toEqual([confirmed, corrected]);
    const effective = effectiveElements(
      result,
      correctionsFor(review.id, job.id),
    );
    expect(effective[0].status).toBe("corrected");
    expect(effective[0].measurement?.inches).toBe(96);
    expect(
      jobsFor(review.id)[0].result?.elements[0].originalValue?.inches,
    ).toBe(84);
    expect(
      eventsFor(review.id).filter((event) => event.kind === "element_reviewed"),
    ).toHaveLength(2);
  });

  it("persists failures and retries with incremented attempt count", () => {
    const review = fixtureReview("Synthetic retry");
    const first = start(review);
    failJob(first, "Synthetic transient failure");
    expect(jobsFor(review.id)[0].state).toBe("failed");
    expect(jobsFor(review.id)[0].error).toBe("Synthetic transient failure");
    expect(enqueue(review.id, first.page).id).toBe(first.id);
    const retried = claimJob()!;
    expect(retried.attempts).toBe(2);
    finishJob(retried, fixtureResult(review, retried));
    expect(eventsFor(review.id).map((event) => event.kind)).toContain(
      "retry_requested",
    );
  });

  it("rejects stale completions and does not audit a stale failure as a new failure", () => {
    const review = fixtureReview("Synthetic stale worker");
    const first = start(review);
    database()
      .prepare("UPDATE jobs SET started_at=? WHERE id=?")
      .run("2000-01-01T00:00:00.000Z", first.id);
    const replacement = claimJob()!;
    expect(replacement.id).toBe(first.id);
    expect(replacement.attempts).toBe(first.attempts + 1);
    const result = fixtureResult(review, replacement);
    expect(() => finishJob(first, result)).toThrow("superseded");
    finishJob(replacement, result);
    const historyBefore = eventsFor(review.id);
    try {
      failJob(first, "Stale failure must not overwrite successful replacement");
    } catch {
      /* Explicit rejection is valid. */
    }
    expect(jobsFor(review.id)[0].state).toBe("complete");
    expect(eventsFor(review.id)).toEqual(historyBefore);
  });

  it("bounds automatic and manual retries to three attempts", () => {
    const review = fixtureReview("Synthetic exhausted retries");
    let job = start(review);
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect(job.attempts).toBe(attempt);
      failJob(job, "Synthetic repeated failure");
      if (attempt < 3) {
        enqueue(review.id, job.page);
        job = claimJob()!;
      }
    }
    try {
      enqueue(review.id, job.page);
    } catch {
      /* An exhausted retry may be explicitly rejected. */
    }
    expect(claimJob()).toBeNull();
    expect(jobsFor(review.id)[0].attempts).toBe(3);
    expect(jobsFor(review.id)[0].state).toBe("failed");
  });

  it("deletes owned originals and cascades document-derived state", () => {
    const review = fixtureReview("Synthetic deletion");
    const originalPath = filePath(review.id),
      job = start(review);
    finishJob(job, fixtureResult(review, job));
    deleteReview(review.id, owner.ownerId);
    expect(getReview(review.id, owner.ownerId)).toBeNull();
    expect(jobsFor(review.id)).toEqual([]);
    expect(eventsFor(review.id)).toEqual([]);
    expect(() => readFileSync(originalPath)).toThrow();
  });
});
