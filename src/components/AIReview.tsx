"use client";

import { Sparkles } from "lucide-react";

import { Empty } from "./shared";
import { type Project } from "@/lib/domain";
export function AIReview({
  p,
  update,
}: {
  p: Project;
  update: (p: Project) => Promise<void>;
}) {
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Review the details</h2>
          <p>AI-extracted information stays unconfirmed until you review it.</p>
        </div>
        <span className="badge">
          <Sparkles size={12} /> Assisted extraction
        </span>
      </div>
      <div className="notice">
        Extraction requires the server-side OpenAI key and a signed-in account.
        Documents are sent to OpenAI only when you select Extract. This is not a
        technical plan review.
      </div>
      {!p.documents.some((d) => d.facts) && (
        <Empty
          icon={<Sparkles />}
          title="Your expertise stays in control"
          text="Extract facts from a document, then confirm or correct each value. Unreadable details remain unknown."
        />
      )}
      {p.documents
        .filter((d) => d.facts)
        .map((d) => (
          <div key={d.id} className="panel">
            <h3>{d.name}</h3>
            {d.facts?.map((f, i) => (
              <div className="fact" key={i}>
                <div>
                  <strong>{f.field}</strong>
                  <small>
                    {f.page ? `Page ${f.page}` : "Page unknown"} ·{" "}
                    {f.confidence} confidence
                  </small>
                </div>
                <input
                  aria-label={f.field}
                  defaultValue={f.value || ""}
                  placeholder="Unknown"
                  onBlur={(e) =>
                    update({
                      ...p,
                      documents: p.documents.map((x) =>
                        x.id === d.id
                          ? {
                              ...x,
                              facts: x.facts?.map((v, j) =>
                                i === j
                                  ? {
                                      ...v,
                                      value: e.target.value,
                                      confirmed: false,
                                    }
                                  : v,
                              ),
                            }
                          : x,
                      ),
                    })
                  }
                />
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={f.confirmed}
                    onChange={(e) =>
                      update({
                        ...p,
                        documents: p.documents.map((x) =>
                          x.id === d.id
                            ? {
                                ...x,
                                facts: x.facts?.map((v, j) =>
                                  i === j
                                    ? {
                                        ...v,
                                        confirmed: e.target.checked,
                                      }
                                    : v,
                                ),
                              }
                            : x,
                        ),
                      })
                    }
                  />
                  Reviewed
                </label>
              </div>
            ))}
          </div>
        ))}
    </>
  );
}
