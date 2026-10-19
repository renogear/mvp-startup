"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Upload,
  Plus,
  FileText,
  Search,
  Download,
  Check,
  ChevronRight,
  AlertTriangle,
  ShieldCheck,
  Layers,
  Compass,
  Loader2,
  SlidersHorizontal,
  Trash2,
  X,
  Clock,
  Save,
} from "lucide-react";
import { PlanCanvas } from "./PlanCanvas";
import {
  type Review,
  type PlanJob,
  type Correction,
  type ReviewContext,
  type Element,
  defaultContext,
  effectiveElements,
} from "@/lib/plan/schema";
import "./workbench.css";
import { evaluateReview } from "@/lib/plan/evaluation";
type Detail = {
  review: Review;
  jobs: PlanJob[];
  corrections: Correction[];
  events: { kind: string; createdAt: string }[];
};
const ahjs = [
  ["unverified", "Not yet established"],
  ["san-jose", "Incorporated City of San José"],
  ["santa-clara-county", "Unincorporated Santa Clara County"],
  ["san-diego-county", "County of San Diego"],
  ["other", "Other authority"],
] as const;
const classifications = [
  ["adu", "ADU / detached dwelling"],
  ["new-single-family", "New single-family home"],
  ["addition", "Residential addition"],
  ["garage-conversion", "Garage conversion"],
  ["remodel", "Kitchen / bathroom remodel"],
  ["whole-home", "Whole-home renovation"],
  ["structural", "Structural alteration"],
  ["other", "Other residential"],
] as const;
async function call(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "The operation could not be completed.");
  return data;
}

