# Regulatory scope and rule activation

PermitPilot's current plan-analysis release extracts and organizes evidence. **No real-world building-code checks are enabled.** The approved executable rule registry in `src/lib/compliance.ts` is deliberately empty. A successful extraction, a confirmed measurement, an administrative checklist, and a permit approval are different outcomes.

## Authorities and initial dataset

The intended first compliance authority is the **incorporated City of San José, California**. Santa Clara County's unincorporated territory is a separate authority. A mailing city, ZIP code, project name, or user selection does not establish a parcel's permitting authority. Manual confirmation can support administrative preparation; technical evaluation additionally requires recorded authoritative jurisdiction evidence.

The initial extraction fixture is the County of San Diego Planning & Development Services **Plan F — 600 SF Detached Dwelling Unit**, [official PDF](https://www.sandiegocounty.gov/content/dam/sdc/pds/bldg/adu_info/pds671_11x17.pdf), targeting Sheet A1 on PDF page 5. This document belongs to the San Diego County dataset. It is suitable for parsing, dimension transcription, evidence overlays, measurement corrections, and viewer tests. It is **not** a San José compliance test. Neither its availability on an official website nor a printed dimension proves compliance with current requirements. Its relevant San Diego requirements have not been reviewed or activated in this product.

San Diego County, Fresno, and other out-of-jurisdiction plans may support general extraction tests. Their governing requirements must be independently verified before any technical checks are enabled. The engine blocks a drawing/project jurisdiction mismatch, including a San Diego drawing relabeled as a San José project.

No lawfully obtained, independently reviewed San José drawing set is currently supplied as a validated compliance dataset. Obtain appropriate use rights and an independent professional review before using such drawings to validate San José checks. Do not fabricate reference plans or treat another jurisdiction's plans as San José ground truth.

## Conditions for activating a San José check

The planned first regulatory scope is the applicable **2025 California Building Standards Code, including the California Residential Code**, together with City of San José adopted amendments, ordinances, and verified residential plan-review instructions. This is a product scope, not an assertion that any particular provision applies to a particular project. Claims or numeric thresholds in a pasted specification, AI response, sample plan, or extracted annotation remain unverified until reviewed against authoritative sources.

Before enabling even one check:

1. Establish the property's actual authority using authoritative parcel, boundary, or department evidence; preserve that evidence and the drawing's separately verified jurisdiction/provenance.
2. Record the actual permit application date, residential classification, and new/existing construction status. Verify which edition, adoption dates, amendments, transition rules, and project-specific exceptions apply. Do not infer the application date from a PDF upload timestamp or use today's date as a substitute.
3. Retrieve authoritative code and City sources. Record exact edition, section, source URL, effective start date, final effective date when applicable, last verification date, named reviewer, and review method. Review adopted local amendments and applicable residential instructions explicitly.
4. Translate a limited provision into an unambiguous deterministic predicate. Record its scope, exceptions, limitations, and required evidence. If a condition cannot be represented by the supported predicate schema, keep the rule inactive and extend/test the engine in a separate reviewed change.
5. Validate the predicate against independently reviewed San José plans, including known compliant and noncompliant examples, exception cases, missing evidence, uncertain dimensions, and effective-date boundaries. Preserve the validation evidence; do not use a fixture's expected value as an extracted result.
6. Have the source/applicability review and executable validation recorded, then publish an explicit rule version to the server-controlled registry. The UI cannot activate rules or turn a user claim into a verified code context.

Missing or inaccessible sources block rule activation. Do not disable source verification, invent citations, or mark a rule verified because it appears plausible. No source URL list is proof by itself; the provenance record must correspond to an actual completed review.

## Executable contract

`evaluateCompliance(context, measurements, rules = approvedBuildingCodeRules)` returns findings, blockers, a regulatory-context snapshot, and the number of eligible rule versions. `regulatoryBlockers(context, rules)` explains why a technical evaluation is unavailable. The default registry has zero rules. Callers should preserve the returned context and per-finding rule/source metadata in exported reports.

The context requires the exact authority, verification state and evidence, actual application date, classification, construction status, and code edition. Technical evaluation also requires a matching document authority/evidence and reviewed code-context provenance. Provenance explicitly records review of the edition, local amendments, residential instructions, and application applicability. An empty edition, impossible calendar date, unsupported authority, unreviewed classification, unknown construction status, unverified provenance, or cross-jurisdiction document remains blocked.

Each executable rule has a stable ID and numerical version, lifecycle state, exact authority and edition, section/source/adoption citations, explicit effective dates, source verification, applicability review, exception review, and validation metadata. Supported exception predicates currently compare only known classification/construction values. Unknown fields and predicates fail schema validation. Duplicate latest versions, broken latest metadata, draft versions, and retired versions cannot cause an older active rule to reappear. Effective date boundaries are inclusive; a version outside its date range does not evaluate. The current registry does not automatically resolve historical supersession; add a reviewed historical-version selection policy before serving that use case.

Numerical checks currently support a single explicitly identified measurement and reviewed minimum/maximum comparison in inches. No scale-based inference, visual distance estimate, fuzzy label match, or AI-produced threshold enters the evaluator. A measurement must have a positive finite value, an explicit human-confirmed/corrected state, a source document ID, a one-based source page, and a normalized bounding box. Multiple matching measurements, missing dimensions, absent source references, rejected measurements, and unreviewed extraction all require clarification. Human confirmation establishes a reviewed transcription, not professional code compliance.

Results are deliberately limited:

| Status | Meaning |
| --- | --- |
| `not_evaluated` | Coverage, jurisdiction, code context, rule version, applicability, or review prerequisites are not established. |
| `needs_clarification` | The specific measurement/evidence is missing, ambiguous, invalid, or unreviewed. |
| `missing_information` | Reserved for a supported future information predicate; it does not imply a code failure. |
| `potential_issue` | A confirmed dimension does not meet one independently reviewed numerical predicate; professional review is required. |
| `passed` | Only that single reviewed predicate is satisfied; this does not establish whole-plan compliance or permit approval. |

Tests in `tests/compliance.test.ts` inject clearly marked synthetic rules with fictional source URLs, editions, and arbitrary thresholds. These fixtures are not imported by application code and make no claim about any jurisdiction's law.

## Validation and remaining work

The automated suite covers the empty production registry, separate City/county authorities, San Diego-to-San José mismatches, jurisdiction evidence, missing regulatory provenance, date/edition/classification applicability, lifecycle/version failures, unknown predicates, incomplete source review, confirmed/corrected measurement evidence, ambiguous/missing dimensions, and report provenance fields.

Before a real compliance pilot, prioritize authoritative San José source review and adoption verification, a lawfully available independently annotated San José validation dataset, a small professionally reviewed rule pack, historical-version policy, and signed reviewer/validation records. Add authority-specific rule modules without sharing unqualified thresholds across jurisdictions. Continue labeling extraction and administrative completeness separately while that work remains incomplete.
