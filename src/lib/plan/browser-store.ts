import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import {
  contextSchema,
  correctionSchema,
  defaultContext,
  resultSchema,
  type Correction,
  type PlanJob,
  type Review,
  type ReviewContext,
} from "./schema";
import { extractBrowserPlan } from "./browser-extract";
import { browserReport } from "./browser-report";

export type BrowserTransport = {
  storageMode: "persistent" | "temporary";
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  fileUrl: (reviewId: string) => string;
  ensureSample: (bytes: Uint8Array) => Promise<string | null>;
};

type StoredCorrection = Correction & { jobId: string };
type Event = { kind: string; createdAt: string };
type StoredReview = {
  id: string;
  review: Review;
  blob: Blob;
  jobs: PlanJob[];
  corrections: StoredCorrection[];
  events: Event[];
};

type Mutation<T> = (record: StoredReview | undefined) => {
  record?: StoredReview;
  value: T;
};
type ReviewStorage = {
  all: () => Promise<StoredReview[]>;
  read: (id: string) => Promise<StoredReview | undefined>;
  mutate: <T>(id: string, mutate: Mutation<T>) => Promise<T>;
};

const DATABASE = "permitpilot-browser-workbench";
const STORE = "reviews";
const MAX_BYTES = 20 * 1024 * 1024;
const SESSION = {
  mode: "browser-only",
  enabled: true,
  authenticated: true,
  cloudConfigured: false,
  aiConfigured: false,
};

function storageFailure(error?: unknown): Error {
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : "";
  const reason = message ? ` ${message}` : "";
  return new Error(
    "Browser storage could not save this operation. Allow site storage and check available space. Your browser must support IndexedDB; changes were not silently saved elsewhere." +
      reason,
  );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(storageFailure());
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(storageFailure(request.error));
    request.onblocked = () =>
      reject(
        new Error(
          "Close other PermitPilot tabs and reopen this file to update browser storage.",
        ),
      );
  });
}

function allRecords(db: IDBDatabase): Promise<StoredReview[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    tx.oncomplete = () => resolve(request.result as StoredReview[]);
    tx.onerror = () => reject(storageFailure(tx.error));
    tx.onabort = () => reject(storageFailure(tx.error));
  });
}

function readRecord(
  db: IDBDatabase,
  id: string,
): Promise<StoredReview | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(id);
    tx.oncomplete = () => resolve(request.result as StoredReview | undefined);
    tx.onerror = () => reject(storageFailure(tx.error));
    tx.onabort = () => reject(storageFailure(tx.error));
  });
}

/** The read and write share a transaction so extraction cannot overwrite a review edit. */
function mutateRecord<T>(
  db: IDBDatabase,
  id: string,
  mutate: Mutation<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const request = store.get(id);
    let value: T;
    let thrown: unknown;
    request.onsuccess = () => {
      try {
        const change = mutate(request.result as StoredReview | undefined);
        value = change.value;
        if (change.record) store.put(change.record);
        else store.delete(id);
      } catch (error) {
        thrown = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(thrown || storageFailure(tx.error));
    tx.onabort = () => reject(thrown || storageFailure(tx.error));
  });
}

/** Check writes before choosing a storage mode, without retaining a probe record. */
function checkDatabaseWrite(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const id = `__storage-check-${crypto.randomUUID()}`;
    // Some file:// browsers accept plain metadata but reject File/Blob writes.
    // Test the actual required capability before promising persistent storage.
    const blob = new File([new Uint8Array([37, 80])], "storage-check.bin", {
      type: "application/octet-stream",
    });
    store.put({ id, blob });
    const read = store.get(id);
    let restored: Blob | undefined;
    read.onsuccess = () => {
      restored = read.result?.blob;
      store.delete(id);
    };
    tx.oncomplete = () => {
      void (async () => {
        try {
          if (!(restored instanceof Blob))
            throw new Error("File storage is unavailable.");
          const bytes = new Uint8Array(await restored.arrayBuffer());
          if (bytes.length !== 2 || bytes[0] !== 37 || bytes[1] !== 80)
            throw new Error(
              "File storage could not preserve the source bytes.",
            );
          resolve();
        } catch (error) {
          reject(storageFailure(error));
        }
      })();
    };
    tx.onerror = () => reject(storageFailure(tx.error));
    tx.onabort = () => reject(storageFailure(tx.error));
  });
}

