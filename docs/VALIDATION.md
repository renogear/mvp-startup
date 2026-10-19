# Validation evidence

Current verification used the actual user-supplied San Diego County Plan F PDF, page 5/A1, plus separately labeled synthetic unit fixtures. No expected baseline values populate runtime extraction.

| Check | Executed outcome |
| --- | --- |
| TypeScript | Passed |
| ESLint | Passed without warnings |
| TypeScript unit tests | 131 passed, including private browser access/session/origin checks |
| Live Supabase integration | 1 explicitly skipped; credentials absent |
| Python processor/benchmark tests | 23 passed, including rotated/cropped pages, OCR fallback, fractions, unknown dimensions, and source identity |
| Playwright | 4 passed; includes the actual14-page PDF workflow |
| PostgreSQL migrations 001+002 | Applied successfully to disposable PostgreSQL 17 |
| Original RLS and plan/RPC suites | Passed; organization/document ancestry, worker lease fencing/reclaim/retry budgets, correction immutability, source binding, and regulatory-publication restrictions |
| Production build | Passed |
| Private workbench data in deployment traces | 0 files; local originals/session DB excluded |

The real-document browser test exercised:

- Actual page 5/A1 rendering, native rotation 270°, all 14 pages available.
- 65 live-extracted evidence candidates; no fixture JSON substituted for analysis.
- Clickable source boxes matching normalized coordinates within 2 display pixels before/after zoom and scrolling.
- Bedroom-label confirmation and equivalent dimension-unit correction with the original extraction retained.
- Correction history and a new browser context retrieving the same review using a persistent cookie held only in memory.
- Separate anonymous and valid other-owner contexts denied original/review/job/correction access.
- Structured JSON plus a 9-page preliminary report whose last page embeds the actual annotated source drawing.
- Zero active compliance rules; San José-specific evaluation disabled for this San Diego fixture.
- The prior manual administrative workflow, project edit/delete, unsupported coverage and protected endpoints also passed.

Independent developer visual assertions on A1 matched 49/49 dimension tokens, 6/6 room/space labels,8/8 schedule rows and1/1 scale label. Baseline extraction time was 1925.78 ms; browser-run processing times vary. See PLAN-BASELINE.md and artifacts/plan-baseline-metrics.json for finite denominators, unmatched candidates and limitations. A mixed-fraction parser defect was found outside the numeric benchmark, fixed generally, and regression tested before the final artifacts.

These are text/localization results for one drawing, not an overall architectural understanding score. Room polygons, physical opening placement, dimension endpoints and their geometric associations remain unverified. The baseline developer review is not a licensed architectural or regulatory groundtruth review.

## Actual artifacts

- `artifacts/plan-review-desktop.png`
- `artifacts/plan-review-selected-annotation.png`
- `artifacts/plan-review-report.pdf`
- `artifacts/plan-review-structured.json`
- `artifacts/plan-baseline-extraction.json`
- `artifacts/plan-baseline-metrics.json`

The PDF came from the user after an official-source request returned a network-policy 403. Visible titleblock/page contents match Plan F/A1; its SHA256 identifies the supplied bytes. It was not independently authenticated against a successful download of the official URL. Documents are treated as untrusted evidence, never executable instructions.

## Remaining boundaries

The tested plan workbench runs locally with an explicit opt-in, opaque local session and durable SQLite/private files; it is disabled in production. Hosted plan-review routes/worker adapter remain unwired. The Supabase schema and PostgreSQL tests do not establish live Auth/Storage HTTP integration. Credentials are absent, and the optional live test is explicitly skipped.

OpenAI architectural interpretation is not active or tested. This baseline uses real embedded text/OCR and deterministic parsing. The earlier general-document fact extractor is a different workflow; providing a key does not silently enable plan vision or compliance.

The production building-code registry is empty. Applicable 2025 California codes, San José adoption/amendments, residential instructions, application-date/classification scope, exceptions, operative sections and professional review remain prerequisites for phase 2. Synthetic thresholds are confined to tests. No compliance approval, professional security audit, production deployment or environment publication is claimed.

The reusable npm/virtualenv install script was executed successfully, the processor was rechecked on the real PDF using the virtualenv interpreter, and the server/worker were restarted. Updated install/start instructions and official-source domain additions were saved to the cloud configuration draft. Saving does not publish the environment; review/save settings and publish separately to retain the prepared snapshot.

## Private browser launch

The source branch includes a GitHub Codespaces dev container and supervised web/worker startup. The access tests cover real-provider configuration gates, exact host matching, proxy forwarding, production disablement, private-port confirmation, secure cookies, session owner access, and cross-origin mutation rejection. The startup scripts verify port 3000 through GitHub CLI before enabling sessions and check the session API under the expected hostname. These checks supplement GitHub's private-port authentication; headers alone do not authenticate a user.

The full local browser workflow was rerun after the access changes: all four Playwright cases passed, including the supplied PDF, corrections, persistence, owner isolation and downloads. Type checking, linting, all 131 unit tests, 23 processor tests, both PostgreSQL suites, and the production build passed. One optional live-Supabase test remains skipped. Nineteen build traces contained zero private original/database files. The first rerun timed out with the previous worker absent; the rerun passed after starting the required worker.

Codespaces lifecycle tests (`bash scripts/codespaces-test.sh`) passed four explicitly simulated provider/CLI scenarios: private success, restricted automatic token with stored-login fallback, total authentication failure, and public-port refusal. A fresh isolated installation passed locked npm installation, PDF.js worker generation, Python 3.12 and pinned PyMuPDF installation. Shell syntax and JSON configuration checks passed. A local Docker base-image build was attempted but the cloud network returned 403 for Microsoft's registry CDN (`centralus.data.mcr.microsoft.com`), before container build execution; an allowlist addition was saved for review. No TLS or integrity verification was disabled.

These checks do not establish a running GitHub Codespace or a completed container build. Creation, quota availability, and private-port login require the user's GitHub account and remain unverified until the launch link is used. See [browser setup](CODESPACES.md).
