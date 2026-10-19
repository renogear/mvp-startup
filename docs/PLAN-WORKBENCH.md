# Residential floor-plan workbench

The current application starts at `/review`; the earlier authenticated permitting workspace remains at `/projects`.

The **tested vertical slice** is a local development workbench using the actual user-supplied San Diego County Plan F PDF. It is separate from hosted Supabase authentication. It accepts genuine PDFs/images, stores private original bytes unchanged, queues durable extraction jobs, renders actual sheets with PDF.js, locates evidence, retains human corrections, and exports structured JSON and a preliminary PDF with the actual marked-up source page.

## Start locally

Use Node 24 and npm 11. PyMuPDF 1.26.6 is required; optional Tesseract enables fallback OCR.

```sh
npm ci
python -m venv .venv
.venv/bin/python -m pip install -r processor/requirements.txt
```

In `.env.local`, add non-secret development settings:

```dotenv
PERMITPILOT_LOCAL_REVIEW=1
PERMITPILOT_PYTHON=/absolute/path/to/mvp-startup/.venv/bin/python
```

Run two processes from the checkout:

```sh
npm run dev -- --hostname 127.0.0.1
npm run plan:worker
```

Open the plan-review route in your local browser. Click **Open local workbench**, name the review, choose its declared jurisdiction/classification, and upload the original document. Blank address/application date is appropriate for an unassigned reference template; never substitute its printed revision date. Choose the floor-plan page, click **Extract this page**, then review candidates against the source. For the supplied PlanF set, A1 is PDF page 5. The viewer retains native page rotation; no coordinates are reconstructed from a screenshot.

The local API requires explicit opt-in, a development runtime, a loopback Host, and an opaque HttpOnly SameSiteStrict owner session. It is **not cloud account authentication** and must not be exposed as a public service. Use a loopback network binding; Host checks alone are not a network access-control boundary. Production mode disables these routes. Protect/back up the data directory and review retention policy before storing sensitive client plans.

## Retained state and restart behavior

`.permitpilot/` (or `PERMITPILOT_DATA_DIR`) stores original bytes, a SQLite database with WAL, session-token hashes, durable queued jobs, immutable extraction JSON, append-only human corrections, and audit events. It is ignored by Git and is never served as a public directory. Original and DB files have restrictive permissions. Cookie ownership gates every original/review/job/correction/report request. Another session cannot retrieve a review merely by guessing its UUID.

Keep that directory and the browser cookie to return later. Sessions expire after7 days. This local prototype has no account-based recovery if the cookie is lost; use a disposable workbench for validation. The existing Supabase project workspace has a separate sign-in/persistence model.

Queued jobs survive process restarts. A worker claims one job at a time, caps attempts at 3, bounds extractor duration/output, and recovers expired processing leases. Stale attempts cannot overwrite results or append misleading failure events. Completion binds document ID, source SHA-256, selected page, and element pages to the original. Completed page jobs are deduplicated. This initial pipeline does not reprocess a completed page under a new pipeline version; versioned reprocessing is a follow-up.

## What the review means

- Room boxes locate **room-label text**, not room boundary polygons.
- Dimension boxes locate printed numeric tokens. They do not identify endpoints or establish wall associations automatically.
- Schedule boxes locate table evidence. They do not locate physical doors/windows.
- Scale is extracted as text; it is not proof of physical calibration. No dimensions are inferred from raster pixels or vector geometry.
- Blank dimensions remain unknown. All candidates start unreviewed. Correcting a value/unit or label records a new human decision and retains the original extraction.
- OCR may be uncertain. Unknown geometry, legends, occluded annotations, or missing schedules require human review.
- The baseline pipeline uses embedded text/OCR and deterministic parsing. It does not invoke OpenAI architectural vision. Missing AI keys do not prevent this workflow. The previous document-fact extraction endpoint is distinct; adding a key does not silently enable geometric interpretation.

The report separates extraction, human review, unknown information, and unevaluated code checks. Its final page includes the actual drawing with numbered evidence boxes. Box colors denote review state, **not code compliance**. Export audit records include context, correction IDs, pipeline version, source hash, and generated-report hash.

## Jurisdiction and code gates

The initial future production jurisdiction is incorporated San José. Santa Clara County's unincorporated area and San Diego County are distinct AHJs. A San Diego publisher/title-block match is a veto against applying San José rules, not geographic verification of a property. Source/provenance detection cannot grant code-check eligibility.

`src/lib/compliance.ts` requires authoritative jurisdiction and drawing provenance, the actual application date, construction/classification, reviewed code edition/adoption/local amendments/residential instructions, rule version/effective dates, and confirmed evidence. The production rule registry is empty. The UI cannot mark regulatory context independently verified. **No real technical compliance decisions are active**, including for this San Diego baseline. Synthetic rule thresholds exist only in unit tests.

## Cloud deployment boundary

Migration002 implements organization-isolated cloud review, page, job, element, correction, report-snapshot, source/edition/rule/evaluation tables, plus fenced worker RPCs. PostgreSQL tests pass for these policies. The local workbench HTTP routes and worker currently use SQLite; the **hosted plan-workbench adapter is not wired**. Live Supabase Auth/Storage validation and cloud job/worker integration require a separately configured Supabase project and implementation/validation before customer deployment. Do not deploy SQLite-backed routes on Vercel ephemeral storage.

The existing `/projects` Supabase application remains deployable with its documented credentials; floor-plan review is currently the local development slice. Durable hosted background processing must run independently from Vercel HTTP functions. See PLAN-DATA.md for the planned database/RPC contract.

PyMuPDF is AGPL/commercially licensed. Review the applicable distribution obligations or obtain an appropriate commercial license before closed-source commercial deployment. See PROCESSOR.md. No professional security or regulatory audit has been claimed.