/** Real, temporary in-tab state. Callers must display that closing loses changes. */
function temporaryStorage(): ReviewStorage {
  const records = new Map<string, StoredReview>();
  let tail: Promise<unknown> = Promise.resolve();
  // WebKit may reject structuredClone(File) for an opaque file:// origin.
  // Blobs and Files are immutable, so retaining their references is safe while
  // copying mutable metadata prevents callers from altering stored reviews.
  function clone<T>(value: T): T {
    if (value instanceof Blob) return value;
    if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, clone(item)]),
      ) as T;
    return value;
  }
  function serialized<T>(operation: () => T): Promise<T> {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  }
  return {
    all: () => serialized(() => clone([...records.values()])),
    read: (id) => serialized(() => clone(records.get(id))),
    mutate<T>(id: string, mutate: Mutation<T>) {
      return serialized(() => {
        const change = mutate(clone(records.get(id)));
        if (change.record) records.set(id, clone(change.record));
        else records.delete(id);
        return clone(change.value);
      });
    },
  };
}

function required(record: StoredReview | undefined): StoredReview {
  if (!record) throw new Error("Review unavailable in this browser.");
  return record;
}

function event(record: StoredReview, kind: string) {
  record.events.push({ kind, createdAt: new Date().toISOString() });
}

function publicCorrection(correction: StoredCorrection): Correction {
  return {
    ...correctionSchema.parse(correction),
    id: correction.id,
    createdAt: correction.createdAt,
  };
}

async function parseJson(init?: RequestInit): Promise<unknown> {
  if (typeof init?.body !== "string")
    throw new Error("Expected a JSON request.");
  if (init.body.length > 100_000) throw new Error("Request is too large.");
  return JSON.parse(init.body);
}

function blobUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

/**
 * A standalone, single-browser adapter. Files never leave the browser. It is not
 * organization authentication, a hosted service, or the server's durable worker.
 */