export default function PlanWorkbench() {
  const [session, setSession] = useState<{
      enabled: boolean;
      authenticated: boolean;
      cloudConfigured: boolean;
      aiConfigured: boolean;
      mode: "disabled" | "local-workstation" | "private-codespace";
    } | null>(null),
    [reviews, setReviews] = useState<Review[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [creating, setCreating] = useState(false),
    [context, setContext] = useState<ReviewContext>(defaultContext),
    [file, setFile] = useState<File | null>(null),
    [page, setPage] = useState(1),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [kind, setKind] = useState("all"),
    [search, setSearch] = useState(""),
    [panel, setPanel] = useState<"elements" | "context" | "history">(
      "elements",
    ),
    [annotations, setAnnotations] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const list = useCallback(async () => {
    const data = await call("/api/plans");
    setReviews(data.reviews);
  }, []);
  const open = useCallback(async (id: string, retain = false) => {
    const data: Detail = await call("/api/plans/" + id);
    setDetail(data);
    if (
      retain &&
      data.jobs.some((j) => j.state === "complete") &&
      !data.jobs.some((j) => j.state === "queued" || j.state === "processing")
    )
      setNotice((old) =>
        old.startsWith("Page queued.")
          ? "Extraction completed. Review each candidate against the original drawing."
          : old,
      );
    if (!retain) {
      setContext(data.review.context);
      setPage(data.jobs[0]?.page || 1);
      setSelectedId(null);
      setPanel("elements");
    }
    return data;
  }, []);
  useEffect(() => {
    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      fetch("/api/plans/session")
        .then((r) => {
          if (!r.ok)
            throw new Error("Workspace session is temporarily unavailable.");
          return r.json();
        })
        .then(async (data) => {
          if (!active) return;
          setSession(data);
          if (data.authenticated) await list();
          if (data.mode === "private-codespace" && !data.enabled)
            retry = setTimeout(load, 4000);
        })
        .catch((e) => {
          if (!active) return;
          setError(e.message);
          retry = setTimeout(load, 4000);
        });
    load();
    return () => {
      active = false;
      clearTimeout(retry);
    };
  }, [list]);
  const pending = Boolean(
    detail?.jobs.some((j) => j.state === "queued" || j.state === "processing"),
  );
  const reviewId = detail?.review.id;
  useEffect(() => {
    if (poll.current) clearInterval(poll.current);
    if (reviewId && pending) {
      const id = reviewId;
      poll.current = setInterval(() => {
        open(id, true).catch((e) => setError(e.message));
      }, 1200);
    }
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, [reviewId, pending, open]);
  const job = detail?.jobs.find((j) => j.page === page),
    result = job?.result || null;
  const currentCorrections =
    detail?.corrections.filter((c) =>
      result?.elements.some((e) => e.id === c.elementId),
    ) || [];
  const effective = result ? effectiveElements(result, currentCorrections) : [];
  const compliance =
    detail && result
      ? evaluateReview(detail.review.context, result, currentCorrections)
      : null;
  const visible = effective.filter(
    (v) =>
      (kind === "all" ||
        v.kind === kind ||
        (kind === "unreviewed" && v.status === "unreviewed")) &&
      `${v.label} ${v.element.evidence}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selected = effective.find((e) => e.element.id === selectedId) || null;
  async function startSession() {
    setBusy(true);
    setError("");
    try {
      await call("/api/plans/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setSession((s) => (s ? { ...s, authenticated: true } : s));
      await list();
      setCreating(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose the original PDF, PNG, or JPG first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = new FormData();
      data.set("file", file);
      data.set("context", JSON.stringify(context));
      const saved = await call("/api/plans", { method: "POST", body: data });
      await open(saved.review.id);
      setCreating(false);
      setFile(null);
      await list();
      setNotice(
        "Original file stored privately. Choose the floor-plan page and start extraction.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function analyze() {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await call(`/api/plans/${detail.review.id}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page }),
      });
      await open(detail.review.id, true);
      setNotice(
        "Page queued. The background worker will prepare text, measurements, and source locations.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveContext(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await call(`/api/plans/${detail.review.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context),
      });
      await open(detail.review.id, true);
      setNotice(
        "Regulatory context saved. This does not activate compliance rules.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function correction(payload: Omit<Correction, "id" | "createdAt">) {
    if (!detail || !job) return;
    setBusy(true);
    setError("");
    try {
      await call(`/api/plans/${detail.review.id}/corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, correction: payload }),
      });
      await open(detail.review.id, true);
      setNotice("Review recorded. The original extracted value is preserved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportReport() {
    if (!detail || !job) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/plans/${detail.review.id}/report?job=${job.id}`,
      );
      if (!response.ok) throw new Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob());
      download(url, "PermitPilot-plan-review.pdf");
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function exportJson() {
    if (!detail || !job) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              review: detail.review,
              job,
              corrections: currentCorrections,
              compliance: {
                status: "not_evaluated",
                activeRules: compliance?.enabledRuleCount || 0,
                evaluation: compliance,
                reason:
                  "No independently verified applicable rule set is active.",
              },
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    download(url, "PermitPilot-structured-review.json");
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  const working = job?.state === "queued" || job?.state === "processing";
  const browserWorkspace = session?.mode === "private-codespace";
  return (
    <div className="review-app">
      <header className="review-header">
        <Link
          href="/projects"
          className="review-logo"
          aria-label="PermitPilot projects"
        >
          <Compass size={22} />
          <strong>
            PermitPilot<span>.</span>
          </strong>
        </Link>
        <div className="review-header-divider" />
        <span>Plan review</span>
        {detail && (
          <>
            <ChevronRight size={13} />
            <strong className="review-project-name">
              {detail.review.context.projectName}
            </strong>
          </>
        )}
        <div className="review-header-end">
          <span className="local-label">
            <span />
            {browserWorkspace ? "BROWSER WORKSPACE" : "LOCAL WORKBENCH"}
          </span>
          <Link href="/projects">
            Projects <ArrowRight size={13} />
          </Link>
        </div>
      </header>
      {error && (
        <div className="review-alert error" role="alert">
          <AlertTriangle size={16} />
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            <X size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="review-alert info" role="status">
          <Check size={16} />
          {notice}
          <button onClick={() => setNotice("")} aria-label="Dismiss notice">
            <X size={15} />
          </button>
        </div>
      )}
      {!session ? (
        <div className="review-loading">
          <Loader2 className="spin" />
          Opening the plan workspace…
        </div>
      ) : !session.authenticated ? (
        <section className="workbench-welcome">
          <span className="eyebrow">
            ARCHITECTURAL EXTRACTION · HUMAN REVIEW
          </span>
          <h1>
            Read the drawing.
            <br />
            Keep the evidence.
          </h1>
          <p>
            Open a residential plan, extract printed dimensions and labels, and
            review every detail at its source.
          </p>
          <div className="local-mode">
            <ShieldCheck size={21} />
            <div>
              <strong>
                {browserWorkspace
                  ? "Your private browser workspace"
                  : "A private development workbench"}
              </strong>
              <p>
                {browserWorkspace
                  ? "Original drawings and review history are saved in your Codespace. Keep port 3000 Private and return in this browser to continue your reviews."
                  : "Originals and review history stay on this machine. Access is restricted to a local browser session; this is separate from Supabase accounts and cloud storage."}
              </p>
            </div>
          </div>
          {session.enabled ? (
            <button
              className="review-button primary"
              disabled={busy}
              onClick={startSession}
            >
              {browserWorkspace
                ? "Open private workbench"
                : "Open local workbench"}{" "}
              <ArrowRight size={16} />
            </button>
          ) : (
            <div className="review-blocked">
              <strong>
                {browserWorkspace
                  ? "Preparing your private workspace…"
                  : "Plan review is not enabled for this origin."}
              </strong>
              <p>
                {browserWorkspace ? (
                  "Startup is checking private port access and starting the document worker. This page will reconnect automatically. If startup reports an error, follow docs/CODESPACES.md in the editor."
                ) : (
                  <>
                    For local development, set{" "}
                    <code>PERMITPILOT_LOCAL_REVIEW=1</code>, start the worker,
                    and use a loopback development address. For browser access,
                    launch the repository’s configured GitHub Codespace.
                  </>
                )}
              </p>
              <Link href="/projects">
                Return to project workspace <ArrowRight size={15} />
              </Link>
            </div>
          )}
          <p className="fineprint">
            Real compliance decisions remain disabled until the actual AHJ, code
            edition, date, classification, and source-verified rule set are
            established.
          </p>
        </section>
      ) : creating ? (
        <div className="review-intake-wrap">
          <button
            className="review-back"
            onClick={() => {
              setCreating(false);
              setContext(detail?.review.context || defaultContext);
            }}
          >
            <ArrowLeft size={14} />
            Review library
          </button>
          <div className="review-intake-heading">
            <span className="eyebrow">START WITH THE ORIGINAL</span>
            <h1>New plan review</h1>
            <p>
              Extraction works for any jurisdiction. Code evaluation requires
              separately verified governing requirements.
            </p>
          </div>
          <form className="review-intake" onSubmit={upload}>
            <div className="review-form-grid">
              <label className="wide">
                Project / review name
                <input
                  required
                  minLength={2}
                  maxLength={120}
                  value={context.projectName}
                  onChange={(e) =>
                    setContext({ ...context, projectName: e.target.value })
                  }
                  placeholder="e.g. Willow Avenue ADU"
                />
              </label>
              <label className="wide">
                Property address <span>(leave blank for a reference plan)</span>
                <input
                  value={context.address}
                  onChange={(e) =>
                    setContext({ ...context, address: e.target.value })
                  }
                  maxLength={300}
                  placeholder="Unknown for a standard-plan reference document"
                />
              </label>
              <ContextFields context={context} onChange={setContext} />
            </div>
            <label className="original-upload">
              <Upload size={25} />
              <strong>
                {file ? file.name : "Choose the original drawing"}
              </strong>
              <span>PDF, PNG or JPG · up to 20 MB · PDF up to 100 pages</span>
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                aria-label="Original floor plan"
              />
            </label>
            <div className="review-form-footer">
              <span>
                Only the selected page is analyzed. Source files are retained
                unchanged.
              </span>
              <button className="review-button primary" disabled={busy}>
                {busy ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Upload size={15} />
                )}
                Save original & open viewer
              </button>
            </div>
          </form>
        </div>
      ) : !detail ? (
        <div className="review-library">
          <div className="review-library-heading">
            <div>
              <span className="eyebrow">YOUR DRAWING WORKSPACE</span>
              <h1>Plan reviews</h1>
              <p>Original drawings. Traceable facts. Clear limitations.</p>
            </div>
            <button
              className="review-button primary"
              onClick={() => {
                setContext({ ...defaultContext, projectName: "" });
                setCreating(true);
              }}
            >
              <Plus size={17} />
              New plan review
            </button>
          </div>
          <div className="review-library-list">
            {reviews.length === 0 ? (
              <div className="review-empty">
                <FileText size={30} />
                <h2>A drawing is the starting point.</h2>
                <p>
                  Upload a real floor plan to inspect its pages and extract
                  architectural evidence.
                </p>
                <button
                  className="review-button primary"
                  onClick={() => {
                    setContext({ ...defaultContext, projectName: "" });
                    setCreating(true);
                  }}
                >
                  <Plus size={15} />
                  New plan review
                </button>
              </div>
            ) : (
              reviews.map((r) => (
                <button
                  className="review-library-row"
                  key={r.id}
                  onClick={() => open(r.id).catch((e) => setError(e.message))}
                >
                  <FileText size={23} />
                  <div>
                    <strong>{r.context.projectName}</strong>
                    <span>
                      {r.name} · {(r.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>
                  <span>{ahjs.find((j) => j[0] === r.context.ahj)?.[1]}</span>
                  <ChevronRight size={17} />
                </button>
              ))
            )}
          </div>
          <p className="fineprint">
            Local files are private to this browser session. Keep the local data
            directory when restarting the application.
          </p>
        </div>
      ) : (
        <>
          <div className="review-titlebar">
            <div>
              <button
                className="review-back"
                onClick={() => {
                  setDetail(null);
                  list().catch((e) => setError(e.message));
                }}
              >
                <ArrowLeft size={14} />
                All reviews
              </button>
              <h1>{detail.review.context.projectName}</h1>
              <p>
                <FileText size={13} />
                {detail.review.name}
                <span>·</span>
                {(detail.review.size / 1024 / 1024).toFixed(1)} MB<span>·</span>
                SHA-256 {detail.review.sha256.slice(0, 12)}…
              </p>
            </div>
            <div className="review-actions">
              <button
                className="review-button"
                disabled={!result || busy}
                onClick={exportJson}
              >
                <Download size={14} />
                Structured JSON
              </button>
              <button
                className="review-button"
                disabled={!result || busy}
                onClick={exportReport}
              >
                <Download size={14} />
                Export review
              </button>
              <button
                className="review-button primary"
                disabled={working || busy || Boolean(result)}
                onClick={analyze}
              >
                {working ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Layers size={15} />
                )}{" "}
                {working
                  ? job.state === "queued"
                    ? "Queued"
                    : "Extracting"
                  : result
                    ? "Page extracted"
                    : "Extract this page"}
              </button>
            </div>
          </div>
          <div className="regulatory-banner">
            <ShieldCheck size={17} />
            <strong>Compliance not evaluated</strong>
            <span>
              {detail.review.context.ahj === "san-diego-county"
                ? "San Diego source plan · San José checks disabled."
                : "No source-verified applicable rule set is active."}
            </span>
            <button onClick={() => setPanel("context")}>
              Review governing context <ChevronRight size={13} />
            </button>
          </div>
          <div className="review-workspace">
            <section className="drawing-panel">
              <div className="drawing-panel-heading">
                <span>
                  <FileText size={15} />
                  Original drawing <small>Page {page}</small>
                </span>
                <label>
                  <input
                    type="checkbox"
                    checked={annotations}
                    onChange={(e) => setAnnotations(e.target.checked)}
                  />
                  Annotations
                </label>
              </div>
              <PlanCanvas
                src={`/api/plans/${detail.review.id}/file`}
                mime={detail.review.mime}
                page={page}
                onPageChange={(n) => {
                  setPage(n);
                  setSelectedId(null);
                }}
                elements={visible.map((v) => ({
                  ...v.element,
                  label: v.label,
                }))}
                selectedId={selectedId}
                onSelect={setSelectedId}
                showAnnotations={annotations}
              />
              <div className="drawing-bottom">
                <span>
                  <span className="candidate-dot" />
                  Extracted candidate · location on source
                </span>
                <span>
                  Highlights mark text or schedule evidence, not room
                  boundaries.
                </span>
              </div>
            </section>
            <aside className="evidence-panel">
              <div className="evidence-tabs">
                {(["elements", "context", "history"] as const).map((t) => (
                  <button
                    key={t}
                    className={panel === t ? "active" : ""}
                    onClick={() => setPanel(t)}
                  >
                    {t === "elements"
                      ? "Drawing evidence"
                      : t === "context"
                        ? "Regulatory context"
                        : "History"}
                  </button>
                ))}
              </div>
              {panel === "context" ? (
                <form className="context-panel" onSubmit={saveContext}>
                  <h2>Governing context</h2>
                  <p>
                    A mailing address does not establish the AHJ. Source
                    provenance is distinct from the actual project location.
                  </p>
                  <ContextFields context={context} onChange={setContext} />
                  <div className="coverage-block">
                    <AlertTriangle size={18} />
                    <strong>Rules remain inactive</strong>
                    {compliance && (
                      <details>
                        <summary>
                          Recorded evaluation blockers (
                          {compliance.blockers.length})
                        </summary>
                        {compliance.blockers.map((blocker, i) => (
                          <p key={i}>{blocker}</p>
                        ))}
                      </details>
                    )}
                    <p>
                      Applicable 2025 California codes, local amendments,
                      plan-review instructions, dates, classifications, and
                      exceptions must be independently reviewed before any real
                      code evaluation.
                    </p>
                    <p>
                      San Diego County and unincorporated Santa Clara County are
                      separate from the incorporated City of San José.
                    </p>
                  </div>
                  <button className="review-button primary" disabled={busy}>
                    <Save size={15} />
                    Save context
                  </button>
                </form>
              ) : panel === "history" ? (
                <div className="history-panel">
                  <h2>Review history</h2>
                  <p>
                    Original values and subsequent corrections are retained
                    separately.
                  </p>
                  {detail.events.map((event, i) => (
                    <div key={i}>
                      <Clock size={14} />
                      <span>
                        <strong>{event.kind.replaceAll("_", " ")}</strong>
                        <small>
                          {new Date(event.createdAt).toLocaleString()}
                        </small>
                      </span>
                    </div>
                  ))}
                  <button
                    className="review-delete"
                    onClick={async () => {
                      if (
                        !confirm(
                          "Delete this review, its original file, and review history?",
                        )
                      )
                        return;
                      try {
                        await call("/api/plans/" + detail.review.id, {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: "{}",
                        });
                        setDetail(null);
                        await list();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <Trash2 size={14} />
                    Delete local review
                  </button>
                </div>
              ) : selected ? (
                <ElementEditor
                  key={
                    selected.element.id +
                    "-" +
                    (selected.correction?.id || "original")
                  }
                  element={selected.element}
                  correction={selected.correction}
                  onClose={() => setSelectedId(null)}
                  onSave={correction}
                  busy={busy}
                />
              ) : (
                <div className="element-list-panel">
                  <div className="extraction-summary">
                    <span className="eyebrow">
                      {result ? "EXTRACTION COMPLETE" : "PAGE PREPARATION"}
                    </span>
                    <h2>
                      {result
                        ? `${result.elements.length} evidence candidates`
                        : "Understand this sheet"}
                    </h2>
                    <p>
                      {result
                        ? `${(result.metrics.processingMs / 1000).toFixed(2)}s processing · ${effective.filter((v) => v.status === "confirmed" || v.status === "corrected").length} human-reviewed`
                        : "Choose a floor-plan page, then extract its printed text and dimensions."}
                    </p>
                  </div>
                  {working && (
                    <div className="worker-status">
                      <Loader2 size={17} className="spin" />
                      <div>
                        <strong>
                          {job.state === "queued"
                            ? "Waiting for the document worker"
                            : "Extracting selected page"}
                        </strong>
                        <p>
                          {job.state === "queued"
                            ? "Start npm run plan:worker if the job remains queued."
                            : "Preparing text, source coordinates, and dimension candidates."}
                        </p>
                      </div>
                    </div>
                  )}
                  {job?.state === "failed" && (
                    <div className="worker-failure">
                      <strong>Extraction needs attention</strong>
                      <p>{job.error}</p>
                      <button className="review-button" onClick={analyze}>
                        Retry extraction
                      </button>
                    </div>
                  )}
                  {result && (
                    <>
                      <div className="evidence-search">
                        <Search size={14} />
                        <input
                          placeholder="Find a room or dimension…"
                          aria-label="Search drawing evidence"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                      <select
                        aria-label="Filter evidence"
                        value={kind}
                        onChange={(e) => setKind(e.target.value)}
                      >
                        <option value="all">All evidence</option>
                        <option value="room_label">Room labels</option>
                        <option value="dimension">Dimensions</option>
                        <option value="door_schedule">Door schedules</option>
                        <option value="window_schedule">
                          Window schedules
                        </option>
                        <option value="scale">Drawing scale</option>
                        <option value="unreviewed">Needs human review</option>
                        <option value="annotation">Other annotations</option>
                      </select>
                      <div className="evidence-rows">
                        {visible.map((v) => (
                          <button
                            className="evidence-row"
                            data-testid="element-row"
                            data-element-id={v.element.id}
                            key={v.element.id}
                            onClick={() => setSelectedId(v.element.id)}
                          >
                            <span className={"element-kind " + v.kind}>
                              <ElementIcon kind={v.kind} />
                            </span>
                            <span>
                              <strong>{v.label}</strong>
                              <small>
                                {v.kind.replaceAll("_", " ")} · p.{" "}
                                {v.element.page} ·{" "}
                                {v.status.replaceAll("_", " ")}
                              </small>
                            </span>
                            <ChevronRight size={14} />
                          </button>
                        ))}
                        {!visible.length && (
                          <p className="no-evidence">
                            No evidence matches this filter.
                          </p>
                        )}
                      </div>
                      {result.warnings.length > 0 && (
                        <details className="extraction-warnings">
                          <summary>
                            Limitations & unknowns ({result.warnings.length})
                          </summary>
                          {result.warnings.map((w, i) => (
                            <p key={i}>{w}</p>
                          ))}
                        </details>
                      )}
                    </>
                  )}
                  <div className="ai-status">
                    <SlidersHorizontal size={15} />
                    <div>
                      <strong>Deterministic extraction</strong>
                      <p>
                        Printed text and spatial candidates only.{" "}
                        {session.aiConfigured
                          ? "AI credentials are present; this baseline does not invoke AI interpretation."
                          : "AI interpretation is unavailable; no OpenAI key is configured."}{" "}
                        No inferred room boundaries or technical compliance
                        claims.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}
function ElementIcon({ kind }: { kind: Element["kind"] }) {
  return kind === "room_label" ? (
    <Layers size={14} />
  ) : kind === "dimension" ? (
    <SlidersHorizontal size={14} />
  ) : (
    <FileText size={14} />
  );
}
function ContextFields({
  context,
  onChange,
}: {
  context: ReviewContext;
  onChange: (c: ReviewContext) => void;
}) {
  return (
    <>
      <label>
        Authority having jurisdiction
        <select
          value={context.ahj}
          onChange={(e) =>
            onChange({
              ...context,
              ahj: e.target.value as ReviewContext["ahj"],
              jurisdictionStatus: "unverified",
              jurisdictionEvidence: "",
            })
          }
        >
          {ahjs.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Project classification
        <select
          value={context.classification}
          onChange={(e) =>
            onChange({
              ...context,
              classification: e.target.value as ReviewContext["classification"],
            })
          }
        >
          {classifications.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        New or existing work
        <select
          value={context.construction}
          onChange={(e) =>
            onChange({
              ...context,
              construction: e.target.value as ReviewContext["construction"],
            })
          }
        >
          <option value="unknown">Not established</option>
          <option value="new">New construction</option>
          <option value="existing">Existing construction</option>
        </select>
      </label>
      <label>
        Permit application date
        <input
          type="date"
          value={context.applicationDate}
          onChange={(e) =>
            onChange({ ...context, applicationDate: e.target.value })
          }
        />
      </label>
      <label>
        Code edition <span>(unverified context)</span>
        <input
          value={context.codeEdition}
          onChange={(e) =>
            onChange({ ...context, codeEdition: e.target.value })
          }
          placeholder="Not established — verify adoption and applicability"
        />
      </label>
      <label>
        Jurisdiction confirmation
        <select
          value={context.jurisdictionStatus}
          onChange={(e) =>
            onChange({
              ...context,
              jurisdictionStatus: e.target
                .value as ReviewContext["jurisdictionStatus"],
            })
          }
        >
          <option value="unverified">Unverified</option>
          <option value="user_confirmed">Manually confirmed by user</option>
          <option value="unsupported">Unsupported / not established</option>
        </select>
      </label>
      <label className="wide">
        Confirmation evidence / limitations
        <textarea
          value={context.jurisdictionEvidence}
          onChange={(e) =>
            onChange({ ...context, jurisdictionEvidence: e.target.value })
          }
          maxLength={2000}
          placeholder="Record the official parcel or department reference. Template publisher does not establish actual parcel jurisdiction."
          rows={2}
        />
      </label>
      <label className="wide">
        Document source URL <span>(if known)</span>
        <input
          type="url"
          value={context.sourceUrl}
          onChange={(e) => onChange({ ...context, sourceUrl: e.target.value })}
          placeholder="https://official-authority.gov/original.pdf"
        />
      </label>
    </>
  );
}
function ElementEditor({
  element,
  correction,
  onSave,
  onClose,
  busy,
}: {
  element: Element;
  correction: Correction | null;
  onSave: (c: Omit<Correction, "id" | "createdAt">) => Promise<void>;
  onClose: () => void;
  busy: boolean;
}) {
  const [label, setLabel] = useState(correction?.label || element.label),
    [kind, setKind] = useState(correction?.kind || element.kind),
    [value, setValue] = useState(
      correction?.value !== undefined && correction.value !== null
        ? String(correction.value)
        : element.originalValue
          ? String(element.originalValue.value)
          : "",
    ),
    [unit, setUnit] = useState<Correction["unit"]>(
      correction?.unit || element.originalValue?.unit || "in",
    ),
    [status, setStatus] = useState<Correction["status"]>(
      correction?.status || "confirmed",
    ),
    [note, setNote] = useState(correction?.note || "");
  return (
    <form
      className="element-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({
          elementId: element.id,
          label,
          kind,
          status,
          value: value === "" ? null : Number(value),
          unit,
          note,
        });
      }}
    >
      <button type="button" className="review-back" onClick={onClose}>
        <ArrowLeft size={14} />
        All drawing evidence
      </button>
      <span className="eyebrow">SOURCE EVIDENCE · PAGE {element.page}</span>
      <h2>
        {element.kind === "room_label"
          ? "Review room label"
          : element.kind === "dimension"
            ? "Review measurement"
            : "Review drawing annotation"}
      </h2>
      <div className="original-evidence">
        <span>Original extraction · retained unchanged</span>
        <strong>{element.label}</strong>
        <p>{element.evidence}</p>
        <small>
          {element.method.replaceAll("_", " ")} · {element.confidence}{" "}
          extraction confidence
        </small>
      </div>
      <label>
        Reviewed label
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
          maxLength={4000}
        />
      </label>
      <label>
        Element type
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as Element["kind"])}
        >
          {[
            "room_label",
            "dimension",
            "scale",
            "door_schedule",
            "window_schedule",
            "annotation",
          ].map((k) => (
            <option value={k} key={k}>
              {k.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <div className="measurement-input">
        <label>
          Measurement value
          <input
            type="number"
            min="0"
            step="any"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setStatus("corrected");
            }}
            placeholder="Unknown"
          />
        </label>
        <label>
          Unit
          <select
            value={unit}
            onChange={(e) => {
              setUnit(e.target.value as Correction["unit"]);
              setStatus("corrected");
            }}
          >
            {["in", "ft", "mm", "cm", "m"].map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="editor-explainer">
        For a dimension string with multiple values, review the selected
        measurement only. Text-box locations do not identify dimension endpoints
        or room boundaries.
      </p>
      <label>
        Review decision
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as Correction["status"])}
        >
          <option value="confirmed">Confirm extracted evidence</option>
          <option value="corrected">Corrected by reviewer</option>
          <option value="rejected">Reject incorrect interpretation</option>
          <option value="irrelevant">Not relevant to this review</option>
        </select>
      </label>
      <label>
        Review note
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={3000}
          rows={3}
          placeholder="How was this checked against the printed drawing?"
        />
      </label>
      <div className="coordinate-note">
        Displayed-page box: x {element.bbox.x.toFixed(3)}, y{" "}
        {element.bbox.y.toFixed(3)}, w {element.bbox.width.toFixed(3)}, h{" "}
        {element.bbox.height.toFixed(3)}
      </div>
      <button className="review-button primary" disabled={busy}>
        <Check size={15} />
        {busy ? "Saving…" : "Save human review"}
      </button>
      <p className="fineprint">
        Confirming a fact does not certify code compliance.
      </p>
    </form>
  );
}
