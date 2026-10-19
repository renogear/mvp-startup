# Use PermitPilot in your browser

The private GitHub Codespaces configuration runs the real plan-review workbench
without installing development tools on your computer. It includes Node.js 24,
Python 3.12, pinned PyMuPDF, Tesseract OCR, the Next.js application, and the
independent extraction worker. The original drawing is rendered by PDF.js;
annotations, corrections, source documents, queued jobs and exports use the
application's real persistent workbench implementation.

## Open the application

1. Sign into GitHub with access to `renogear/mvp-startup`.
2. Open [Create a PermitPilot Codespace](https://codespaces.new/renogear/mvp-startup?ref=app%2Fpermitpilot-interactive).
   Check that **Branch** is `app/permitpilot-interactive`, select the default
   dev-container configuration, then create the Codespace.
3. Wait for dependency installation and the startup readiness check. The first
   startup needs network access to trusted package registries and takes longer.
   The editor becomes available while startup verifies that port **3000** is
   **Private**. The browser may open during that check; review sessions remain
   locked until startup completes and the page updates.
4. If it does not open automatically, open the **Ports** tab beside Terminal,
   locate **3000 — PermitPilot**, and click **Open in Browser**. Its visibility
   must remain **Private**, the GitHub Codespaces default. Sign into GitHub in
   that browser when prompted. The app opens the plan-review workbench.

Creating a Codespace uses your GitHub account/organization's Codespaces quota or
billing policy. This repository configuration does not create one automatically.
Stop the Codespace from GitHub's Codespaces page when finished.

## Review a real plan

Open the workbench and create a plan review. Upload the original PDF, select
the sheet, and run extraction. For the County of San Diego Plan F reference,
the floor-plan sheet A1 is **PDF page 5**. Click an extracted item to locate
its evidence on the actual drawing, confirm or correct it, and export the
structured JSON or preliminary annotated PDF report.

The San Diego baseline is an extraction test. San José rules must not apply to
it. **No real technical compliance rules are enabled** in this workbench.
Room label boxes do not establish room boundaries; dimension labels do not
establish geometric endpoints. Unknown information remains unknown. See
[the processor contract](PROCESSOR.md) and [regulatory scope](REGULATORY-SCOPE.md).

This is a private evaluation workspace. It is separate from the authenticated
Supabase contractor-project application. Supabase and OpenAI credentials are
not required for the existing floor-plan extraction workflow. A configured API
key does not silently activate architectural vision or code compliance.

## Persistence and access

- The Codespace's checkout contains private originals and SQLite review data
  under gitignored `.permitpilot/`. Neither originals nor session records are
  committed. Normal stop/start and container rebuild retain this directory.
  **Deleting the Codespace deletes that copy**; export needed reports and
  arrange a protected backup before deletion.
- Keep using the same Codespace URL and browser profile to retain the opaque
  workbench cookie. A new Codespace has a different URL and separate storage.
  Cookie loss/expiry has no account-based recovery in this development slice.
- The real Codespaces runtime provides `CODESPACES`, `CODESPACE_NAME`, and
  `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`. Startup opts into the dedicated
  private-Codespaces review mode. It does not forge those variables or enable
  the loopback-only local mode. It sets
  `PERMITPILOT_CODESPACES_PRIVATE_CONFIRMED=1` only after GitHub CLI has set and
  independently read back port 3000's Private visibility. There is no saved
  approval file; every startup repeats that provider check.
- Port 3000 stays **Private**. Do not change it to Public or organization-wide
  visibility. GitHub's private-port login is the outer access boundary; the
  application's owner cookie separates review sessions inside the workbench.
- `.env.local` is never created, overwritten or committed by these scripts.
  Any future secrets belong in GitHub Codespaces secrets or an ignored local
  environment file. Never put secrets into the dev-container configuration.

## Startup and troubleshooting

`postCreateCommand` installs locked Node dependencies and creates `.venv` with
the pinned processor package. The npm postinstall copies the matching PDF.js
worker. `postStartCommand` verifies Python and SQLite, launches supervised
web/worker processes with browser review sessions locked, and uses GitHub CLI
to set port 3000 to Private and read back its visibility. Only then does it
restart the web process with review sessions enabled. It waits for the worker
and verifies the actual session API using the Codespace's expected browser
hostname before printing the browser URL. A failed privacy or readiness check
stops the web service. The worker is independent of HTTP requests; queued work
survives its restart.

From the Codespaces terminal:

```sh
# Recheck privacy and restart the web service; a healthy worker is reused.
bash scripts/codespaces-start.sh

# Stop services while retaining all saved data.
bash scripts/codespaces-stop.sh

# Reinstall dependencies after changing the source/lockfile.
bash scripts/codespaces-stop.sh
bash scripts/codespaces-install.sh
bash scripts/codespaces-start.sh
```

Startup prints the private log directory under
`/tmp/permitpilot-codespaces-<checkout-hash>/`. Inspect `web.log` for Next.js
errors, `worker.log` for extraction failures, and `ports.log` for GitHub CLI
access errors. Avoid posting logs containing
customer document details publicly. If dependencies cannot be downloaded, fix
the reported network or registry error and rerun installation; do not disable
TLS or package integrity checks.

If startup cannot inspect the Codespace, check `gh auth status` and your
account's Codespaces permissions. GitHub CLI must have access to this Codespace;
the automatic repository token may lack the `codespace` scope. Startup tries
that token first, then an existing GitHub CLI login with environment token
overrides removed for the port-management commands. If neither has access,
authorize GitHub CLI through its browser device-login flow:

```sh
env -u GH_TOKEN -u GITHUB_TOKEN gh auth login --hostname github.com --git-protocol https --web --scopes codespace
bash scripts/codespaces-start.sh
```

Removing the token variables for that login command is necessary because they
otherwise take precedence over stored CLI credentials. Startup's fallback uses
the same isolated removal; application environment variables stay intact.
If port 3000 is not registered yet, add
it in the Ports panel with Private visibility and rerun startup. Do not work
around a failed check by exporting the confirmation flag yourself. The launch
configuration has no public-port fallback.

Run `bash scripts/codespaces-test.sh` after installing dependencies to check
supervision, bootstrap-to-enabled state, stored-login fallback, and failure
cleanup in an isolated temporary checkout. Its GitHub CLI, HTTP and application
commands are explicit mocks; it does not touch the real server or establish
that GitHub accepted a login. Successful creation and private-port login must
still be validated in the creator's own Codespace.

The service scripts bind Next.js to `0.0.0.0:3000` for the private GitHub proxy.
They are intended for Codespaces, not an unauthenticated public server or a
Vercel deployment. The hosted Supabase floor-plan adapter and commercial
multi-tenant deployment remain separate work. See [deployment](DEPLOYMENT.md).