export async function createBrowserTransport(
  options: { allowTemporary?: boolean } = {},
): Promise<BrowserTransport> {
  let storage: ReviewStorage;
  let storageMode: BrowserTransport["storageMode"] = "persistent";
  let initial: StoredReview[];
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    initial = await allRecords(db);
    await checkDatabaseWrite(db);
    const readyDatabase = db;
    storage = {
      all: () => allRecords(readyDatabase),
      read: (id) => readRecord(readyDatabase, id),
      mutate: (id, mutate) => mutateRecord(readyDatabase, id, mutate),
    };
  } catch (error) {
    db?.close();
    if (!options.allowTemporary) throw error;
    storageMode = "temporary";
    storage = temporaryStorage();
    initial = [];
  }
  const urls = new Map<string, string>();
  const running = new Map<string, Promise<void>>();
  let fatal: Error | null = null;

  for (const stored of initial) {
    urls.set(stored.id, blobUrl(stored.blob));
    if (
      stored.jobs.some(
        (job) => job.state === "queued" || job.state === "processing",
      )
    ) {
      await storage.mutate(stored.id, (record) => {
        const current = required(record);
        for (const job of current.jobs) {
          if (job.state !== "queued" && job.state !== "processing") continue;
          job.state = "failed";
          job.finishedAt = new Date().toISOString();
          job.error =
            "This browser tab closed or reloaded before extraction finished. Retry extraction; the original document is preserved.";
        }
        event(current, "interrupted_extraction_marked_retryable");
        return { record: current, value: undefined };
      });
    }
  }

  async function createReview(
    file: File,
    context: ReviewContext,
  ): Promise<Review> {
    if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type))
      throw new Error("Choose a PDF, PNG, or JPG file.");
    if (!file.size || file.size > MAX_BYTES)
      throw new Error("Choose a nonempty file of at most 20 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const valid =
      file.type === "application/pdf"
        ? new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-"
        : file.type === "image/png"
          ? bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10"
          : bytes.slice(0, 3).join(",") === "255,216,255";
    if (!valid)
      throw new Error("File contents do not match its selected type.");
    let pageCount = 1;
    if (file.type === "application/pdf") {
      const pdf = await PDFDocument.load(bytes);
      pageCount = pdf.getPageCount();
      if (pageCount > 100)
        throw new Error("Select a PDF with no more than 100 pages.");
    }
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const id = crypto.randomUUID();
    const review: Review = {
      id,
      ownerId: "this-browser-only",
      organizationId: null,
      projectId: null,
      documentId: null,
      name: file.name.slice(0, 255),
      mime: file.type,
      size: file.size,
      sha256,
      context: contextSchema.parse(context),
      pageCount,
      createdAt: new Date().toISOString(),
    };
    const record: StoredReview = {
      id,
      review,
      blob: file,
      jobs: [],
      corrections: [],
      events: [],
    };
    event(record, "original_saved_in_browser");
    await storage.mutate(id, () => ({ record, value: undefined }));
    urls.set(id, blobUrl(file));
    return review;
  }

  async function processJob(reviewId: string, jobId: string): Promise<void> {
    const current = await storage.mutate(reviewId, (record) => {
      if (!record) return { value: null };
      const job = record.jobs.find((candidate) => candidate.id === jobId);
      if (!job || job.state !== "queued") return { record, value: null };
      job.state = "processing";
      job.attempts += 1;
      job.startedAt = new Date().toISOString();
      event(record, "browser_extraction_started");
      return {
        record,
        value: { review: record.review, blob: record.blob, job },
      };
    });
    if (!current) return;
    try {
      if (current.review.mime !== "application/pdf")
        throw new Error(
          "This browser prototype extracts embedded text from PDFs. Image OCR is unavailable; keep the image for visual review or upload a text-based PDF.",
        );
      const bytes = new Uint8Array(await current.blob.arrayBuffer());
      const result = resultSchema.parse(
        await extractBrowserPlan(
          bytes,
          reviewId,
          current.job.page,
          current.review.sha256,
        ),
      );
      if (
        result.documentId !== reviewId ||
        result.sourceSha256 !== current.review.sha256 ||
        result.page.number !== current.job.page ||
        result.elements.some((element) => element.page !== current.job.page)
      )
        throw new Error(
          "Extraction source identity did not match the selected document and page.",
        );
      await storage.mutate(reviewId, (record) => {
        if (!record) return { value: undefined };
        const job = record.jobs.find((candidate) => candidate.id === jobId);
        if (!job || job.state !== "processing")
          return { record, value: undefined };
        job.state = "complete";
        job.result = result;
        job.finishedAt = new Date().toISOString();
        event(record, "browser_extraction_completed");
        return { record, value: undefined };
      });
    } catch (error) {
      await storage.mutate(reviewId, (record) => {
        if (!record) return { value: undefined };
        const job = record.jobs.find((candidate) => candidate.id === jobId);
        if (!job || job.state !== "processing")
          return { record, value: undefined };
        job.state = "failed";
        job.error =
          error instanceof Error
            ? error.message
            : "Extraction could not finish. Retry with the original PDF.";
        job.finishedAt = new Date().toISOString();
        event(record, "browser_extraction_failed");
        return { record, value: undefined };
      });
    }
  }

  async function enqueue(reviewId: string, page: number): Promise<PlanJob> {
    const job = await storage.mutate(reviewId, (record) => {
      const current = required(record);
      if (current.review.pageCount && page > current.review.pageCount)
        throw new Error("Page outside document.");
      const existing = current.jobs.find(
        (candidate) => candidate.page === page && candidate.state !== "failed",
      );
      if (existing) return { record: current, value: existing };
      if (
        current.jobs.filter((candidate) =>
          ["queued", "processing"].includes(candidate.state),
        ).length >= 3
      )
        throw new Error("Wait for queued pages before adding another.");
      const job: PlanJob = {
        id: crypto.randomUUID(),
        reviewId,
        page,
        state: "queued",
        attempts: 0,
        createdAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
        error: null,
        result: null,
      };
      current.jobs.unshift(job);
      event(current, "browser_page_queued");
      return { record: current, value: job };
    });
    if (job.state !== "queued" || running.has(job.id)) return job;
    const task = processJob(reviewId, job.id)
      .catch((error) => {
        fatal = storageFailure(error);
      })
      .finally(() => running.delete(job.id));
    running.set(job.id, task);
    return job;
  }

  return {
    storageMode,
    fileUrl(reviewId) {
      const url = urls.get(reviewId);
      if (!url)
        throw new Error("Original drawing is unavailable in this browser.");
      return url;
    },
    async ensureSample(bytes) {
      if ((await storage.all()).length) return null;
      const file = new File(
        [new Uint8Array(bytes).buffer],
        "San-Diego-Plan-F-A1-source-page-5.pdf",
        { type: "application/pdf" },
      );
      const review = await createReview(file, {
        ...defaultContext,
        projectName: "San Diego Plan F · A1 reference",
        ahj: "san-diego-county",
        jurisdictionStatus: "unverified",
        jurisdictionEvidence:
          "One-page excerpt of sheet A1 from source PDF page 5. Reference plan attributed to County of San Diego; source bytes have not been independently authenticated. No actual property jurisdiction or current governing code has been verified; extraction baseline only.",
        sourceUrl:
          "https://www.sandiegocounty.gov/content/dam/sdc/pds/bldg/adu_info/pds671_11x17.pdf#page=5",
      });
      const job = await enqueue(review.id, 1);
      await running.get(job.id);
      if (fatal) throw fatal;
      return review.id;
    },
    async fetch(url, init) {
      try {
        if (fatal) throw fatal;
        const parsedUrl = new URL(url, "https://permitpilot.browser.invalid");
        const path = parsedUrl.pathname.replace(/\/$/, "");
        const method = (init?.method || "GET").toUpperCase();
        if (path === "/api/plans/session" && ["GET", "POST"].includes(method))
          return Response.json({ ...SESSION, storageMode });
        if (path === "/api/plans" && method === "GET") {
          const records = await storage.all();
          return Response.json({
            reviews: records
              .map((record) => record.review)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          });
        }
        if (path === "/api/plans" && method === "POST") {
          if (!(init?.body instanceof FormData))
            throw new Error("Expected an original file upload.");
          const file = init.body.get("file");
          if (!(file instanceof File))
            throw new Error("Choose an original file.");
          const context = contextSchema.parse(
            JSON.parse(String(init.body.get("context") || "{}")),
          );
          const review = await createReview(file, context);
          return Response.json({ review }, { status: 201 });
        }
        const match = path.match(
          /^\/api\/plans\/([^/]+)(?:\/(jobs|corrections|report|file))?$/,
        );
        if (!match)
          return Response.json(
            { error: "Unsupported browser operation." },
            { status: 404 },
          );
        const [, id, action] = match;
        const stored = await storage.read(id);
        if (!stored)
          return Response.json(
            { error: "Review unavailable in this browser." },
            { status: 404 },
          );
        if (!action && method === "GET") {
          return Response.json({
            review: stored.review,
            jobs: stored.jobs,
            corrections: stored.corrections.map(publicCorrection),
            events: [...stored.events].reverse(),
          });
        }
        if (!action && method === "PATCH") {
          const context = contextSchema.parse(await parseJson(init));
          const review = await storage.mutate(id, (record) => {
            const current = required(record);
            current.review.context = context;
            event(current, "regulatory_context_updated");
            return { record: current, value: current.review };
          });
          return Response.json({ review });
        }
        if (!action && method === "DELETE") {
          await storage.mutate(id, () => ({ value: undefined }));
          const url = urls.get(id);
          if (url) URL.revokeObjectURL(url);
          urls.delete(id);
          return Response.json({ ok: true });
        }
        if (action === "jobs" && method === "POST") {
          const { page } = z
            .object({ page: z.number().int().min(1).max(100) })
            .parse(await parseJson(init));
          return Response.json(
            { job: await enqueue(id, page) },
            { status: 202 },
          );
        }
        if (action === "corrections" && method === "POST") {
          const body = z
            .object({ jobId: z.uuid(), correction: correctionSchema })
            .parse(await parseJson(init));
          const correction = await storage.mutate(id, (record) => {
            const current = required(record);
            const job = current.jobs.find(
              (candidate) => candidate.id === body.jobId,
            );
            if (
              job?.state !== "complete" ||
              !job.result?.elements.some(
                (element) => element.id === body.correction.elementId,
              )
            )
              throw new Error(
                "Select an extracted element from this completed review.",
              );
            const saved: StoredCorrection = {
              ...body.correction,
              id: crypto.randomUUID(),
              createdAt: new Date().toISOString(),
              jobId: body.jobId,
            };
            current.corrections.push(saved);
            event(current, "human_review_recorded");
            return { record: current, value: publicCorrection(saved) };
          });
          return Response.json({ correction });
        }
        if (action === "file" && method === "GET")
          return new Response(stored.blob);
        if (action === "report" && method === "GET") {
          const job = stored.jobs.find(
            (candidate) => candidate.id === parsedUrl.searchParams.get("job"),
          );
          if (job?.state !== "complete" || !job.result)
            return Response.json(
              { error: "Complete extraction before exporting its report." },
              { status: 409 },
            );
          const corrections = stored.corrections.filter(
            (correction) => correction.jobId === job.id,
          );
          const bytes = await browserReport(
            stored.review,
            job,
            corrections,
            stored.blob,
          );
          await storage.mutate(id, (record) => {
            if (record) event(record, "browser_report_exported");
            return { record, value: undefined };
          });
          return new Response(new Uint8Array(bytes).buffer, {
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition":
                'attachment; filename="PermitPilot-plan-review.pdf"',
            },
          });
        }
        return Response.json(
          { error: "Unsupported browser operation." },
          { status: 405 },
        );
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "This browser operation could not be completed.",
          },
          { status: 400 },
        );
      }
    },
  };
}
