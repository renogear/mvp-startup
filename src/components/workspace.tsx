"use client";
import Image from "next/image";
import { AuthScreen } from "./auth-screen";
import { Logo, Empty } from "./shared";
import { AIReview } from "./AIReview";
import { ReadinessReport } from "./ReadinessReport";
import { RequirementsPanel } from "./RequirementsPanel";
import { loadRules } from "@/lib/rules";
import { useEffect, useState, useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  LayoutDashboard,
  Layers,
  FolderOpen,
  Landmark,
  Settings,
  Plus,
  ArrowUpRight,
  ArrowLeft,
  Search,
  Check,
  ChevronRight,
  FileText,
  Upload,
  Trash2,
  ShieldCheck,
  LogOut,
  Loader2,
  PanelLeftClose,
  Compass,
  Download,
  AlertCircle,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { browserDb, configured } from "@/lib/supabase";
import {
  categories,
  projectSchema,
  type Intake,
  type Project,
  type Doc,
  type Requirement,
  jurisdictions,
  validateFile,
} from "@/lib/domain";
const tabs = [
  "Overview",
  "Requirements",
  "Documents",
  "AI Review",
  "Readiness Report",
];
export default function Workspace() {
  const [ready, setReady] = useState(!configured),
    [demo, setDemo] = useState(false),
    [user, setUser] = useState(""),
    [org, setOrg] = useState(""),
    [orgName, setOrgName] = useState("My organization"),
    [projects, setProjects] = useState<Project[]>([]),
    [rules, setRules] = useState<Requirement[]>([]),
    [page, setPage] = useState("Dashboard"),
    [selected, setSelected] = useState<string | null>(null),
    [tab, setTab] = useState("Overview"),
    [creating, setCreating] = useState(false),
    [editing, setEditing] = useState<Project | null>(null),
    [replaceId, setReplaceId] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [unsaved, setUnsaved] = useState<Project | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [preview, setPreview] = useState<{
      url: string;
      type: string;
      name: string;
    } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const form = useForm<Intake>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: "",
      address: "",
      city: "",
      state: "CA",
      zip: "",
      propertyType: "Single-family",
      categories: [],
      description: "",
      details: "",
    },
  });
  const selectedCategories = useWatch({
    control: form.control,
    name: "categories",
  });
  async function load() {
    const db = browserDb();
    const {
      data: { user: u },
    } = await db.auth.getUser();
    if (u) {
      setUser(u.email || "Contractor");
      const { data: members, error: e } = await db
        .from("memberships")
        .select("organization_id")
        .eq("user_id", u.id)
        .limit(1);
      if (e) throw e;
      let oid = members?.[0]?.organization_id;
      if (!oid) {
        const { data, error } = await db.rpc("create_organization", {
          org_name: "My organization",
        });
        if (error) throw error;
        oid = data;
      }
      setOrg(oid);
      const organization = await db
        .from("organizations")
        .select("name")
        .eq("id", oid)
        .single();
      if (organization.data) setOrgName(organization.data.name);
      setRules(await loadRules(db));
      const { data, error } = await db
        .from("projects")
        .select("*")
        .eq("organization_id", oid)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setProjects(
        (data || []).map((p) => ({
          ...p.data,
          id: p.id,
          organization_id: p.organization_id,
          created_at: p.created_at,
        })),
      );
    }
    setReady(true);
  }
  useEffect(() => {
    if (configured)
      Promise.resolve()
        .then(load)
        .catch((e) => {
          setError(e.message);
          setReady(true);
        });
  }, []);
  useEffect(() => {
    if (demo)
      localStorage.setItem("permitpilot-demo", JSON.stringify(projects));
  }, [demo, projects]);
  function demoStart() {
    try {
      setProjects(JSON.parse(localStorage.getItem("permitpilot-demo") || "[]"));
    } catch {
      setProjects([]);
    }
    setDemo(true);
    setUser("Demo workspace");
  }
  const p = projects.find((x) => x.id === selected);
  async function persist(next: Project, optimistic = false) {
    const apply = () =>
      setProjects((xs) =>
        xs.some((x) => x.id === next.id)
          ? xs.map((x) => (x.id === next.id ? next : x))
          : [next, ...xs],
      );
    if (optimistic) apply();
    if (!demo) {
      const pending = saveQueue.current
        .catch(() => {})
        .then(async () => {
          const response = await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project: next, organizationId: org }),
          });
          if (!response.ok) throw new Error((await response.json()).error);
        });
      saveQueue.current = pending;
      await pending;
    }
    if (!optimistic) apply();
  }
  async function update(next: Project) {
    setError("");
    try {
      await persist(next, true);
      setUnsaved(null);
    } catch (e) {
      setUnsaved(next);
      setError(
        (e as Error).message +
          " These changes are not saved to the server. Retry before leaving.",
      );
    }
  }
  function beginCreate() {
    setEditing(null);
    form.reset();
    setSelected(null);
    setCreating(true);
  }
  async function create(v: Intake) {
    setBusy(true);
    try {
      const n: Project = editing
        ? {
            ...editing,
            ...v,
            confirmed:
              editing.address === v.address &&
              editing.city === v.city &&
              editing.state === v.state &&
              editing.zip === v.zip
                ? editing.confirmed
                : false,
          }
        : {
            ...v,
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            jurisdiction: "",
            confirmed: false,
            documents: [],
            checklist: [],
          };
      await persist(n);
      setSelected(n.id);
      setCreating(false);
      setEditing(null);
      setTab("Overview");
      form.reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (!p) return;
    setBusy(true);
    setError("");
    setProgress(5);
    try {
      validateFile(file);
      const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      if (
        (file.type === "application/pdf" &&
          String.fromCharCode(...signature.slice(0, 5)) !== "%PDF-") ||
        (file.type === "image/png" &&
          signature.slice(0, 4).join(",") !== "137,80,78,71") ||
        (file.type === "image/jpeg" &&
          signature.slice(0, 3).join(",") !== "255,216,255")
      )
        throw new Error("File contents do not match its declared type.");
      if (demo)
        throw new Error(
          "Private uploads require a connected Supabase account. Demo mode never stores your documents.",
        );
      const id = crypto.randomUUID(),
        path = `${org}/${p.id}/${id}`;
      const db = browserDb();
      const { data, error } = await db.storage
        .from("project-documents")
        .createSignedUploadUrl(path);
      if (error) throw error;
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", data.signedUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            setProgress(Math.round((e.loaded / e.total) * 90));
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error("Upload failed"));
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(file);
      });
      const doc: Doc = {
        id,
        name: file.name,
        type: file.type,
        size: file.size,
        category: "Supporting documentation",
        path,
      };
      const result = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          organizationId: org,
          projectId: p.id,
          name: file.name,
          type: file.type,
          size: file.size,
        }),
      });
      if (!result.ok) {
        await db.storage.from("project-documents").remove([path]);
        throw new Error((await result.json()).error);
      }
      await persist({
        ...p,
        documents: [...p.documents.filter((d) => d.id !== replaceId), doc],
      });
      if (replaceId) {
        const old = p.documents.find((d) => d.id === replaceId);
        if (old?.path)
          await db.storage.from("project-documents").remove([old.path]);
        await db.from("documents").delete().eq("id", replaceId);
      }
      setReplaceId(null);
      setProgress(100);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function removeDoc(doc: Doc) {
    try {
      const db = browserDb();
      if (doc.path) {
        const { error } = await db.storage
          .from("project-documents")
          .remove([doc.path]);
        if (error) throw error;
      }
      const { error } = await db.from("documents").delete().eq("id", doc.id);
      if (error) throw error;
      await update({
        ...p!,
        documents: p!.documents.filter((d) => d.id !== doc.id),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function view(doc: Doc) {
    try {
      const { data, error } = await browserDb()
        .storage.from("project-documents")
        .createSignedUrl(doc.path!, 60);
      if (error) throw error;
      setPreview({ url: data.signedUrl, type: doc.type, name: doc.name });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function analyze(doc: Doc) {
    setBusy(true);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: doc.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await update({
        ...p!,
        documents: p!.documents.map((d) =>
          d.id === doc.id
            ? {
                ...d,
                facts: result.facts.map((f: object) => ({
                  ...f,
                  confirmed: false,
                })),
              }
            : d,
        ),
      });
      setTab("AI Review");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function report() {
    if (!p) return;
    setBusy(true);
    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          demo ? { demo: true, project: p } : { projectId: p.id },
        ),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error);
      }
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "PermitPilot-readiness.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!ready)
    return (
      <div className="loading">
        <Loader2 className="spin" /> Preparing your workspace…
      </div>
    );
  if (!user)
    return (
      <AuthScreen
        onAuthenticated={load}
        demoStart={demoStart}
        initialError={error}
      />
    );

  return (
    <div className="app">
      <aside>
        <Logo />
        <a className="plan-workspace-link" href="/review">
          <Layers size={16} />
          Open plan review <ArrowUpRight size={13} />
        </a>
        <div className="org">
          <span className="avatar">{demo ? "D" : "M"}</span>
          <div>
            {demo ? "Demo workspace" : orgName}
            <small>Residential construction</small>
          </div>
          <ChevronRight size={14} />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {[
            { name: "Dashboard", icon: LayoutDashboard },
            { name: "Projects", icon: FolderOpen },
            { name: "Jurisdictions", icon: Landmark },
          ].map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={page === name && !p ? "active" : ""}
              onClick={() => {
                setPage(name);
                setSelected(null);
                setCreating(false);
              }}
            >
              <Icon size={18} />
              {name}
              {name === "Projects" && (
                <span className="count">{projects.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help">
            <Compass size={20} />
            <strong>A clearer path to permitting</strong>
            <p>Prepare confidently. Verify with your building department.</p>
          </div>
          <button
            onClick={() => {
              setPage("Settings");
              setSelected(null);
            }}
          >
            <Settings size={17} /> Settings
          </button>
          <button
            onClick={async () => {
              if (!demo) await browserDb().auth.signOut();
              setUser("");
              setDemo(false);
              setProjects([]);
              setSelected(null);
            }}
          >
            <LogOut size={17} /> Sign out
          </button>
          <div className="profile">
            <span className="avatar">{user[0].toUpperCase()}</span>
            <div>
              {demo ? "Demo contractor" : user}
              <small>
                {demo ? "Local browser storage" : "Organization member"}
              </small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main">
        <header>
          <div>
            <PanelLeftClose size={17} />
            <span className="divider" />
            Workspace <ChevronRight size={13} />{" "}
            <strong>{p ? p.name : creating ? "New project" : page}</strong>
          </div>
          <span className="header-note">
            <span className="green-dot" />
            {demo ? "LOCAL DEMO · NO CLOUD SYNC" : "PRIVATE WORKSPACE"}
          </span>
        </header>
        <main>
          {error && (
            <div className="error" role="alert">
              <AlertCircle size={17} />
              {error}
              {unsaved && (
                <button onClick={() => update(unsaved)}>Retry save</button>
              )}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {creating ? (
            <>
              <button
                className="back"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                  form.reset();
                }}
              >
                <ArrowLeft size={15} />
                Back to projects
              </button>
              <div className="page-title">
                <div>
                  <span className="eyebrow">LET’S GET THE DETAILS RIGHT</span>
                  <h1>{editing ? "Edit project" : "Create a project"}</h1>
                  <p>
                    Tell us what you’re building. We’ll help organize what comes
                    next.
                  </p>
                </div>
                <span className="step">01 / PROJECT INTAKE</span>
              </div>
              <form
                className="intake"
                onSubmit={(event) => void form.handleSubmit(create)(event)}
              >
                <section>
                  <div className="section-number">01</div>
                  <div>
                    <h3>Project & property</h3>
                    <p>A little context goes a long way.</p>
                    <div className="form-grid">
                      {(
                        ["name", "address", "city", "state", "zip"] as const
                      ).map((k) => (
                        <label
                          key={k}
                          className={
                            k === "address" || k === "name" ? "wide" : ""
                          }
                        >
                          {
                            {
                              name: "Project name",
                              address: "Street address",
                              city: "Mailing city",
                              state: "State",
                              zip: "ZIP code",
                            }[k]
                          }
                          <input
                            {...form.register(k)}
                            placeholder={
                              k === "name"
                                ? "e.g. Oak Street addition"
                                : k === "address"
                                  ? "Street number and name"
                                  : ""
                            }
                          />
                          <small className="field-error">
                            {form.formState.errors[k]?.message}
                          </small>
                        </label>
                      ))}
                      <label>
                        Property type
                        <select {...form.register("propertyType")}>
                          {[
                            "Single-family",
                            "Duplex",
                            "Townhouse",
                            "Other residential",
                          ].map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                </section>
                <section>
                  <div className="section-number">02</div>
                  <div>
                    <h3>Scope of work</h3>
                    <p>
                      Select all that apply. Official coverage varies by
                      jurisdiction and category.
                    </p>
                    <div className="category-grid">
                      {categories.map((c) => (
                        <label key={c} className="category">
                          <input
                            type="checkbox"
                            value={c}
                            {...form.register("categories")}
                          />
                          {c}
                        </label>
                      ))}
                    </div>
                    <small className="field-error">
                      {form.formState.errors.categories?.message}
                    </small>
                    <label>
                      Describe the proposed work
                      <textarea
                        {...form.register("description")}
                        placeholder="What is changing? Include existing conditions and the planned work."
                        rows={4}
                      />
                      <small className="field-error">
                        {form.formState.errors.description?.message}
                      </small>
                    </label>
                    <label>
                      Project-specific details{" "}
                      <span className="muted">(optional)</span>
                      <textarea
                        {...form.register("details")}
                        placeholder={
                          selectedCategories.includes("HVAC / mechanical")
                            ? "Equipment type, fuel, location, replacement or new installation"
                            : selectedCategories.includes(
                                  "Residential addition",
                                )
                              ? "Existing and proposed floor area, stories, structural changes"
                              : "Floor area, equipment, structural changes, or other known details"
                        }
                        rows={2}
                      />
                    </label>
                  </div>
                </section>
                <div className="form-footer">
                  <span>
                    <ShieldCheck size={16} /> Private to your organization
                  </span>
                  <Button disabled={busy}>
                    {editing ? "Save changes" : "Create project"}{" "}
                    <ArrowUpRight size={16} />
                  </Button>
                </div>
              </form>
            </>
          ) : p ? (
            <>
              <button className="back" onClick={() => setSelected(null)}>
                <ArrowLeft size={15} />
                All projects
              </button>
              <div className="page-title">
                <div>
                  <div className="eyebrow">
                    RESIDENTIAL PROJECT <span className="dot-sep">/</span>{" "}
                    {p.id.slice(0, 8).toUpperCase()}
                  </div>
                  <h1>{p.name}</h1>
                  <p>
                    {p.address}, {p.city}, {p.state} {p.zip}
                  </p>
                </div>
                <Button variant="outline" disabled={busy} onClick={report}>
                  <Download size={16} /> Export report
                </Button>
              </div>
              <div className="tabs">
                {tabs.map((t) => (
                  <button
                    key={t}
                    className={tab === t ? "selected" : ""}
                    onClick={() => setTab(t)}
                  >
                    {t}
                    {t === "Documents" && <span>{p.documents.length}</span>}
                  </button>
                ))}
              </div>
              {tab === "Overview" && (
                <div className="workspace-grid">
                  <div>
                    <div className="section-heading">
                      <h2>Your path to submission</h2>
                      <span className="badge">In preparation</span>
                    </div>
                    <div className="path-list">
                      {[
                        {
                          title: "Define your project",
                          text: "Property and scope captured",
                          done: true,
                          target: "Overview",
                        },
                        {
                          title: "Confirm your jurisdiction",
                          text: p.confirmed
                            ? "Manually confirmed · verify parcel boundaries"
                            : "Check which authority serves this property",
                          done: p.confirmed,
                          target: "Overview",
                        },
                        {
                          title: "Gather application documents",
                          text: `${p.documents.length} documents organized`,
                          done: p.documents.length > 0,
                          target: "Documents",
                        },
                        {
                          title: "Review submission readiness",
                          text: "Resolve gaps before contacting the building department",
                          done: false,
                          target: "Readiness Report",
                        },
                      ].map((s, i) => (
                        <button key={s.title} onClick={() => setTab(s.target)}>
                          <span
                            className={
                              s.done ? "path-icon complete" : "path-icon"
                            }
                          >
                            {s.done ? <Check size={17} /> : i + 1}
                          </span>
                          <div>
                            <strong>{s.title}</strong>
                            <p>{s.text}</p>
                          </div>
                          <ChevronRight size={16} />
                        </button>
                      ))}
                    </div>
                    <div className="panel scope">
                      <div className="section-heading">
                        <h3>Project scope</h3>
                        <button
                          className="text-button compact"
                          onClick={() => {
                            setEditing(p);
                            form.reset(p);
                            setCreating(true);
                          }}
                        >
                          Edit project
                        </button>
                      </div>
                      <p>{p.description}</p>
                      <div className="chips">
                        {p.categories.map((c) => (
                          <span key={c}>{c}</span>
                        ))}
                      </div>
                      {p.details && <p>{p.details}</p>}
                      <button
                        className="delete-project"
                        onClick={async () => {
                          if (
                            !window.confirm(
                              "Delete this project and its documents? This cannot be undone.",
                            )
                          )
                            return;
                          try {
                            if (!demo) {
                              const r = await fetch("/api/projects", {
                                method: "DELETE",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ id: p.id }),
                              });
                              if (!r.ok)
                                throw new Error("Project could not be deleted");
                            }
                            setProjects((xs) =>
                              xs.filter((x) => x.id !== p.id),
                            );
                            setSelected(null);
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Delete project
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="panel jurisdiction">
                      <div className="panel-icon">
                        <Landmark size={21} />
                      </div>
                      <h3>Permitting authority</h3>
                      <p>
                        A mailing address is a starting point, not jurisdiction
                        verification.
                      </p>
                      <label>
                        Building jurisdiction
                        <select
                          value={p.jurisdiction}
                          onChange={(e) =>
                            update({
                              ...p,
                              jurisdiction: e.target.value,
                              confirmed: false,
                            })
                          }
                        >
                          <option value="">Select an authority</option>
                          {jurisdictions.map((j) => (
                            <option key={j.id} value={j.id}>
                              {j.name}
                            </option>
                          ))}
                          <option value="other">Other / not yet known</option>
                        </select>
                      </label>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          disabled={
                            !p.jurisdiction || p.jurisdiction === "other"
                          }
                          checked={p.confirmed}
                          onChange={(e) =>
                            update({ ...p, confirmed: e.target.checked })
                          }
                        />
                        I checked the property’s permitting authority with an
                        official parcel or department resource.
                      </label>
                      <span
                        className={
                          p.confirmed ? "badge success" : "badge warning"
                        }
                      >
                        {p.confirmed
                          ? "Manually confirmed"
                          : "Confirmation needed"}
                      </span>
                      {jurisdictions.find((j) => j.id === p.jurisdiction) && (
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href={
                            jurisdictions.find((j) => j.id === p.jurisdiction)!
                              .url
                          }
                        >
                          Official department <ArrowUpRight size={14} />
                        </a>
                      )}
                    </div>
                    <div className="quiet-note">
                      <ShieldCheck size={18} />
                      <p>
                        Preparation, with perspective.
                        <br />
                        <span>
                          PermitPilot assesses completeness. Technical
                          compliance and approval remain with professionals and
                          your authority.
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {tab === "Requirements" && (
                <RequirementsPanel p={p} rules={rules} update={update} />
              )}
              {tab === "Documents" && (
                <>
                  <div className="section-heading">
                    <div>
                      <h2>Project documents</h2>
                      <p>
                        One place for the details that move your application
                        forward.
                      </p>
                    </div>
                    <span className="badge">
                      <ShieldCheck size={12} /> Private storage
                    </span>
                  </div>
                  <input
                    hidden
                    ref={input}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    onChange={(e) => {
                      if (e.target.files?.[0]) upload(e.target.files[0]);
                    }}
                  />
                  <button
                    className="upload"
                    disabled={busy}
                    onClick={() => {
                      setReplaceId(null);
                      input.current?.click();
                    }}
                  >
                    <span className="upload-icon">
                      <Upload size={22} />
                    </span>
                    <strong>
                      {busy
                        ? `Uploading · ${progress}%`
                        : "Choose a document to upload"}
                    </strong>
                    <span>PDF, JPG, or PNG · up to 20 MB per file</span>
                    <small>
                      {demo
                        ? "Connect Supabase to securely store real documents"
                        : "Files are accessible only to your organization"}
                    </small>
                  </button>
                  {p.documents.length === 0 ? (
                    <Empty
                      icon={<FolderOpen />}
                      title="A clean slate for your plans"
                      text="Upload drawings, applications, or supporting documents to start organizing your submission."
                    />
                  ) : (
                    p.documents.map((d) => (
                      <div className="document-row" key={d.id}>
                        <span className="file-icon">
                          <FileText size={22} />
                        </span>
                        <div>
                          <button
                            className="document-name"
                            onClick={() => view(d)}
                          >
                            {d.name}
                          </button>
                          <small>{(d.size / 1024 / 1024).toFixed(2)} MB</small>
                        </div>
                        <select
                          aria-label="Document category"
                          value={d.category}
                          onChange={(e) =>
                            update({
                              ...p,
                              documents: p.documents.map((x) =>
                                x.id === d.id
                                  ? { ...x, category: e.target.value }
                                  : x,
                              ),
                            })
                          }
                        >
                          {[
                            "Architectural plans",
                            "Site plans",
                            "Floor plans",
                            "Permit application",
                            "Product specifications",
                            "Supporting documentation",
                            "Other",
                          ].map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => analyze(d)}
                        >
                          <Sparkles size={14} />
                          Extract
                        </Button>
                        <button
                          className="text-button compact"
                          disabled={busy}
                          onClick={() => {
                            setReplaceId(d.id);
                            input.current?.click();
                          }}
                        >
                          Replace
                        </button>
                        <button
                          aria-label="Delete document"
                          onClick={() => removeDoc(d)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))
                  )}
                </>
              )}
              {tab === "AI Review" && <AIReview p={p} update={update} />}
              {tab === "Readiness Report" && (
                <ReadinessReport
                  p={p}
                  rules={rules}
                  busy={busy}
                  report={report}
                />
              )}
            </>
          ) : page === "Jurisdictions" ? (
            <>
              <div className="page-title">
                <div>
                  <span className="eyebrow">
                    LOCAL KNOWLEDGE, CLEAR BOUNDARIES
                  </span>
                  <h1>Jurisdictions</h1>
                  <p>
                    The right authority is the foundation of the right
                    application.
                  </p>
                </div>
              </div>
              <div className="notice">
                Jurisdiction must be manually confirmed using parcel or
                department information. Mailing city and ZIP are insufficient.
              </div>
              {jurisdictions.map((j) => (
                <div className="jurisdiction-card panel" key={j.id}>
                  <Landmark size={27} />
                  <div>
                    <h2>{j.name}</h2>
                    <p>{j.department}</p>
                    <span className="badge warning">
                      Requirements coverage pending verification
                    </span>
                    <p className="muted">
                      Last source verification: not established · Directory
                      links are not verified requirements.
                    </p>
                    <a href={j.url} target="_blank" rel="noreferrer">
                      Building department <ArrowUpRight size={14} />
                    </a>
                    <a href={j.portal} target="_blank" rel="noreferrer">
                      Permitting portal <ArrowUpRight size={14} />
                    </a>
                  </div>
                </div>
              ))}
            </>
          ) : page === "Settings" ? (
            <>
              <div className="page-title">
                <div>
                  <h1>Workspace settings</h1>
                  <p>Your organization and connected services.</p>
                </div>
              </div>
              <div className="panel settings">
                <h3>Profile</h3>
                <p>{user}</p>
                <hr />
                <h3>Organization</h3>
                <form
                  className="inline-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (demo) {
                      setError(
                        "Organization settings require a connected account.",
                      );
                      return;
                    }
                    try {
                      const r = await fetch("/api/settings", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          organizationId: org,
                          name: orgName,
                        }),
                      });
                      if (!r.ok) throw new Error((await r.json()).error);
                      setError("Organization name saved.");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <input
                    aria-label="Organization name"
                    value={demo ? "Local demo workspace" : orgName}
                    disabled={demo}
                    onChange={(e) => setOrgName(e.target.value)}
                    maxLength={120}
                  />
                  <Button disabled={demo}>Save name</Button>
                </form>
                <p className="muted">
                  Organization membership is enforced by database row-level
                  security.
                </p>
                <hr />
                <h3>Integrations</h3>
                <div className="setting-row">
                  <span>Supabase · authentication, database & storage</span>
                  <span className="badge">
                    {configured ? "Configured" : "Not configured"}
                  </span>
                </div>
                <p>
                  OpenAI availability is checked server-side when extraction is
                  requested. Keys are never sent to the browser.
                </p>
                <hr />
                <h3>Data & privacy</h3>
                <p>
                  {demo
                    ? "Demo projects are saved only in this browser. Real document uploads are disabled."
                    : "Project data and documents are private to organization members."}
                </p>
                <p className="muted">
                  Do not upload sensitive client documents until your
                  organization has reviewed service-provider privacy and
                  retention policies.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="page-title">
                <div>
                  <span className="eyebrow">YOUR PERMITTING WORKSPACE</span>
                  <h1>
                    {page === "Projects"
                      ? "Projects"
                      : "Good work starts with a clear plan."}
                  </h1>
                  <p>
                    {page === "Projects"
                      ? "Every project, organized from the first detail to the final checklist."
                      : "Keep your projects moving. Know what’s ready and what needs attention."}
                  </p>
                </div>
                <Button
                  onClick={() => {
                    beginCreate();
                  }}
                >
                  <Plus size={17} />
                  Create project
                </Button>
              </div>
              {page === "Dashboard" && (
                <div className="metrics">
                  <div>
                    <span>
                      Active projects <FolderOpen size={16} />
                    </span>
                    <strong>
                      {projects.length.toString().padStart(2, "0")}
                    </strong>
                    <small>Your residential pipeline</small>
                  </div>
                  <div>
                    <span>
                      Need jurisdiction confirmation <Landmark size={16} />
                    </span>
                    <strong>
                      {projects
                        .filter((p) => !p.confirmed)
                        .length.toString()
                        .padStart(2, "0")}
                    </strong>
                    <small>Start with the right authority</small>
                  </div>
                  <div>
                    <span>
                      Documents organized <FileText size={16} />
                    </span>
                    <strong>
                      {projects
                        .reduce((n, p) => n + p.documents.length, 0)
                        .toString()
                        .padStart(2, "0")}
                    </strong>
                    <small>Securely linked to your projects</small>
                  </div>
                </div>
              )}
              <div className="section-heading project-heading">
                <div>
                  <h2>
                    {page === "Dashboard"
                      ? "Your projects"
                      : "Project directory"}
                  </h2>
                  <p>A little preparation now. Fewer surprises later.</p>
                </div>
                <div className="search">
                  <Search size={16} />
                  <input
                    aria-label="Search projects"
                    placeholder="Search projects…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <kbd>⌕</kbd>
                </div>
              </div>
              <div className="project-table">
                <div className="table-head">
                  <span>PROJECT</span>
                  <span>JURISDICTION</span>
                  <span>STATUS</span>
                  <span>UPDATED</span>
                  <span />
                </div>
                {projects
                  .filter((x) =>
                    `${x.name} ${x.address}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((x) => (
                    <button
                      className="project-row"
                      key={x.id}
                      onClick={() => {
                        setSelected(x.id);
                        setTab("Overview");
                      }}
                    >
                      <div>
                        <span className="project-icon">
                          <FolderOpen size={19} />
                        </span>
                        <div>
                          <strong>{x.name}</strong>
                          <small>
                            {x.address} · {x.city}
                          </small>
                        </div>
                      </div>
                      <span>
                        {jurisdictions.find((j) => j.id === x.jurisdiction)
                          ?.name || "Not confirmed"}
                      </span>
                      <span>
                        <i className="status-dot" />
                        In preparation
                      </span>
                      <span>
                        {new Date(x.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                {projects.length === 0 && (
                  <Empty
                    icon={<FolderOpen />}
                    title="Make room for your next project"
                    text="Start with an address and a scope of work. Build your checklist, organize documents, and see your next steps."
                  >
                    <Button onClick={beginCreate}>
                      <Plus size={16} />
                      Create your first project
                    </Button>
                  </Empty>
                )}
                {projects.length > 0 &&
                  !projects.some((x) =>
                    `${x.name} ${x.address}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  ) && (
                    <Empty
                      icon={<Search />}
                      title="No matching projects"
                      text="Try another project name or address."
                    />
                  )}
              </div>
              <div className="bottom-note">
                <ShieldCheck size={17} />
                <span>
                  Built for preparation. Grounded in verified sources.
                </span>
                <span>
                  Official requirements are shown only where verified coverage
                  exists.
                </span>
              </div>
            </>
          )}
        </main>
        <footer>
          <span>PermitPilot</span>
          <span>A clearer path to your next build.</span>
          <span>Preparation ≠ approval</span>
        </footer>
      </div>
      {preview && (
        <div className="modal">
          <div>
            <div className="section-heading">
              <h3>{preview.name}</h3>
              <button
                aria-label="Close preview"
                onClick={() => setPreview(null)}
              >
                <X />
              </button>
            </div>
            {preview.type === "application/pdf" ? (
              <iframe
                sandbox="allow-same-origin"
                title="Document preview"
                src={preview.url}
              />
            ) : (
              <Image
                unoptimized
                width={1200}
                height={1600}
                alt={preview.name}
                src={preview.url}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
