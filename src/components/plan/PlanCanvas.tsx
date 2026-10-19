"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Expand,
  FileText,
  Hand,
  LoaderCircle,
  Minus,
  Plus,
} from "lucide-react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";
import type { Element } from "@/lib/plan/schema";
import "./plan-canvas.css";

type Props = {
  src: string;
  mime: string;
  page: number;
  onPageChange: (page: number) => void;
  elements: Element[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showAnnotations: boolean;
};

type Asset = { src: string } & (
  | { kind: "pdf"; document: PDFDocumentProxy; count: number }
  | { kind: "image"; image: HTMLImageElement; count: number }
);
type PageData = {
  src: string;
  number: number;
  width: number;
  height: number;
  pdfPage: PDFPageProxy | null;
};
const clampZoom = (value: number) => Math.min(4, Math.max(0.1, value));
const kindLabels: Record<Element["kind"], string> = {
  room_label: "Room label",
  dimension: "Dimension candidate",
  scale: "Drawing scale",
  door_schedule: "Door schedule",
  window_schedule: "Window schedule",
  annotation: "Text annotation",
};

export function PlanCanvas({
  src,
  mime,
  page,
  onPageChange,
  elements,
  selectedId,
  onSelect,
  showAnnotations,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const pendingCenter = useRef<{ x: number; y: number } | null>(null);
  const pan = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    pointerId: number;
  } | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [failure, setFailure] = useState<{
    src: string;
    message: string;
  } | null>(null);
  const [pageFailure, setPageFailure] = useState<{
    src: string;
    page: number;
    message: string;
  } | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [fit, setFit] = useState(true);
  const [manualScale, setManualScale] = useState(1);
  const [renderedKey, setRenderedKey] = useState<string | null>(null);
  const [renderFailure, setRenderFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [panning, setPanning] = useState(false);
  const currentAsset = asset?.src === src ? asset : null;
  const pageCount = currentAsset?.count ?? 0;
  const activePage = pageCount
    ? Math.max(1, Math.min(pageCount, page))
    : Math.max(1, page);
  const currentPage =
    pageData?.src === src && pageData.number === activePage ? pageData : null;
  const fitScale = currentPage
    ? Math.max(
        0.05,
        Math.min(
          (size.width - 48) / currentPage.width,
          (size.height - 48) / currentPage.height,
        ),
      )
    : 1;
  const scale = fit ? fitScale : manualScale;
  const width = currentPage ? currentPage.width * scale : 0;
  const height = currentPage ? currentPage.height * scale : 0;
  const renderKey = currentPage
    ? `${src}:${activePage}:${scale.toFixed(6)}`
    : "";
  const isRendered = !!renderKey && renderedKey === renderKey;
  const error =
    failure?.src === src
      ? failure.message
      : pageFailure?.src === src && pageFailure.page === activePage
        ? pageFailure.message
        : renderFailure?.key === renderKey
          ? renderFailure.message
          : null;
  const visibleElements = elements.filter(
    (element) => element.page === activePage,
  );

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(scroll);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    let disposed = false;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    let imageUrl: string | undefined;
    async function load() {
      try {
        const response = await fetch(src, {
          credentials: "same-origin",
          signal: abort.signal,
        });
        if (!response.ok)
          throw new Error(
            `The original document could not be loaded (HTTP ${response.status}).`,
          );
        const bytes = await response.arrayBuffer();
        if (disposed) return;
        if (mime === "application/pdf") {
          // Import only in the browser: PDF.js relies on browser rendering APIs.
          const pdfjs = await import("pdfjs-dist");
          if (disposed) return;
          pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
          loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
          const document = await loadingTask.promise;
          if (!disposed) {
            setFailure(null);
            setAsset({ src, kind: "pdf", document, count: document.numPages });
          }
        } else if (mime === "image/png" || mime === "image/jpeg") {
          imageUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
          const image = new Image();
          image.src = imageUrl;
          await image.decode();
          if (!disposed) {
            setFailure(null);
            setAsset({ src, kind: "image", image, count: 1 });
          }
        } else
          throw new Error("This viewer supports PDF, JPG, and PNG documents.");
      } catch (err) {
        if (!disposed)
          setFailure({
            src,
            message:
              err instanceof Error
                ? err.message
                : "The document could not be loaded.",
          });
      }
    }
    void load();
    return () => {
      disposed = true;
      abort.abort();
      void loadingTask?.destroy().catch(() => {});
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [src, mime]);

  useEffect(() => {
    if (!currentAsset) return;
    let disposed = false;
    async function loadPage() {
      try {
        if (currentAsset?.kind === "pdf") {
          const pdfPage = await currentAsset.document.getPage(activePage);
          const viewport = pdfPage.getViewport({ scale: 1 });
          // The default viewport includes the PDF's intrinsic rotation. Extraction
          // boxes use this same displayed orientation and normalized coordinates.
          if (!disposed)
            setPageData({
              src,
              number: activePage,
              width: viewport.width,
              height: viewport.height,
              pdfPage,
            });
        } else if (currentAsset?.kind === "image") {
          await Promise.resolve();
          if (!disposed)
            setPageData({
              src,
              number: activePage,
              width: currentAsset.image.naturalWidth,
              height: currentAsset.image.naturalHeight,
              pdfPage: null,
            });
        }
      } catch (err) {
        if (!disposed)
          setPageFailure({
            src,
            page: activePage,
            message:
              err instanceof Error
                ? err.message
                : "This page could not be loaded.",
          });
      }
    }
    void loadPage();
    return () => {
      disposed = true;
    };
  }, [currentAsset, activePage, src]);

  useEffect(() => {
    if (!currentPage || !currentAsset || !canvasRef.current) return;
    let disposed = false;
    let localTask: RenderTask | null = null;
    const canvas = canvasRef.current;
    const previous = taskRef.current;
    previous?.cancel();
    async function render() {
      try {
        // A cancelled PDF.js render must release its canvas before it is reused.
        if (previous) await previous.promise.catch(() => {});
        else await Promise.resolve();
        if (disposed || !currentPage || !currentAsset) return;
        setRenderedKey(null);
        const pixelRatio = Math.max(
          0.25,
          Math.min(
            window.devicePixelRatio || 1,
            2,
            Math.sqrt(16_000_000 / Math.max(1, width * height)),
          ),
        );
        canvas.width = Math.max(1, Math.floor(width * pixelRatio));
        canvas.height = Math.max(1, Math.floor(height * pixelRatio));
        if (currentPage.pdfPage) {
          localTask = currentPage.pdfPage.render({
            canvas,
            viewport: currentPage.pdfPage.getViewport({ scale }),
            transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
            background: "white",
          });
          taskRef.current = localTask;
          await localTask.promise;
        } else if (currentAsset.kind === "image") {
          const context = canvas.getContext("2d");
          if (!context)
            throw new Error(
              "Your browser could not initialize the drawing viewer.",
            );
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(
            currentAsset.image,
            0,
            0,
            canvas.width,
            canvas.height,
          );
        }
        if (!disposed) {
          setRenderFailure(null);
          setRenderedKey(renderKey);
        }
      } catch (err) {
        if (!disposed)
          setRenderFailure({
            key: renderKey,
            message:
              err instanceof Error
                ? err.message
                : "This drawing could not be rendered.",
          });
      }
    }
    void render();
    return () => {
      disposed = true;
      localTask?.cancel();
    };
  }, [currentPage, currentAsset, width, height, scale, renderKey]);

  useLayoutEffect(() => {
    const center = pendingCenter.current;
    const scroll = scrollRef.current;
    const sheet = sheetRef.current;
    if (!center || !scroll || !sheet) return;
    const sheetBounds = sheet.getBoundingClientRect();
    const scrollBounds = scroll.getBoundingClientRect();
    scroll.scrollLeft +=
      sheetBounds.left -
      scrollBounds.left +
      center.x * width -
      scroll.clientWidth / 2;
    scroll.scrollTop +=
      sheetBounds.top -
      scrollBounds.top +
      center.y * height -
      scroll.clientHeight / 2;
    pendingCenter.current = null;
  }, [width, height]);

  useEffect(() => {
    const element = elements.find(
      (item) => item.id === selectedId && item.page === activePage,
    );
    const scroll = scrollRef.current;
    const sheet = sheetRef.current;
    if (!element || !scroll || !sheet || !isRendered || !showAnnotations)
      return;
    const sheetBounds = sheet.getBoundingClientRect();
    const scrollBounds = scroll.getBoundingClientRect();
    scroll.scrollTo({
      left:
        scroll.scrollLeft +
        sheetBounds.left -
        scrollBounds.left +
        (element.bbox.x + element.bbox.width / 2) * width -
        scroll.clientWidth / 2,
      top:
        scroll.scrollTop +
        sheetBounds.top -
        scrollBounds.top +
        (element.bbox.y + element.bbox.height / 2) * height -
        scroll.clientHeight / 2,
      behavior: "smooth",
    });
  }, [
    selectedId,
    activePage,
    elements,
    isRendered,
    showAnnotations,
    width,
    height,
  ]);

  function changeZoom(next: number) {
    const scroll = scrollRef.current;
    const sheet = sheetRef.current;
    if (scroll && sheet && width && height) {
      const bounds = sheet.getBoundingClientRect();
      const container = scroll.getBoundingClientRect();
      pendingCenter.current = {
        x: (container.left + scroll.clientWidth / 2 - bounds.left) / width,
        y: (container.top + scroll.clientHeight / 2 - bounds.top) / height,
      };
    }
    setFit(false);
    setManualScale(clampZoom(next));
  }

  function goToPage(value: string) {
    const number = Number(value);
    if (Number.isInteger(number) && pageCount)
      onPageChange(Math.max(1, Math.min(pageCount, number)));
  }

  return (
    <section
      className="plan-canvas"
      aria-label="Original document viewer"
      aria-busy={!error && !isRendered}
    >
      <div className="plan-canvas-toolbar">
        <div className="plan-canvas-page-controls">
          <FileText
            size={15}
            aria-hidden="true"
            className="plan-canvas-file-icon"
          />
          <button
            type="button"
            title="Previous page"
            aria-label="Previous page"
            onClick={() => onPageChange(activePage - 1)}
            disabled={!pageCount || activePage <= 1}
          >
            <ChevronLeft size={16} />
          </button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem(
                "page",
              ) as HTMLInputElement;
              goToPage(input.value);
              input.blur();
            }}
          >
            <label className="plan-canvas-page-label">
              Page{" "}
              <input
                key={`${src}:${activePage}`}
                name="page"
                aria-label="PDF page number"
                type="number"
                min={1}
                max={pageCount || undefined}
                defaultValue={activePage}
                onBlur={(event) => {
                  goToPage(event.currentTarget.value);
                  event.currentTarget.value = String(activePage);
                }}
                disabled={!pageCount}
              />
            </label>
            <span className="plan-canvas-page-count">
              of {pageCount || "—"}
            </span>
          </form>
          <button
            type="button"
            title="Next page"
            aria-label="Next page"
            onClick={() => onPageChange(activePage + 1)}
            disabled={!pageCount || activePage >= pageCount}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="plan-canvas-zoom-controls">
          <button
            type="button"
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => changeZoom(scale / 1.25)}
            disabled={!currentPage || scale <= 0.1}
          >
            <Minus size={15} />
          </button>
          <span className="plan-canvas-zoom-value" aria-live="polite">
            {currentPage ? `${Math.round(scale * 100)}%` : "—"}
          </span>
          <button
            type="button"
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => changeZoom(scale * 1.25)}
            disabled={!currentPage || scale >= 4}
          >
            <Plus size={15} />
          </button>
          <span className="plan-canvas-toolbar-divider" />
          <button
            type="button"
            className={`plan-canvas-fit ${fit ? "is-active" : ""}`}
            title="Fit entire sheet"
            aria-label="Fit entire sheet"
            onClick={() => {
              setFit(true);
              pendingCenter.current = { x: 0.5, y: 0.5 };
            }}
            disabled={!currentPage}
          >
            <Expand size={14} />
            <span>Fit sheet</span>
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className={`plan-canvas-scroll ${panning ? "is-panning" : ""}`}
        tabIndex={0}
        aria-label="Drawing. Drag the sheet to pan, or scroll to move around."
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target as HTMLElement).closest("button")
          )
            return;
          const scroll = event.currentTarget;
          pan.current = {
            x: event.clientX,
            y: event.clientY,
            left: scroll.scrollLeft,
            top: scroll.scrollTop,
            pointerId: event.pointerId,
          };
          scroll.setPointerCapture(event.pointerId);
          setPanning(true);
        }}
        onPointerMove={(event) => {
          if (pan.current) {
            event.currentTarget.scrollLeft =
              pan.current.left - event.clientX + pan.current.x;
            event.currentTarget.scrollTop =
              pan.current.top - event.clientY + pan.current.y;
          }
        }}
        onPointerUp={(event) => {
          if (pan.current) {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
            pan.current = null;
            setPanning(false);
          }
        }}
        onPointerCancel={() => {
          pan.current = null;
          setPanning(false);
        }}
        onLostPointerCapture={() => {
          pan.current = null;
          setPanning(false);
        }}
      >
        {currentPage && (
          <div
            className="plan-canvas-surface"
            style={{
              width: Math.max(size.width, width + 48),
              minHeight: Math.max(size.height, height + 48),
            }}
          >
            <div
              ref={sheetRef}
              className="plan-canvas-sheet"
              style={{ width, height }}
            >
              <canvas
                ref={canvasRef}
                role="img"
                aria-label={`Original ${mime === "application/pdf" ? "PDF" : "image"}, page ${activePage}`}
                style={{ width, height, opacity: isRendered ? 1 : 0.3 }}
              />
              {showAnnotations && isRendered && (
                <div
                  className="plan-canvas-annotations"
                  aria-label="Extracted drawing evidence"
                >
                  {visibleElements.map((element) => (
                    <button
                      key={element.id}
                      type="button"
                      className={`plan-canvas-annotation kind-${element.kind} ${selectedId === element.id ? "is-selected" : ""}`}
                      data-testid="plan-annotation"
                      data-element-id={element.id}
                      data-kind={element.kind}
                      aria-label={`${kindLabels[element.kind]}: ${element.label}, page ${element.page}`}
                      aria-pressed={selectedId === element.id}
                      title={`${kindLabels[element.kind]} · ${element.label} · Unreviewed extraction`}
                      onClick={() => onSelect(element.id)}
                      style={{
                        left: `${element.bbox.x * 100}%`,
                        top: `${element.bbox.y * 100}%`,
                        width: `${element.bbox.width * 100}%`,
                        height: `${element.bbox.height * 100}%`,
                      }}
                    >
                      <span className="plan-canvas-annotation-label">
                        {element.label}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {!error && !isRendered && (
          <div className="plan-canvas-state" role="status">
            <LoaderCircle size={23} className="plan-canvas-spinner" />
            <strong>
              {!currentAsset
                ? "Loading original document"
                : !currentPage
                  ? `Loading page ${activePage}`
                  : `Rendering page ${activePage}`}
            </strong>
            <span>
              {!currentAsset
                ? "Securely retrieving your uploaded file…"
                : "Preparing the drawing and its source coordinates…"}
            </span>
          </div>
        )}
        {error && (
          <div className="plan-canvas-state plan-canvas-error" role="alert">
            <AlertCircle size={26} />
            <strong>Unable to display the document</strong>
            <span>{error}</span>
            <span>
              You can still review any extracted evidence in the side panel.
            </span>
          </div>
        )}
      </div>
      <div className="plan-canvas-footer">
        <span>
          <Hand size={12} aria-hidden="true" />
          Drag to pan · Scroll to explore
        </span>
        <span>
          {showAnnotations && isRendered
            ? `${visibleElements.length} extracted annotations`
            : "Original document"}
          <span className="plan-canvas-footer-dot">·</span>Page {activePage}
          {pageCount ? ` / ${pageCount}` : ""}
        </span>
      </div>
    </section>
  );
}

export default PlanCanvas;
