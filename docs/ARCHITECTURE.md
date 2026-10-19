# Architecture and security boundaries

- `src/lib/domain.ts`: intake and extraction schemas, deterministic authority/category/property-type matching, honest preparation findings. AI is never a rule authority.
- `src/lib/rules.ts`: reads latest verified requirement versions from PostgreSQL. Unknown condition shapes fail closed instead of becoming assumptions. Rule writes are unavailable to application users; publication requires an administrator's source review.
- `src/components`: responsive workspace and focused authentication, requirements, extraction review, and report components. Forms use React Hook Form and Zod. Radix Slot/CVA button primitive follows the shadcn/ui pattern.
- `src/app/api`: user-session-scoped server endpoints for intake validation, private document registration/signature checks, structured OpenAI extraction, organization settings, and PDF export. No service-role access.
- `supabase/migrations`: organization memberships, projects, normalized properties/categories, jurisdiction directory, immutable-by-client versioned rules, checklist result schema, documents, analysis history, report snapshots, activity records. Foreign keys prevent cross-project organization mismatches.

Project JSON is the versioned working snapshot for manual checklist and human-review data; property and category indexes are maintained transactionally by `save_project`. The separate checklist-results table is reserved for persisting official-version assessments when verified coverage is published. Readiness is currently evaluated deterministically on demand and exported snapshots are recorded.

Files are private, limited to 20 MB and PDF/JPEG/PNG MIME types, and scoped by organization/project/object UUID. Client and registration endpoint check file signatures. Preview URLs expire after 60 seconds. Replacement uploads a new object before removing the previous one. Extraction uses server credentials and reads the private file with the user's access. Facts remain unconfirmed until human review; missing values and potential address differences generate clarification findings. Upload existence never certifies document completeness.

Known limitations before customer deployment:

- Live Supabase Auth and Storage HTTP behavior and real OpenAI extraction have not been validated here because credentials are absent. PostgreSQL policies and browser demo behavior have separate automated coverage.
- No professional security audit has been performed. File signatures are not malware scanning or PDF sanitization. Add scanning/quarantine before sensitive client uploads.
- The extraction limit is a best-effort 20 completed analyses per organization per hour, not an atomic quota. Concurrent requests may exceed it. Add an atomic reservation/usage budget before exposing extraction broadly.
- File storage and PostgreSQL updates are not distributed transactions. Add orphan cleanup and retryable document lifecycle jobs. Local unsaved/error states must be checked after connection failures.
- Membership invitation, granular roles beyond owner/member, account recovery UI, retention/deletion automation, and backups/restore drills need customer-pilot hardening. Organization creation exists; invites are not in this MVP.
- The local demo is not organization isolation or cloud persistence; it is a clearly labeled browser-only exploration mode. It refuses real uploads. Do not use it for customer documents.
- Manual address comparison is conservative and may flag abbreviation differences; it is not geocoding or parcel validation.
- Profile displays the authenticated account; organization owners can rename their workspace. Billing and enterprise administration are excluded.

Project edits update the UI optimistically and serialize server writes to prevent response ordering from reverting newer edits. Failed writes retain a visible unsaved warning and retry action. This is not multi-user optimistic concurrency control; simultaneous edits from separate sessions still need version conflict handling before collaborative use.
