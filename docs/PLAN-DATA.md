# Floor-plan persistence and regulatory boundaries

Migration `002_plan_reviews.sql` extends the existing Supabase projects and private
documents. Apply it after `001_initial.sql`. It publishes **no compliance rules**.
An extracted dimension or a user confirmation is an observation; neither is an
official code verification.

## Durable records

- `plan_reviews`: the uploaded document's immutable SHA-256, name, MIME type and
  size; organization, project, document and owner; editable `context`; page count.
  Context retains the selected AHJ, verification status/evidence, actual permit
  application date, project classification, construction context and code edition.
- `plan_analysis_jobs`: one job per review, page and pipeline version. Stores
  queue state, attempts, timestamps, error, worker lease and original result JSON.
- `document_pages`: original page number, dimensions, rotation and vector/raster
  classification. Coordinates in observations are normalized to the displayed page.
- `extracted_elements`: immutable observations copied atomically from completed
  results, preserving page, kind, normalized bounding box and original JSON.
- `user_corrections`: append-only element review history. Store the validated
  correction object in `correction`, plus the status, author and timestamp. Read
  in ascending `created_at,id` order and apply the latest per element. Never edit
  the original extraction to conceal a correction.
- `plan_report_snapshots`: immutable report inputs, distinguished as preliminary
  extraction or a referenced regulatory evaluation. Customer sessions can create
  only preliminary extraction snapshots.

All document-derived records use composite foreign keys. The organization,
project, document, review and job identifiers must describe the same ancestry;
checking organization membership alone cannot accidentally associate a document
with another project. Organization membership controls reads. Correction authors
must match the authenticated user. Customers cannot change derived elements,
worker state or regulatory records directly.

The Supabase storage bucket remains `project-documents`, private with the existing
20 MiB PDF/JPEG/PNG limit and organization/project/document object paths. File
metadata must agree with the stored original; a worker must hash the downloaded
bytes before extraction. The database verifies that the result's `sourceSha256`
matches the review. The worker-supplied result checksum is provenance metadata;
it is not an independent security or accuracy attestation.

## Worker RPC contract

Use an authenticated, organization-scoped Supabase session. No browser receives
an OpenAI or Supabase service-role key. `claim_plan_job()` sees only organizations
the authenticated user belongs to. It returns zero or one row, claims with
`FOR UPDATE SKIP LOCKED`, increments attempts and returns a fresh `lease_token`.
Claims last five minutes; renew well before expiry.

```text
claim_plan_job() -> plan_analysis_jobs[] (zero or one)
heartbeat_plan_job(job_id uuid, lease_id uuid) -> timestamptz
complete_plan_job(job_id uuid, result_data jsonb, result_sha text,
                  lease_id uuid) -> plan_analysis_jobs
fail_plan_job(job_id uuid, error_message text, retryable boolean,
              lease_id uuid) -> plan_analysis_jobs
retry_plan_job(job_id uuid) -> plan_analysis_jobs
```

`lease_id` is the exact `lease_token` from the claim. Completion, failure and
heartbeat require the same authenticated user, the current fencing token, an
unexpired lease and organization membership. This prevents a late process from
publishing results after another process reclaims its expired lease, even if
both processes use the same authenticated user.

A retryable failure returns to `queued` while attempts remain. A nonretryable
failure enters `failed`; a member may retry it using `retry_plan_job` if attempts
remain. Expired processing jobs are reclaimed on the next claim. Expired jobs
at their maximum attempt count become failed. The default is three attempts.
The worker must continuously claim/poll; an idle database does not independently
run a background scheduler. A new extraction pipeline uses a new
`pipeline_version`, preserving the prior result.

`complete_plan_job` requires a nonempty schema version, page metadata, a matching
source SHA-256, the requested page number and at most 10,000 observations. Every
element must have an ID, requested page, supported kind, normalized bounding box
and `verification: "unreviewed"`. The application must validate the full result
with its Zod schema first. Completion inserts page metadata and element records
and sets the completed result in one transaction. A failed transaction leaves
the claim intact for supported failure handling. Completed job results are
immutable through customer sessions.

Create jobs using only `id`, `review_id`, `organization_id`, `project_id`,
`document_id`, `page` and optionally `pipeline_version`; preserve database
defaults for all state/lease fields. Job uniqueness prevents duplicate requests
for the same review/page/pipeline.

## Regulatory publication and future execution

The global publication-controlled catalog contains `code_sources`,
`code_editions`, `compliance_rules` and `compliance_rule_versions`. Versioned
records retain jurisdiction, edition, official URL, source section/excerpt,
verification person/date, effective interval, applicability conditions,
executor/version, parameters and limitations. Source verification requires an
archived-content fingerprint. These tables have authenticated read policies
only. Customer sessions have no publication or activation endpoint.

`compliance_evaluations` freezes the AHJ evidence, permit date, classification,
edition, observations hash and evaluator version. `compliance_findings` ties each
finding to a rule version of that **same AHJ and code edition**, with status,
explanation, evidence, recommended action and source locations. Composite foreign
keys reject mixing San José and another authority in one finding. These tables
also expose no client write policy. A future trusted evaluator must additionally
verify source/rule publication status, effective-date intervals, applicability,
and facts confirmed by the reviewer before writing an evaluation. The database
schema itself does not supply such a verified evaluator.

City of San José and unincorporated Santa Clara County remain separate
jurisdictions. Mailing cities and ZIP codes never establish authority. The
San Diego County Plan F test document is an extraction baseline; its review
context remains San Diego County/unsupported, and it must never activate San José
rules. No code edition is inferred merely because a sheet mentions a year.

## Validation and deployment limits

Run `tests/plan-rls.sql` in PostgreSQL after the existing database bootstrap and
both migrations. It rolls back all fixtures. It checks organization visibility,
composite document ownership, queue claims, lease recovery/fencing, source-hash
matching, immutable observations/corrections and customer rule-publication
denial. The fixtures are synthetic database security inputs, not extraction
results or official permitting requirements.

The local workstation storage adapter is separate from hosted Supabase storage.
Local SQLite tests do not verify live Supabase Auth, Storage, RLS deployment or
cloud worker operation. Those checks require configured Supabase credentials,
both migrations and the actual deployed worker. Keep local-only mode opt-in and
disabled in hosted environments. There is currently no activated building-code
evaluation catalog or claim of professional security review.
