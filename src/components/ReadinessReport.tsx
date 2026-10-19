"use client";

import {
  ArrowUpRight,
  Download,
  AlertCircle,
  ShieldCheck,
  Check,
} from "lucide-react";
import { Button } from "./ui/button";

import {
  type Project,
  type Requirement,
  applicable,
  findings,
  jurisdictions,
} from "@/lib/domain";
export function ReadinessReport({
  p,
  rules,
  busy,
  report,
}: {
  p: Project;
  rules: Requirement[];
  busy: boolean;
  report: () => Promise<void>;
}) {
  return (
    <>
      <div className="report-hero">
        <span className="eyebrow">SUBMISSION READINESS</span>
        <h2>A clear view of what’s next.</h2>
        <p>Your project needs further verification before submission.</p>
        <div className="report-stats">
          <div>
            <strong>
              {findings(p, rules).filter((f) => f.status === "Complete").length}
            </strong>
            <span>Complete</span>
          </div>
          <div>
            <strong>
              {
                findings(p, rules).filter(
                  (f) => !["Complete", "Not applicable"].includes(f.status),
                ).length
              }
            </strong>
            <span>Need attention</span>
          </div>
          <div>
            <strong>{applicable(p, rules).length}</strong>
            <span>Verified official rules</span>
          </div>
        </div>
      </div>
      <div className="section-heading">
        <h2>Findings & next steps</h2>
        <Button variant="outline" onClick={report} disabled={busy}>
          <Download size={15} />
          Download PDF
        </Button>
      </div>
      {findings(p, rules).map((f) => (
        <div className="finding" key={f.id}>
          <span
            className={
              f.status === "Complete" ? "finding-icon good" : "finding-icon"
            }
          >
            {f.status === "Complete" ? (
              <Check size={17} />
            ) : (
              <AlertCircle size={17} />
            )}
          </span>
          <div>
            <div className="section-heading">
              <h3>{f.title}</h3>
              <span
                className={
                  f.status === "Complete" ? "badge success" : "badge warning"
                }
              >
                {f.status}
              </span>
            </div>
            <p>{f.reason}</p>
            <div className="next-action">
              <ArrowUpRight size={14} />
              {f.action}
            </div>
            {"sourceUrl" in f && typeof f.sourceUrl === "string" && (
              <a href={f.sourceUrl} target="_blank" rel="noreferrer">
                Official requirement source <ArrowUpRight size={13} />
              </a>
            )}
            {f.id === "coverage" &&
              jurisdictions.find((j) => j.id === p.jurisdiction) && (
                <a
                  href={jurisdictions.find((j) => j.id === p.jurisdiction)!.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Consult official department <ArrowUpRight size={13} />
                </a>
              )}
          </div>
        </div>
      ))}
      <div className="quiet-note">
        <ShieldCheck size={20} />
        <p>
          Completeness is not compliance.
          <br />
          <span>
            This report covers administrative preparation and document
            completeness. It does not certify technical code compliance or
            guarantee government permit approval.
          </span>
        </p>
      </div>
    </>
  );
}
