"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  AlertCircle,
  FileText,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "./ui/button";
import { Empty } from "./shared";
import {
  type Project,
  type Requirement,
  applicable,
  statuses,
} from "@/lib/domain";
export function RequirementsPanel({
  p,
  rules,
  update,
}: {
  p: Project;
  rules: Requirement[];
  update: (p: Project) => Promise<void>;
}) {
  const [manual, setManual] = useState("");
  return (
    <>
      <div className="notice">
        <AlertCircle size={18} />
        <div>
          <strong>
            {applicable(p, rules).length
              ? "Verified requirements · partial coverage"
              : "Official requirements are not yet verified for this project"}
          </strong>
          <p>
            Use a manual preparation checklist while source-backed coverage is
            developed. No item below is presented as an official government
            requirement.
          </p>
        </div>
      </div>
      {applicable(p, rules).map((r) => (
        <div className="panel" key={r.id}>
          <span className="badge success">Verified source · v{r.version}</span>
          <h3>{r.title}</h3>
          <p>{r.description}</p>
          <p>Supporting document: {r.documentCategory}</p>
          <p className="muted">
            Verified {r.verifiedAt} · Effective{" "}
            {r.effectiveDate || "date not specified"} · {r.limitations}
          </p>
          <a href={r.sourceUrl} target="_blank" rel="noreferrer">
            Official source <ArrowUpRight size={14} />
          </a>
        </div>
      ))}
      <div className="section-heading">
        <h2>Preparation checklist</h2>
        <span className="muted">{p.checklist.length} manual items</span>
      </div>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) {
            update({
              ...p,
              checklist: [
                ...p.checklist,
                {
                  id: crypto.randomUUID(),
                  title: manual.trim(),
                  status: "Missing",
                  note: "",
                },
              ],
            });
            setManual("");
          }
        }}
      >
        <input
          aria-label="Checklist item"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Add an item confirmed with your building department…"
          maxLength={300}
        />
        <Button>
          <Plus size={16} />
          Add item
        </Button>
      </form>
      {p.checklist.length === 0 ? (
        <Empty
          icon={<FileText />}
          title="Build your preparation checklist"
          text="Add tasks from your department’s official application instructions. Keep their context in the notes."
        />
      ) : (
        p.checklist.map((i) => (
          <div className="checklist-row" key={i.id}>
            <FileText size={18} />
            <div>
              <strong>{i.title}</strong>
              <input
                aria-label={`Notes for ${i.title}`}
                placeholder="Source URL, context, or supporting evidence"
                defaultValue={i.note}
                onBlur={(e) =>
                  update({
                    ...p,
                    checklist: p.checklist.map((x) =>
                      x.id === i.id ? { ...x, note: e.target.value } : x,
                    ),
                  })
                }
              />
            </div>
            <select
              aria-label={`Status for ${i.title}`}
              value={i.status}
              onChange={(e) =>
                update({
                  ...p,
                  checklist: p.checklist.map((x) =>
                    x.id === i.id
                      ? {
                          ...x,
                          status: e.target.value as typeof i.status,
                        }
                      : x,
                  ),
                })
              }
            >
              {statuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <button
              aria-label="Delete checklist item"
              onClick={() =>
                update({
                  ...p,
                  checklist: p.checklist.filter((x) => x.id !== i.id),
                })
              }
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))
      )}
    </>
  );
}
