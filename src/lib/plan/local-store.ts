import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  Review,
  ReviewContext,
  PlanJob,
  PlanResult,
  Correction,
} from "./schema";
let connection: DatabaseSync | undefined;
export function dataRoot() {
  return resolve(/* turbopackIgnore: true */ process.env.PERMITPILOT_DATA_DIR || ".permitpilot");
}
export function database() {
  if (!connection) {
    mkdirSync(dataRoot(), { recursive: true, mode: 0o700 });
    connection = new DatabaseSync(join(dataRoot(), "reviews.sqlite"));
    chmodSync(join(dataRoot(), "reviews.sqlite"), 0o600);
    connection.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,owner_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,data TEXT NOT NULL,path TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,page INTEGER NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,started_at TEXT,finished_at TEXT,error TEXT,result TEXT, UNIQUE(review_id,page));
CREATE TABLE IF NOT EXISTS corrections(id TEXT PRIMARY KEY,review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,element_id TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,kind TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);`);
  }
  return connection;
}
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
export function createSession() {
  const token = randomBytes(32).toString("hex"),
    ownerId = randomUUID();
  database()
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run(digest(token), ownerId, Date.now() + 7 * 86400000);
  return { token, ownerId };
}
export function sessionOwner(token: string) {
  const row = database()
    .prepare(
      "SELECT owner_id FROM sessions WHERE token_hash=? AND expires_at>?",
    )
    .get(digest(token), Date.now()) as { owner_id: string } | undefined;
  return row?.owner_id || null;
}
export function listReviews(ownerId: string): Review[] {
  return (
    database()
      .prepare("SELECT data FROM reviews WHERE owner_id=? ORDER BY rowid DESC")
      .all(ownerId) as { data: string }[]
  ).map((r) => JSON.parse(r.data));
}
export function getReview(id: string, ownerId: string): Review | null {
  const r = database()
    .prepare("SELECT data FROM reviews WHERE id=? AND owner_id=?")
    .get(id, ownerId) as { data: string } | undefined;
  return r ? JSON.parse(r.data) : null;
}
export function originalBytes(id: string, ownerId: string) {
  const r = database()
    .prepare("SELECT path FROM reviews WHERE id=? AND owner_id=?")
    .get(id, ownerId) as { path: string } | undefined;
  if (!r) throw new Error("Review unavailable");
  return readFileSync(r.path);
}
export function filePath(id: string) {
  const r = database()
    .prepare("SELECT path FROM reviews WHERE id=?")
    .get(id) as { path: string } | undefined;
  if (!r) throw new Error("Review unavailable");
  return r.path;
}
export function saveReview(
  ownerId: string,
  name: string,
  mime: string,
  bytes: Uint8Array,
  context: ReviewContext,
) {
  const id = randomUUID(),
    path = join(dataRoot(), `${id}.original`);
  writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
  const review: Review = {
    id,
    ownerId,
    organizationId: null,
    projectId: null,
    documentId: null,
    name,
    mime,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    context,
    pageCount: null,
    createdAt: new Date().toISOString(),
  };
  try {
    database()
      .prepare("INSERT INTO reviews VALUES(?,?,?,?)")
      .run(id, ownerId, JSON.stringify(review), path);
  } catch (e) {
    unlinkSync(path);
    throw e;
  }
  audit(id, "uploaded", { sha256: review.sha256, mime, size: review.size });
  return review;
}
export function updateContext(
  id: string,
  ownerId: string,
  context: ReviewContext,
) {
  const r = getReview(id, ownerId);
  if (!r) throw new Error("Review unavailable");
  r.context = context;
  database()
    .prepare("UPDATE reviews SET data=? WHERE id=?")
    .run(JSON.stringify(r), id);
  audit(id, "context_updated", context);
  return r;
}
export function deleteReview(id: string, ownerId: string) {
  if (!getReview(id, ownerId)) throw new Error("Review unavailable");
  const path = filePath(id);
  database()
    .prepare("DELETE FROM reviews WHERE id=? AND owner_id=?")
    .run(id, ownerId);
  try {
    unlinkSync(path);
  } catch {
    /* DB deletion prevents access; cleanup can remove orphan. */
  }
}
function mapJob(r: Record<string, unknown>): PlanJob {
  return {
    id: r.id as string,
    reviewId: r.review_id as string,
    page: r.page as number,
    state: r.state as PlanJob["state"],
    attempts: r.attempts as number,
    createdAt: r.created_at as string,
    startedAt: r.started_at as string | null,
    finishedAt: r.finished_at as string | null,
    error: r.error as string | null,
    result: r.result ? JSON.parse(r.result as string) : null,
  };
}
export function jobsFor(id: string): PlanJob[] {
  return database()
    .prepare("SELECT * FROM jobs WHERE review_id=? ORDER BY page")
    .all(id)
    .map((r) => mapJob(r));
}
export function enqueue(id: string, page: number) {
  const db = database(),
    old = db
      .prepare("SELECT * FROM jobs WHERE review_id=? AND page=?")
      .get(id, page);
  if (old) {
    const job = mapJob(old);
    if (job.state === "failed") {
      if (job.attempts >= 3)
        throw new Error(
          "Retry budget exhausted; inspect the document and processor before creating another review.",
        );
      db.prepare(
        "UPDATE jobs SET state='queued',error=NULL,finished_at=NULL WHERE id=?",
      ).run(job.id);
      audit(id, "retry_requested", { jobId: job.id });
      return jobsFor(id).find((j) => j.id === job.id)!;
    }
    return job;
  }
  const jobid = randomUUID();
  db.prepare(
    "INSERT INTO jobs(id,review_id,page,state,created_at) VALUES(?,?,?,'queued',?)",
  ).run(jobid, id, page, new Date().toISOString());
  audit(id, "analysis_queued", { jobId: jobid, page });
  return jobsFor(id).find((j) => j.id === jobid)!;
}
export function claimJob(): PlanJob | null {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const stale = new Date(Date.now() - 180000).toISOString();
    db.prepare(
      "UPDATE jobs SET state=CASE WHEN attempts<3 THEN 'queued' ELSE 'failed' END,error='Worker lease expired; retry available' WHERE state='processing' AND started_at<?",
    ).run(stale);
    const row = db
      .prepare(
        "SELECT * FROM jobs WHERE state='queued' AND attempts<3 ORDER BY created_at LIMIT 1",
      )
      .get();
    if (!row) {
      db.exec("COMMIT");
      return null;
    }
    db.prepare(
      "UPDATE jobs SET state='processing',attempts=attempts+1,started_at=?,error=NULL WHERE id=?",
    ).run(new Date().toISOString(), row.id as string);
    db.exec("COMMIT");
    return jobsFor(row.review_id as string).find((j) => j.id === row.id)!;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function finishJob(job: PlanJob, result: PlanResult) {
  const db = database();
  const identity = db
    .prepare("SELECT data FROM reviews WHERE id=?")
    .get(job.reviewId) as { data: string } | undefined;
  if (!identity) throw new Error("Review unavailable");
  const source: Review = JSON.parse(identity.data);
  if (
    result.documentId !== job.reviewId ||
    result.page.number !== job.page ||
    result.sourceSha256 !== source.sha256 ||
    result.elements.some((e) => e.page !== job.page)
  )
    throw new Error("Source identity mismatch");
  const written = db
    .prepare(
      "UPDATE jobs SET state='complete',result=?,finished_at=?,error=NULL WHERE id=? AND state='processing' AND attempts=?",
    )
    .run(
      JSON.stringify(result),
      new Date().toISOString(),
      job.id,
      job.attempts,
    );
  if (!written.changes) throw new Error("Job lease superseded");
  const row = db
    .prepare("SELECT data FROM reviews WHERE id=?")
    .get(job.reviewId) as { data: string } | undefined;
  if (row) {
    const review: Review = JSON.parse(row.data);
    review.pageCount = result.pageCount;
    db.prepare("UPDATE reviews SET data=? WHERE id=?").run(
      JSON.stringify(review),
      review.id,
    );
  }
  audit(job.reviewId, "analysis_complete", {
    jobId: job.id,
    processingMs: result.metrics.processingMs,
    elementCount: result.elements.length,
  });
}
export function failJob(job: PlanJob, error: string) {
  const written = database()
    .prepare(
      "UPDATE jobs SET state='failed',error=?,finished_at=? WHERE id=? AND state='processing' AND attempts=?",
    )
    .run(error.slice(0, 1000), new Date().toISOString(), job.id, job.attempts);
  if (!written.changes) throw new Error("Job lease superseded");
  audit(job.reviewId, "analysis_failed", {
    jobId: job.id,
    error: error.slice(0, 1000),
  });
}
export function saveCorrection(
  reviewId: string,
  jobId: string,
  correction: Omit<Correction, "id" | "createdAt">,
) {
  const job = jobsFor(reviewId).find((j) => j.id === jobId);
  if (!job?.result?.elements.some((e) => e.id === correction.elementId))
    throw new Error("Element unavailable");
  const c: Correction = {
    ...correction,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  database()
    .prepare("INSERT INTO corrections VALUES(?,?,?,?,?,?)")
    .run(c.id, reviewId, jobId, c.elementId, JSON.stringify(c), c.createdAt);
  audit(reviewId, "element_reviewed", {
    jobId,
    elementId: c.elementId,
    status: c.status,
  });
  return c;
}
export function correctionsFor(reviewId: string, jobId?: string): Correction[] {
  const rows = jobId
    ? database()
        .prepare(
          "SELECT data FROM corrections WHERE review_id=? AND job_id=? ORDER BY rowid",
        )
        .all(reviewId, jobId)
    : database()
        .prepare(
          "SELECT data FROM corrections WHERE review_id=? ORDER BY rowid",
        )
        .all(reviewId);
  return rows.map((r) => JSON.parse(r.data as string));
}
export function audit(reviewId: string, kind: string, data: unknown) {
  database()
    .prepare("INSERT INTO events VALUES(?,?,?,?,?)")
    .run(
      randomUUID(),
      reviewId,
      kind,
      JSON.stringify(data),
      new Date().toISOString(),
    );
}
export function eventsFor(reviewId: string) {
  return database()
    .prepare(
      "SELECT kind,data,created_at FROM events WHERE review_id=? ORDER BY rowid DESC LIMIT 100",
    )
    .all(reviewId)
    .map((r) => ({
      kind: r.kind,
      detail: JSON.parse(r.data as string),
      createdAt: r.created_at,
    }));
}
