# PermitPilot — interactive prototype

[Download the prototype ZIP](https://github.com/renogear/mvp-startup/archive/refs/heads/prototype-browser.zip).

1. Unzip the download.
2. Open **PermitPilot.html** in your browser (Chrome or Edge recommended).
3. The actual San Diego Plan F/A1 reference drawing opens automatically. Click annotations, correct measurements, or export a PDF. **All reviews** lets you upload your own drawing.

No installation, terminal, port configuration, account or API key is required after downloading. This is an actual browser application with local PDF parsing, an interactive viewer, human corrections, and PDF/JSON exports.

Your documents stay on your device. Where browser storage is available, reviews persist in that browser. If you see **Temporary session**, export before closing because the browser blocks file storage. Processing runs while the tab is open.

No building-code compliance checks or AI services are active. The San Diego drawing never receives San José requirements. Printed dimensions are review candidates, not verified physical measurements or code approval.

Validated with real-document browser tests and an actual downloaded-file workflow in WebKit, including zero remote requests and a nine-page PDF export. Chrome/Edge direct-file launch could not be tested here because administrator policy blocks it; Chromium browser workflows and persistence passed using an internal static test host.

[Complete source, build instructions and validation](https://github.com/renogear/mvp-startup/tree/32c86326ddb21cc95d31b1f329547345f5661fa0/prototype)

See START-HERE.txt and THIRD-PARTY-LICENSES.txt for source-document attribution and library licenses.
