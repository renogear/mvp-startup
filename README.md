# PermitPilot

A residential drawing-review application with an actual PDF viewer, traceable text/dimension extraction, human correction, and an evidence report. The current first milestone is tested on the user-supplied County of San Diego Plan F, sheet A1 (PDF page 5). The first future technical-compliance jurisdiction is **incorporated San José**, distinct from unincorporated Santa Clara County. **No real building-code checks are active.**

## Open in your browser

**[Launch PermitPilot in a private GitHub Codespace](https://codespaces.new/renogear/mvp-startup?ref=app%2Fpermitpilot-interactive)**

Sign into GitHub, confirm branch `app/permitpilot-interactive`, and create the Codespace using your account's Codespaces quota. Setup installs the application and document worker automatically. When ready, open port **3000** in the **Ports** tab, keep visibility **Private**, and select **Open private workbench** in the app. Upload your original drawing to begin. No Supabase or OpenAI credentials are needed for this extraction workflow.

The Codespace stores your private documents and reviews across stop/start. Keep the same browser profile and Codespace; export your work before deleting it. This is a private evaluation workspace. See [browser setup and troubleshooting](docs/CODESPACES.md).

## What works now

- `/review`: a private development workbench, available on your computer or in a private GitHub Codespace. Upload real PDF/PNG/JPG files; view actual pages with PDF.js; zoom/pan; extract selected-sheet text, room labels, printed dimensions, scale and schedule candidates; click source-aligned annotations; confirm/correct/reject evidence; preserve originals and correction history; export structured JSON and a PDF with the actual marked-up drawing.
- Durable local queue: retained SQLite jobs, bounded Python processing, retry limits, crash recovery, source-document SHA256 binding, and stale-worker fencing. Processing is independent of HTTP request lifetime.
- Deterministic technical-check engine: gates on authoritative AHJ and drawing provenance, actual application date, classification/construction, verified code context, rule version/source/effective dates, and confirmed measurements. **The production registry is empty.** Synthetic rules are confined to tests.
- `/projects`: the earlier Supabase-backed project/authentication, private-document, administrative checklist, general OpenAI fact-review and readiness-report foundation. Hosted integrations require credentials and remain separately unverified.

This is a tested extraction vertical slice, **not a production-ready autonomous code reviewer**. The private Codespace runs the same SQLite/private-file workbench. The Supabase plan-workbench adapter and OpenAI architectural interpretation are not wired. PostgreSQL schema/RLS and fenced cloud-worker RPCs are implemented and tested; this does not establish a connected multi-tenant hosted workflow.

## Run the drawing workflow

Use Node 24/npm 11 and Python with PyMuPDF 1.26.6. Optional Tesseract enables OCR fallback.

```sh
npm ci
python -m venv .venv
.venv/bin/python -m pip install -r processor/requirements.txt
cp .env.example .env.local
```

Set `PERMITPILOT_LOCAL_REVIEW=1` in `.env.local` and point `PERMITPILOT_PYTHON` to the virtualenv's **absolute** Python path. Run two processes from the repository:

```sh
npm run dev -- --hostname 127.0.0.1
npm run plan:worker
```

Open the application in your local browser. **Open local workbench → New plan review → Upload original → Select page → Extract → Review source annotations → Export review.** The workbench uses its own opaque local session; it does not impersonate a Supabase user. Private originals/jobs/reviews live under gitignored `.permitpilot/`; retain the directory and browser cookie to return later. Use a loopback binding and never expose this development-only mode publicly. Production mode disables it.

See [workbench setup and exact boundaries](docs/PLAN-WORKBENCH.md), [processor contract](docs/PROCESSOR.md), [regulatory scope](docs/REGULATORY-SCOPE.md), [cloud schema](docs/PLAN-DATA.md), and [remaining work](docs/ROADMAP.md). Review PyMuPDF's AGPL/commercial licensing before commercial distribution.

## Actual A1 baseline

The provided file has14 pages and SHA256 `89dbbd8f7977d772df44a4eea1a0ec35d795d9830538e3aa1e29f8d5bfe10bdc`. Page5 is A1, displayed landscape with stored rotation 270°. It matches the visible PlanF/600SF titleblock. The original URL was blocked by environment policy; the attachment was not independently checksum-matched to an official download.

Independent developer visual assertions found **49/49 printed dimension tokens**, **6/6 room/space labels**, **8/8 schedule rows**, and **1/1 scale label**. The baseline extraction took about 1.93 seconds. These are finite text/localization benchmark results, **not overall architectural accuracy, geometric measurement verification, professional review, or compliance**. Door3's blank size remains unknown; room polygons and physical opening locations are not inferred.

[Baseline methodology](docs/PLAN-BASELINE.md) · [metrics JSON](artifacts/plan-baseline-metrics.json) · [actual app screenshot](artifacts/plan-review-desktop.png) · [selected annotation](artifacts/plan-review-selected-annotation.png) · [generated report](artifacts/plan-review-report.pdf)

Groundtruth assertions are separate from runtime extraction. No expected fixture value populates analysis results. The original PDF is not committed; provide a lawfully obtained copy for regression runs.

## Test

```sh
npm run typecheck
npm run lint
npm test
npm run test:processor
npm run test:db          # Docker; applies001+002 and tests actual PostgreSQL RLS/RPCs
npm run test:e2e         # local server/worker needed for actual plan case
npm run build
```

Set `PERMITPILOT_TEST_PDF` to the actual PlanF PDF for the real-document browser test (the supplied attachment path is detected in this workspace). That test is explicitly skipped if the file or local workbench is unavailable. It must execute for an A1 acceptance claim. Chromium defaults to the system installation; set `CHROMIUM_PATH` when necessary.

Reproduce independent extraction scoring:

```sh
python processor/extract.py /path/to/PlanF.pdf --page 5 --document-id 11111111-1111-4111-8111-111111111111 > artifacts/plan-baseline-extraction.json
python scripts/evaluate-plan.py --extraction artifacts/plan-baseline-extraction.json --groundtruth fixtures/plans/groundtruth-a1.json --output artifacts/plan-baseline-metrics.json
```

See [validation evidence](docs/VALIDATION.md). A separately gated live-Supabase integration test requires `TEST_SUPABASE_URL` and `TEST_SUPABASE_ANON_KEY` for a disposable project with email confirmation disabled; it remains skipped without credentials.

## Supabase project foundation

Apply migrations 001 then 002, set `NEXT_PUBLIC_SUPABASE_URL` and the public `NEXT_PUBLIC_SUPABASE_ANON_KEY`, configure Auth SiteURL and `/auth/callback`, then use `/projects`. Never use a service-role key in public variables. The existing document-fact extraction endpoint uses server-only `OPENAI_API_KEY` or cloud-proxy-compatible `PERMITPILOT_OPENAI_KEY`; optional `OPENAI_MODEL` defaults to `gpt-4.1-mini`. These keys do not enable architectural vision or compliance in the plan worker.

No service-role key is required by the existing authenticated project workflow or proposed organization-scoped worker RPCs. Vercel can host the frontend/project APIs; the plan workbench's current SQLite/private-file implementation runs only in an explicitly enabled local or private Codespaces development workspace until a validated Supabase adapter and independent durable worker are connected. See [deployment](docs/DEPLOYMENT.md).
