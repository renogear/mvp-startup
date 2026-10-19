# Portable browser prototype

[Download ZIP](https://github.com/renogear/mvp-startup/archive/refs/heads/prototype-browser.zip), unzip, and open `PermitPilot.html` in a current Chrome or Edge browser. No installation, terminal, account, server or API credential is needed after downloading. The included actual San Diego County Plan F sheet A1 opens with live-extracted evidence on first use.

The browser build reuses `PlanWorkbench`, `PlanCanvas`, the structured extraction/correction schema and fail-closed regulatory evaluation. Its explicit browser adapter stores originals, jobs, context, corrections and history in IndexedDB. These operations are real local persistence, not simulated server responses. There is no organization identity or hosted document service in this delivery.

PDF.js extracts printed text and transforms annotation boxes into the displayed page orientation. General deterministic parsing identifies dimension, room-label, scale and schedule candidates. Expected fixture values never populate results. Every extracted candidate starts unreviewed. Printed text is distinct from physical measurements and geometric associations. OCR, room boundaries and comprehensive architectural interpretation remain unavailable. PDF/image display, PDF text extraction, human correction, JSON export and source-backed PDF export work locally.

Originals and corrections stay in this browser. If local-file storage is blocked, the entry explicitly opts into a real in-memory session and displays **Temporary session — export before closing**. That mode does not pretend to save across reloads. Storage failures after a successful persistent-mode initialization remain visible errors. Processing runs while the tab remains open. Interrupted jobs are marked failed and can be retried. Use the same browser and file location, and export important work before clearing browser data. This is a prototype's storage model, separate from the Supabase organization/application workflow.

## Build and test

```sh
npm ci
npm run prototype:build
npm run prototype:test
```

`prototype/dist/PermitPilot.html` embeds JavaScript, CSS, the PDF.js worker, required standard-library polyfills, image-decoder WebAssembly, standard PDF font/CMap data, and the actual source-sheet excerpt. There are no CDN scripts or remote fonts. Its content security policy denies remote network connections; files are never uploaded. The ZIP also contains instructions and third-party library licenses. PDF.js ICC color management is limited when using the offline binary loader; exact color fidelity is not asserted.

`reference-a1.pdf` is a one-page vector excerpt copied from PDF page 5 of the user-supplied 14-page County of San Diego Plan F document, preserving the drawing and its title block. The original full-document SHA256 is `89dbbd8f7977d772df44a4eea1a0ec35d795d9830538e3aa1e29f8d5bfe10bdc`. Official source: https://www.sandiegocounty.gov/content/dam/sdc/pds/bldg/adu_info/pds671_11x17.pdf . The supplied bytes were not independently authenticated against an official download. Excerpt page 1 corresponds to original PDF page 5; the full uploaded document still uses its original page numbering.

To regenerate the excerpt, use PyMuPDF to insert only `from_page=4, to_page=4` from a lawfully obtained source into a new PDF, preserve rotation/content, and save to `prototype/reference-a1.pdf`. Do not replace runtime analysis with benchmark JSON.

## Validation boundaries

Three Chromium browser tests passed: real sample rendering/clickable annotation coordinates, correction persistence after reload, offline PDF export with actual drawing and 65 internal annotation links; full 14-page upload, page-5 extraction, reload and delete; and honest temporary mode when storage is blocked. The browser generated 49 dimension candidates, 6 room labels, 8 schedule rows and 1 scale label from source text. An independently defined A1 benchmark matched those printed items. Accuracy of inferred physical dimensions/geometry remains unknown because those are not evaluated.

An additional test opened the actual HTML using `file://` in Playwright WebKit with browser sandbox/security unchanged. It rendered the source, displayed 65 clickable annotations, recorded a test correction without overwriting the original, and downloaded structured JSON plus a valid nine-page PDF. Temporary mode was visibly enabled because WebKit allowed IndexedDB metadata but rejected actual File storage. Initialization now probes File write/read capability before selecting persistence. The final file-origin run produced zero page errors, zero decoder warnings, and zero remote/network requests. Embedded OpenJPEG resolves the source's JPEG2000 graphics.

The managed Chromium in this cloud environment blocks `file://` navigation by administrator policy. Chromium workflow tests therefore use an internal static test server and verify zero additional network requests, then disable network connectivity before exporting. The WebKit test establishes actual downloaded-file behavior, while an unrestricted Chrome/Edge double-click launch remains unverified here. No administrator policy or browser security mechanism was disabled.

No real code-compliance rules are active. The San Diego reference never receives San José checks. The ZIP is a portable prototype; the full-stack source and commercial deployment remain separate.
