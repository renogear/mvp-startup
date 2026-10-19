import { build } from "esbuild";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(root, "prototype/dist");
await mkdir(destination, { recursive: true });
const polyfills = await build({
  stdin: {
    contents:
      'import "core-js/actual/math/sum-precise"; import "core-js/actual/typed-array/to-hex";',
    resolveDir: root,
  },
  bundle: true,
  platform: "browser",
  format: "iife",
  minify: true,
  write: false,
});
const worker =
  polyfills.outputFiles[0].text +
  "\n" +
  (await readFile(
    resolve(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
    "utf8",
  ));
const sample = await readFile(resolve(root, "prototype/reference-a1.pdf"));
const assets = {};
for (const [folder, extension] of [
  ["wasm", ".wasm"],
  ["standard_fonts", null],
  ["cmaps", ".bcmap"],
]) {
  for (const filename of await readdir(
    resolve(root, "node_modules/pdfjs-dist", folder),
  )) {
    if (
      filename.startsWith("LICENSE") ||
      (extension && !filename.endsWith(extension))
    )
      continue;
    assets[filename] = (
      await readFile(resolve(root, "node_modules/pdfjs-dist", folder, filename))
    ).toString("base64");
  }
}
const bundle = await build({
  absWorkingDir: root,
  entryPoints: ["prototype/entry.tsx"],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["chrome120", "edge120"],
  jsx: "automatic",
  minify: true,
  write: false,
  outfile: "PermitPilot.js",
  alias: { "next/link": resolve(root, "prototype/link.tsx") },
  define: {
    "process.env.NODE_ENV": '"production"',
    __PERMITPILOT_PDF_WORKER__: JSON.stringify(worker),
    __PERMITPILOT_SAMPLE__: JSON.stringify(sample.toString("base64")),
    __PERMITPILOT_PDF_ASSETS__: JSON.stringify(assets),
  },
});
const javascript = bundle.outputFiles
  .find((file) => file.path.endsWith(".js"))
  .text.replace(/<\/script/gi, "<\\/script");
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).text;
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'unsafe-inline'; img-src blob: data:; font-src blob: data:; connect-src blob:; worker-src blob:;"><title>PermitPilot — Interactive plan review</title><style>${css}</style></head><body><div id="root"></div><script>${javascript}</script></body></html>`;
await writeFile(resolve(destination, "PermitPilot.html"), html);
const licenses = [];
for (const folder of ["wasm", "standard_fonts", "cmaps"]) {
  for (const filename of await readdir(
    resolve(root, "node_modules/pdfjs-dist", folder),
  )) {
    if (filename.startsWith("LICENSE"))
      licenses.push(
        `\n===== pdfjs-dist/${folder}/${filename} =====\n` +
          (await readFile(
            resolve(root, "node_modules/pdfjs-dist", folder, filename),
            "utf8",
          )),
      );
  }
}
for (const [name, license] of [
  ["pdfjs-dist", "LICENSE"],
  ["pdf-lib", "LICENSE.md"],
  ["react", "LICENSE"],
  ["react-dom", "LICENSE"],
  ["core-js", "LICENSE"],
  ["zod", "LICENSE"],
  ["lucide-react", "LICENSE"],
]) {
  licenses.push(
    `\n===== ${name} =====\n` +
      (await readFile(resolve(root, "node_modules", name, license), "utf8")),
  );
}
await writeFile(
  resolve(destination, "THIRD-PARTY-LICENSES.txt"),
  licenses.join("\n"),
);
await writeFile(
  resolve(destination, "START-HERE.txt"),
  `PermitPilot — Interactive browser prototype\n\nOpen PermitPilot.html in Chrome or Edge. No installation, login, internet connection, terminal or server is required after downloading.\n\nThe actual San Diego County Plan F reference sheet A1 (source PDF page 5) opens automatically on first use. Click an annotation or evidence row to inspect it. Confirm or correct extracted facts. Use Export review for a PDF and Structured JSON for a data backup. All reviews lets you upload your own PDF, PNG or JPG. Embedded PDF text extraction is supported; scanned text/image OCR is unavailable.\n\nWhen browser storage is available, originals and changes are saved using IndexedDB. If the browser blocks storage, a prominent Temporary session notice appears; export before closing because that session is not saved. Clearing browser storage, changing browsers, or moving to a different origin may make saved records unavailable. Export important work. Processing runs while this tab is open. No documents are sent to a server.\n\nThis is a browser-only prototype, separate from the full-stack application's authentication and organization features. There is no AI service or active building-code compliance rule. Printed dimensions and room labels are candidates for human review, not verified physical measurements or room boundaries. San Jose rules never apply to this San Diego reference.\n\nThe included one-page vector excerpt was copied without content alteration from PDF page 5 of the user-supplied Plan F document. Official source: https://www.sandiegocounty.gov/content/dam/sdc/pds/bldg/adu_info/pds671_11x17.pdf . Source bytes were not independently authenticated against an official download. Original full-document SHA256: 89dbbd8f7977d772df44a4eea1a0ec35d795d9830538e3aa1e29f8d5bfe10bdc .\n\nSource code and build instructions: https://github.com/renogear/mvp-startup/tree/app/permitpilot-interactive\n`,
);
console.log(
  `Created prototype/dist/PermitPilot.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB), with embedded worker and actual reference drawing.`,
);
