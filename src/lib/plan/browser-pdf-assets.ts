import type { DocumentInitParameters } from "pdfjs-dist/types/src/display/api";

type BinaryKind = "wasmUrl" | "cMapUrl" | "standardFontDataUrl";
type BinaryRequest = { kind: BinaryKind; filename: string };

let configuredAssets: ReadonlyMap<string, Uint8Array> | null = null;

/** Supply bundled PDF.js binary resources without using a server or CDN. */
export function configureBrowserPdfAssets(
  assets: Record<string, Uint8Array>,
): void {
  const copies = new Map<string, Uint8Array>();
  for (const [filename, bytes] of Object.entries(assets)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(filename)) {
      throw new Error(`Invalid bundled PDF asset filename: ${filename}`);
    }
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength) {
      throw new Error(`Bundled PDF asset is empty or invalid: ${filename}`);
    }
    // Keep immutable private copies: callers and PDF.js transfers must not
    // detach or modify the bytes required by subsequent document loads.
    copies.set(filename, new Uint8Array(bytes));
  }
  configuredAssets = copies;
}

class EmbeddedBinaryDataFactory {
  private readonly assets = configuredAssets;

  async fetch({ kind, filename }: BinaryRequest): Promise<Uint8Array> {
    if (
      !["wasmUrl", "cMapUrl", "standardFontDataUrl"].includes(kind) ||
      typeof filename !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(filename)
    ) {
      throw new Error("PDF.js requested an unsupported bundled binary asset.");
    }
    const bytes = this.assets?.get(filename);
    if (!bytes) {
      throw new Error(`PDF binary asset was not bundled: ${filename}`);
    }
    return new Uint8Array(bytes);
  }
}

/**
 * PDF.js 6 routes worker `FetchBinaryData` requests through BinaryDataFactory
 * when useWorkerFetch is false. This preserves its normal WebAssembly decoder
 * while supplying the actual embedded OpenJPEG/JBIG2 bytes on file:// pages.
 * Keep ordinary application behavior when no offline assets were configured.
 */
export function browserPdfOptions(): Pick<
  DocumentInitParameters,
  "BinaryDataFactory" | "useWorkerFetch"
> {
  return configuredAssets
    ? { BinaryDataFactory: EmbeddedBinaryDataFactory, useWorkerFetch: false }
    : {};
}
