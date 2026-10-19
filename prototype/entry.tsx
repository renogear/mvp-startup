import "core-js/actual/math/sum-precise";
import "core-js/actual/typed-array/to-hex";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { GlobalWorkerOptions } from "pdfjs-dist";
import { configureBrowserPdfAssets } from "../src/lib/plan/browser-pdf-assets";
import PlanWorkbench from "../src/components/plan/PlanWorkbench";
import {
  createBrowserTransport,
  type BrowserTransport,
} from "../src/lib/plan/browser-store";
import "./prototype.css";

declare const __PERMITPILOT_PDF_WORKER__: string;
declare const __PERMITPILOT_SAMPLE__: string;
declare const __PERMITPILOT_PDF_ASSETS__: Record<string, string>;

// Both the main thread and PDF worker include the library's required polyfills.
// The entire app is embedded in this file; no CDN or remote worker is loaded.
function Prototype() {
  const [workspace, setWorkspace] = useState<{
    transport: BrowserTransport;
    initialReviewId: string | null;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function start() {
      configureBrowserPdfAssets(
        Object.fromEntries(
          Object.entries(__PERMITPILOT_PDF_ASSETS__).map(([name, base64]) => [
            name,
            Uint8Array.from(atob(base64), (character) =>
              character.charCodeAt(0),
            ),
          ]),
        ),
      );
      if (!GlobalWorkerOptions.workerPort) {
        const workerUrl = URL.createObjectURL(
          new Blob([__PERMITPILOT_PDF_WORKER__], { type: "text/javascript" }),
        );
        const worker = new Worker(workerUrl, { type: "module" });
        worker.onerror = () => {
          if (active)
            setError(
              "This browser could not start the embedded PDF processor. Open this file in a current version of Chrome or Edge.",
            );
        };
        GlobalWorkerOptions.workerPort = worker;
      }
      const transport = await createBrowserTransport({ allowTemporary: true });
      const sample = Uint8Array.from(
        atob(__PERMITPILOT_SAMPLE__),
        (character) => character.charCodeAt(0),
      );
      const initialReviewId = await transport.ensureSample(sample);
      if (active) setWorkspace({ transport, initialReviewId });
    }
    start().catch((failure) => {
      if (active)
        setError(
          failure instanceof Error
            ? failure.message
            : "The browser workspace could not open.",
        );
    });
    return () => {
      active = false;
    };
  }, []);
  if (error)
    return (
      <main className="prototype-start">
        <span className="prototype-wordmark">PermitPilot.</span>
        <h1>The workspace couldn’t open.</h1>
        <p>{error}</p>
        <p>
          Open this file in a current version of Chrome or Edge and allow
          browser storage.
        </p>
        <button onClick={() => location.reload()}>Try again</button>
      </main>
    );
  if (!workspace)
    return (
      <main className="prototype-start">
        <span className="prototype-wordmark">PermitPilot.</span>
        <div className="prototype-spinner" />
        <h1>Opening your drawing workspace.</h1>
        <p>
          Preparing the actual San Diego Plan F reference sheet. Your drawings
          stay in this browser.
        </p>
      </main>
    );
  return (
    <>
      <div
        className={
          "prototype-notice" +
          (workspace.transport.storageMode === "temporary" ? " temporary" : "")
        }
        role={
          workspace.transport.storageMode === "temporary" ? "status" : undefined
        }
      >
        <strong>Interactive prototype</strong>
        <span>
          {workspace.transport.storageMode === "temporary"
            ? "Temporary session — browser storage is blocked. Export your work before closing."
            : "Works on your device · Saved in this browser · Code compliance not evaluated"}
        </span>
      </div>
      <PlanWorkbench {...workspace} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Prototype />);
