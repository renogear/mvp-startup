# Deployment boundaries

The drawing-workbench vertical slice currently runs locally with Next.js, a separate Python worker, private original files, and SQLite. It is explicitly disabled under `NODE_ENV=production`. Do not put the SQLite/private-file implementation on Vercel ephemeral storage or expose the local-session bootstrap publicly.

For a hosted plan-review pilot:

1. Provision Supabase and apply migrations 001 then 002. Validate organization RLS and the private bucket.
2. Wire the plan routes to `plan_reviews`, private original documents, job RPCs, append-only corrections and report snapshots. The schema/RPCs exist and pass PostgreSQL tests; this hosted HTTP adapter is **not wired**.
3. Run a durable worker separately from Vercel HTTP requests. Use an authenticated organization-scoped worker session, atomic claim and fenced lease-token RPCs from PLAN-DATA.md. Bound processing, supervise restarts, heartbeat leases, hash original bytes, and persist immutable output before completion.
4. Configure actual Auth SiteURL/redirects and SMTP; test genuine signup, confirmation, fresh login persistence, two-tenant isolation and full document lifecycle.
5. Add monitored quotas, malware scanning, retention/orphan cleanup, backups, and sensitive-log redaction. Review licensing and customer consent before processing real client plans.
6. Activate technical code checks only after the required source, applicability, professional review, and validation gates are satisfied. No active real rules are shipped.

The earlier `/projects` foundation can be deployed separately to Vercel using Node 24/npm 11, `npm ci`, and `npm run build`. Configure its public Supabase URL/anon key (never a service-role key), migrations and `/auth/callback`. The optional server-side general-document fact extractor uses `OPENAI_API_KEY` or `PERMITPILOT_OPENAI_KEY`. This does not activate architectural vision.

Network destinations: npm/PyPI for setup, the exact Supabase project host for Auth/PostgREST/Storage, api.openai.com only for explicitly configured AI use, and official city/county/state sources for regulatory research. Never broaden egress to conceal a missing verification step. The official San Diego file download was blocked; the supplied PDF is the tested extraction source.

No production deployment or environment publication has been performed. Saved cloud setup drafts are separate from runtime settings and publication.
