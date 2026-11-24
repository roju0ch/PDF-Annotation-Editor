import { useAnnotationRaster } from "./app/useAnnotationRaster";
import type { SurfaceMap } from "./app/rasterSurfaces";
import { usePdfRaster } from "./app/usePdfRaster";
import { visibleTilePlan } from "./core/render/tiles";
import { PageOrganizer } from "./app/PageOrganizer";
import { AnnotationContextMenu } from "./app/AnnotationContextMenu";
import { FreeTextDialog } from "./app/FreeTextDialog";
import { useDocumentDiscardDialog } from "./app/DocumentDiscardDialog";
import { useAnnotations } from "./app/useAnnotations";
import {
  AnnotationToolbar,
  AnnotationPanel,
  DirectTools,
} from "./app/AnnotationToolbar";
import {
  MenuHeading,
  Icon,
  useMenuKeyboard,
  openControlSelector,
  openMenuSelector,
} from "./app/CompactMenu";
import { AnnotationOverlay } from "./app/AnnotationOverlay";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { PdfClient } from "./adapters/pdf/client";
import {
  type PdfFile,
  usesNativeSave,
  supportsPdfSave,
  PDF_SAVE_UNAVAILABLE,
} from "./adapters/platform/savePdf";
import {
  PDF_OPEN_MESSAGES as messages,
  type PdfOpenOutcome,
  pickDesktopPdf,
} from "./adapters/platform/openPdf";
import { usePdfOpen } from "./app/usePdfOpen";
import { usePdfWindows } from "./app/usePdfWindows";
import {
  newPdfWindow,
  supportsMultiplePdfWindows,
} from "./adapters/platform/pdfWindows";
import type { PageInfo } from "./adapters/pdf/types";
import {
  fit,
  scrollAxis,
  scrollLimits,
  toWorld,
  wheelPixels,
  zoomAt,
  type Point,
  type View,
} from "./core/viewport";
import "./style.css";
const initial: View = { x: 24, y: 24, scale: 1 };
function inputTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    !!target.closest(
      "input,select,button,a,textarea,[contenteditable]:not([contenteditable=false])",
    )
  );
}
type ScrollLayout = {
  width: number;
  pageWidth: number;
  firstHeight: number;
  lastHeight: number;
  lastTop: number;
};
function verticalLimits(layout: ScrollLayout, box: Point, scale: number) {
  return scrollLimits(
    (layout.lastTop + layout.lastHeight) * scale,
    box.y,
    layout.firstHeight * scale,
    layout.lastHeight * scale,
  );
}
function scrollView(
  view: View,
  box: Point,
  layout: ScrollLayout,
  dx: number,
  dy: number,
): View {
  return {
    ...view,
    x: scrollAxis(
      view.x,
      dx,
      scrollLimits(
        layout.width * view.scale,
        box.x,
        layout.pageWidth * view.scale,
      ),
    ),
    y: scrollAxis(view.y, dy, verticalLimits(layout, box, view.scale)),
  };
}
export default function App() {
  const multipleWindows = supportsMultiplePdfWindows();
  const canSave = supportsPdfSave();
  const exportLabel = !canSave
    ? PDF_SAVE_UNAVAILABLE
    : usesNativeSave()
      ? "PDF speichern unter …"
      : "PDF herunterladen";
  const stage = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    client = useRef<PdfClient | null>(null),
    generation = useRef(0);
  const opening = useRef(false),
    openSequence = useRef(0),
    openingClient = useRef<PdfClient | null>(null);
  const discard = useDocumentDiscardDialog(stage);
  const cancelPendingPointer = useRef<() => void>(() => {});
  const canvases = useRef(new Map<number, HTMLCanvasElement>());
  const detailLayers = useRef(new Map<number, HTMLDivElement>());
  const overviewLayers = useRef(new Map<number, HTMLDivElement>());
  const surfaces = useRef<SurfaceMap>(new Map());
  const [surfaceVersion, setSurfaceVersion] = useState(0);
  const onSurfaceChange = useCallback(
    () => setSurfaceVersion((v) => v + 1),
    [],
  );
  const [pages, setPages] = useState<PageInfo[]>([]),
    [fileInfo, setFileInfo] = useState<PdfFile>({ fileName: "" }),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0),
    [continuous, setContinuous] = useState(true),
    [view, setView] = useState<View>(initial);
  const [box, setBox] = useState<Point>({ x: 800, y: 600 });
  const [rendering, setRendering] = useState(false);
  const offsets = useMemo(() => {
    let y = 0;
    return pages.map((p) => {
      const top = y;
      y += p.height + 24;
      return top;
    });
  }, [pages]);
  const tops = useMemo(
    () => pages.map((_, i) => (continuous ? offsets[i] : 0)),
    [pages, continuous, offsets],
  );
  const documentWidth = useMemo(
    () => pages.reduce((width, info) => Math.max(width, info.width), 0),
    [pages],
  );
  const scrollLayout = useMemo(() => {
    const first = continuous ? 0 : page;
    const last = continuous ? pages.length - 1 : page;
    const pageWidth = pages[page]?.width ?? 0;
    return {
      width: continuous ? documentWidth : pageWidth,
      pageWidth,
      firstHeight: pages[first]?.height ?? 0,
      lastHeight: pages[last]?.height ?? 0,
      lastTop: tops[last] ?? 0,
    };
  }, [continuous, documentWidth, page, pages, tops]);
  const [contentRevision, setContentRevision] = useState(0);
  const invalidate = useCallback((structural = false) => {
    if (structural) setContentRevision((v) => v + 1);
  }, []);
  const pageContext = useRef({ pages, page, continuous, box });
  useEffect(() => {
    pageContext.current = { pages, page, continuous, box };
  }, [pages, page, continuous, box]);
  const pagesChanged = useCallback((next: PageInfo[], focusPage?: number) => {
    const cur = pageContext.current;
    const retained = next.findIndex((p) => p.id === cur.pages[cur.page]?.id);
    const index =
      focusPage ??
      (retained >= 0 ? retained : Math.min(cur.page, next.length - 1));
    setPages(next);
    setPage(index);
    const fitted = fit(next[index].width, next[index].height, cur.box);
    if (cur.continuous)
      fitted.y -=
        next.slice(0, index).reduce((sum, p) => sum + p.height + 24, 0) *
        fitted.scale;
    setView(fitted);
  }, []);
  const name = fileInfo.fileName;
  const annotation = useAnnotations(
    client,
    { view, pages, tops, continuous, page, box },
    fileInfo,
    setFileInfo,
    invalidate,
    setError,
    pagesChanged,
  );
  usePdfWindows(
    {
      hasDocument: pages.length > 0,
      unsaved: annotation.unsaved,
      busy: annotation.busy || loading,
      fileName: name,
      pageCount: pages.length,
    },
    () => discard.request("close"),
    setError,
  );
  const { escape: escapeEditor, contextMenu } = annotation;
  const escape = useCallback(
    (event: KeyboardEvent) => {
      cancelPendingPointer.current();
      const handled = escapeEditor(event);
      if (handled && contextMenu) stage.current?.focus({ preventScroll: true });
      return handled;
    },
    [escapeEditor, contextMenu],
  );
  useMenuKeyboard(escape);
  const annotationInput = useRef(annotation.gesture);
  useEffect(() => {
    annotationInput.current = annotation.gesture;
  });
  const current = useRef({ box, pages, scrollLayout });
  useEffect(() => {
    current.current = { box, pages, scrollLayout };
  }, [box, pages, scrollLayout]);
  const updateView = useCallback((fn: (v: View) => View) => {
    setView(fn);
  }, []);
  const fitPage = useCallback(
    (i: number, width = false, mode = continuous) => {
      if (!pages[i]) return;
      const next = fit(pages[i].width, pages[i].height, box, width);
      next.y -= (mode ? offsets[i] : 0) * next.scale;
      updateView(() => next);
    },
    [pages, box, offsets, continuous, updateView],
  );
  const navigate = (i: number) => {
    setPage(i);
    fitPage(i);
  };
  const keyNavigate = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      e.target !== e.currentTarget ||
      e.defaultPrevented ||
      e.nativeEvent.isComposing ||
      e.altKey ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      !pages.length ||
      loading ||
      annotation.formDirty ||
      annotation.gesture.active() ||
      document.querySelector(openControlSelector)
    )
      return;

    const arrowStep = 40;
    const screenStep = box.y * 0.9;
    const goToPageEdge = (index: number, edge: "start" | "end") => {
      const { width, height } = pages[index];
      setPage(index);
      updateView((v) => {
        const x = scrollLimits(width * v.scale, box.x);
        const y = continuous
          ? verticalLimits(scrollLayout, box, v.scale)
          : scrollLimits(height * v.scale, box.y);
        return { ...v, x: Math.min(x.start, Math.max(x.end, v.x)), y: y[edge] };
      });
    };
    const move = (dx: number, dy: number) =>
      updateView((v) => scrollView(v, box, scrollLayout, dx, dy));
    switch (e.key) {
      case "ArrowLeft":
        move(-arrowStep, 0);
        break;
      case "ArrowRight":
        move(arrowStep, 0);
        break;
      case "ArrowUp":
        move(0, -arrowStep);
        break;
      case "ArrowDown":
        move(0, arrowStep);
        break;
      case "PageUp":
      case "PageDown": {
        const forward = e.key === "PageDown";
        const delta = forward ? screenStep : -screenStep;
        const nextPage = page + (forward ? 1 : -1);
        const y = scrollAxis(
          view.y,
          delta,
          verticalLimits(scrollLayout, box, view.scale),
        );
        if (!continuous && pages[nextPage] && Math.abs(y - view.y) < 1e-6)
          goToPageEdge(nextPage, forward ? "start" : "end");
        else move(0, delta);
        break;
      }
      case "Home":
        goToPageEdge(0, "start");
        break;
      case "End":
        goToPageEdge(pages.length - 1, "end");
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  useEffect(() => {
    const el = stage.current!;
    const observer = new ResizeObserver(([entry]) =>
      setBox({ x: entry.contentRect.width, y: entry.contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(
    () => () => {
      generation.current++;
      openSequence.current++;
      openingClient.current?.dispose();
      client.current?.dispose();
    },
    [],
  );
  useEffect(() => {
    const el = stage.current!;
    let space = false;
    let hold: ReturnType<typeof setTimeout> | undefined;
    let holdStart: Point | null = null;
    let deferredTouch: Point | null = null;
    const consumed = new Set<number>();
    const clearHold = () => {
      clearTimeout(hold);
      hold = undefined;
      holdStart = null;
      deferredTouch = null;
    };
    cancelPendingPointer.current = clearHold;
    const points = new Map<number, Point>();
    let drag: Point | null = null;
    let trackpadScale: number | null = null;
    let middlePasteBlocked = false;
    const local = (e: { clientX: number; clientY: number }): Point => {
      const b = el.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const wheel = (e: WheelEvent) => {
      clearHold();
      annotationInput.current.closeContext();
      const { pages, box, scrollLayout } = current.current;
      if (!pages.length) return;
      e.preventDefault();
      annotationInput.current.cancel();
      const mode = e.deltaMode;
      const dy = wheelPixels(e.deltaY, mode, box.y);
      if (e.ctrlKey) {
        if (trackpadScale !== null) return;
        const anchor = local(e);
        updateView((v) =>
          zoomAt(
            v,
            anchor,
            Math.exp(-Math.max(-200, Math.min(200, dy)) * 0.002),
          ),
        );
      } else {
        const dx = wheelPixels(e.deltaX, mode, box.x);
        updateView((v) => scrollView(v, box, scrollLayout, dx, dy));
      }
    };
    // Safari and WKWebView can send cumulative gesture scales for trackpad pinch.
    const trackpadPinch = (event: Event) => {
      if (event.type === "gesturestart") {
        if (!current.current.pages.length || points.size || drag) return;
        event.preventDefault();
        clearHold();
        annotationInput.current.closeContext();
        annotationInput.current.cancel();
        trackpadScale = 1;
        return;
      }
      if (trackpadScale === null) return;
      event.preventDefault();
      if (event.type === "gestureend") {
        trackpadScale = null;
        return;
      }
      const e = event as Event & {
        scale: number;
        clientX?: number;
        clientY?: number;
      };
      if (points.size || drag || !Number.isFinite(e.scale) || e.scale <= 0)
        return;
      const { box } = current.current;
      const anchor =
        typeof e.clientX === "number" && typeof e.clientY === "number"
          ? local({ clientX: e.clientX, clientY: e.clientY })
          : { x: box.x / 2, y: box.y / 2 };
      const factor = e.scale / trackpadScale;
      trackpadScale = e.scale;
      updateView((v) => zoomAt(v, anchor, factor));
    };
    const down = (e: PointerEvent) => {
      middlePasteBlocked = e.button === 1;
      // A click outside a menu dismisses it; it must not also draw on the PDF.
      if (document.querySelector(openMenuSelector)) return;
      if (!current.current.pages.length) return;
      annotationInput.current.hover(local(e));
      if (e.pointerType === "touch") {
        points.set(e.pointerId, local(e));
        clearHold();
        if (points.size === 1) {
          const start = local(e),
            screen = { x: e.clientX, y: e.clientY };
          // Preserve the current selection until a hold, tap or drag is known.
          // Otherwise touching another object inside the group frame replaces it.
          if (annotationInput.current.selectionContextAt(start))
            deferredTouch = start;
          else annotationInput.current.begin(start);
          holdStart = start;
          hold = setTimeout(() => {
            if (annotationInput.current.openContext(start, screen)) {
              consumed.add(e.pointerId);
              points.clear();
            }
            clearHold();
          }, 600);
        } else annotationInput.current.cancel();
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
      } else if (e.button === 1 || (e.button === 0 && space)) {
        annotationInput.current.cancel();
        drag = local(e);
        el.setPointerCapture(e.pointerId);
        el.classList.add("panning");
        e.preventDefault();
      } else if (e.button === 0 && annotationInput.current.begin(local(e))) {
        el.focus();
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    };
    const move = (e: PointerEvent) => {
      const p = local(e);
      annotationInput.current.hover(p);
      if (holdStart && Math.hypot(p.x - holdStart.x, p.y - holdStart.y) > 8) {
        const start = deferredTouch;
        clearHold();
        if (start && points.size === 1) annotationInput.current.begin(start);
      }
      if (consumed.has(e.pointerId)) return;
      if (points.has(e.pointerId)) {
        const old = [...points.values()];
        points.set(e.pointerId, p);
        const now = [...points.values()];
        if (now.length === 2) {
          const mid = (a: Point[]) => ({
            x: (a[0].x + a[1].x) / 2,
            y: (a[0].y + a[1].y) / 2,
          });
          const dist = (a: Point[]) =>
            Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
          const before = mid(old),
            after = mid(now);
          const factor = dist(old) > 2 ? dist(now) / dist(old) : 1;
          updateView((v) => {
            const z = zoomAt(v, before, factor);
            return {
              ...z,
              x: z.x + after.x - before.x,
              y: z.y + after.y - before.y,
            };
          });
        } else if (now.length === 1 && annotationInput.current.active()) {
          annotationInput.current.move(p);
        } else if (now.length === 1 && !deferredTouch)
          updateView((v) => ({
            ...v,
            x: v.x + p.x - old[0].x,
            y: v.y + p.y - old[0].y,
          }));
      } else if (drag) {
        const from = drag;
        drag = p;
        updateView((v) => ({
          ...v,
          x: v.x + p.x - from.x,
          y: v.y + p.y - from.y,
        }));
      } else if (annotationInput.current.active()) {
        annotationInput.current.move(p);
      }
    };
    const up = (e: PointerEvent) => {
      // Pointer moves can be coalesced; apply the final pan coordinate before
      // releasing capture so the last movement is never lost on Firefox/touchpads.
      if (e.type === "pointerup" && drag) {
        const p = local(e),
          from = drag;
        updateView((v) => ({
          ...v,
          x: v.x + p.x - from.x,
          y: v.y + p.y - from.y,
        }));
      }
      if (e.type === "pointerup" && deferredTouch && !consumed.has(e.pointerId))
        annotationInput.current.begin(deferredTouch);
      clearHold();
      if (consumed.delete(e.pointerId)) {
        e.preventDefault();
        annotationInput.current.cancel();
        points.delete(e.pointerId);
        return;
      }
      if (e.type === "pointerup") annotationInput.current.finish();
      else annotationInput.current.cancel();
      points.delete(e.pointerId);
      drag = null;
      el.classList.remove("panning");
    };
    const keydown = (e: KeyboardEvent) => {
      middlePasteBlocked = false;
      if (
        e.code === "Space" &&
        !e.defaultPrevented &&
        current.current.pages.length &&
        !inputTarget(e.target) &&
        !document.querySelector(openControlSelector)
      ) {
        space = true;
        e.preventDefault();
      }
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.code === "Space") space = false;
    };
    const reset = () => {
      middlePasteBlocked = false;
      clearHold();
      consumed.clear();
      annotationInput.current.cancel();
      space = false;
      drag = null;
      trackpadScale = null;
      points.clear();
      el.classList.remove("panning");
    };
    const context = (e: MouseEvent) => {
      clearHold();
      if (
        annotationInput.current.openContext(local(e), {
          x: e.clientX,
          y: e.clientY,
        })
      ) {
        e.preventDefault();
        for (const id of points.keys()) consumed.add(id);
        points.clear();
      }
    };
    const leave = () => annotationInput.current.hover(null);
    const aux = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    const preventMiddlePaste = (e: ClipboardEvent) => {
      // Some Linux browsers dispatch primary-selection paste asynchronously,
      // even when the compatibility mouse events were cancelled. The next
      // pointer/keyboard action (including Ctrl+V) restores normal paste.
      if (middlePasteBlocked && !inputTarget(e.target)) e.preventDefault();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("gesturestart", trackpadPinch, { passive: false });
    el.addEventListener("gesturechange", trackpadPinch, { passive: false });
    el.addEventListener("gestureend", trackpadPinch, { passive: false });
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
    // Linux middle-click can paste the primary selection on mouseup before
    // auxclick. Reserve both compatibility mouse events for PDF panning.
    el.addEventListener("mousedown", aux);
    el.addEventListener("mouseup", aux);
    el.addEventListener("auxclick", aux);
    el.addEventListener("contextmenu", context);
    el.addEventListener("pointerleave", leave);
    window.addEventListener("paste", preventMiddlePaste, true);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", reset);
    return () => {
      cancelPendingPointer.current = () => {};
      clearHold();
      el.removeEventListener("contextmenu", context);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("gesturestart", trackpadPinch);
      el.removeEventListener("gesturechange", trackpadPinch);
      el.removeEventListener("gestureend", trackpadPinch);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("lostpointercapture", up);
      el.removeEventListener("mousedown", aux);
      el.removeEventListener("mouseup", aux);
      el.removeEventListener("auxclick", aux);
      window.removeEventListener("paste", preventMiddlePaste, true);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", reset);
    };
  }, [updateView]);
  const visible = pages
    .map((p, i) => ({ p, i, top: tops[i] }))
    .filter(({ p, i, top }) =>
      continuous
        ? (top + p.height) * view.scale + view.y > -200 &&
          top * view.scale + view.y < box.y + 200
        : i === page,
    )
    .sort(
      (a, b) =>
        Math.abs((a.top + a.p.height / 2) * view.scale + view.y - box.y / 2) -
        Math.abs((b.top + b.p.height / 2) * view.scale + view.y - box.y / 2),
    )
    .slice(0, 6);
  const tiles = visibleTilePlan(
    pages,
    tops,
    visible.map(({ i }) => i),
    view,
    box,
    window.devicePixelRatio || 1,
  );
  usePdfRaster({
    client,
    canvases,
    layers: detailLayers,
    overviewLayers,
    surfaces,
    onSurfaceChange,
    pages,
    tiles,
    visible: visible.map(({ i }) => i),
    revision: contentRevision,
    onRendering: setRendering,
    onError: setError,
  });
  useAnnotationRaster({
    client,
    surfaces,
    surfaceVersion,
    revision: annotation.state.revision,
    onError: setError,
    onRendered: annotation.displayed,
  });
  useEffect(() => {
    if (!continuous || !pages.length || annotation.formDirty) return;
    const center = toWorld({ x: box.x / 2, y: box.y / 2 }, view).y;
    let closest = 0;
    let distance = Infinity;
    pages.forEach((p, i) => {
      const d = Math.max(tops[i] - center, center - (tops[i] + p.height), 0);
      if (d < distance) {
        distance = d;
        closest = i;
      }
    });
    setPage(closest);
  }, [view, box, continuous, pages, tops, annotation.formDirty]);
  usePdfOpen(!annotation.busy && !loading, open, setError);
  async function open(file: File, sourceId?: string): Promise<PdfOpenOutcome> {
    if (opening.current || !annotation.beginDocumentChange()) {
      setError("Bitte warten, bis die PDF-Verarbeitung abgeschlossen ist.");
      return "deferred";
    }
    opening.current = true;
    const token = ++openSequence.current;
    let candidate: PdfClient | null = null;
    try {
      if (annotation.unsaved && !(await discard.request())) return "handled";
      setError("");
      setLoading(true);
      if (file.size > 100 * 1024 * 1024 || file.size < 5)
        throw new Error(messages.badFile);
      const data = await file.arrayBuffer();
      if (token !== openSequence.current) return "handled";
      if (new TextDecoder().decode(data.slice(0, 1024)).indexOf("%PDF-") < 0)
        throw new Error(messages.badFile);
      candidate = new PdfClient();
      openingClient.current = candidate;
      const result = await candidate.request({ type: "open", data });
      if (token !== openSequence.current) return "handled";
      const infos = result.pages;
      if (!infos?.length || !result.editor) throw new Error(messages.badFile);
      // Commit only after the existing parser has accepted the whole document.
      // Invalid files leave the old worker, annotations and unsaved edits intact.
      cancelPendingPointer.current();
      const previous = client.current;
      client.current = candidate;
      candidate = null;
      openingClient.current = null;
      generation.current++;
      annotation.reset(result.editor!);
      setPages(infos);
      setFileInfo({ fileName: file.name, sourceId });
      setPage(0);
      setContinuous(true);
      setRendering(false);
      updateView(() =>
        fit(infos[0].width, infos[0].height, current.current.box),
      );
      if (
        (document.activeElement === document.body ||
          document.activeElement === fileInput.current) &&
        !document.querySelector(openControlSelector)
      )
        stage.current?.focus({ preventScroll: true });
      previous?.dispose();
      return "opened";
    } catch (e) {
      if (token === openSequence.current) {
        setError(
          e instanceof Error ? e.message : "PDF konnte nicht geöffnet werden.",
        );
      }
    } finally {
      candidate?.dispose();
      if (token === openSequence.current) {
        openingClient.current = null;
        opening.current = false;
        annotation.endDocumentChange();
        setLoading(false);
      }
    }
    return "handled";
  }
  const ready = pages.length > 0;
  return (
    <main>
      <header>
        <div className="document-controls">
          <label className="open" title="PDF öffnen">
            <Icon name="open" />
            <span>Öffnen</span>
            <input
              ref={fileInput}
              aria-label="PDF öffnen"
              type="file"
              accept="application/pdf,.pdf"
              onClick={(event) => {
                if (!multipleWindows) return;
                event.preventDefault();
                void pickDesktopPdf().catch((error: Error) =>
                  setError(error.message),
                );
              }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void open(f);
                e.target.value = "";
              }}
            />
          </label>
          <button
            className="view-toggle"
            popoverTarget="view-menu"
            aria-label="Ansicht und Navigation"
            title="Seiten, Zoom und Eingabe"
          >
            <span>
              {page + 1}/{pages.length || "–"}
            </span>
            <span>{Math.round(view.scale * 100)} %</span>
            <Icon name="chevron" />
          </button>
        </div>
        <DirectTools editor={annotation} ready={ready} />
        <div className="document-actions">
          <button
            className="icon-button"
            popoverTarget="pages-menu"
            aria-label="Seitenübersicht"
            title="Seiten sortieren und PDFs hinzufügen"
            disabled={!ready || loading}
          >
            <Icon name="pages" />
          </button>
          <button
            className="icon-button"
            popoverTarget="annotations-menu"
            aria-label="Annotationen anzeigen"
            title="Annotationen und Eigenschaften"
          >
            <Icon name="list" />
          </button>
          <button
            className="icon-button"
            aria-label="Rückgängig"
            title="Rückgängig"
            disabled={
              !ready ||
              annotation.busy ||
              annotation.formDirty ||
              !annotation.state.canUndo
            }
            onClick={() => void annotation.edit({ action: "undo" })}
          >
            <Icon name="undo" />
          </button>
          <button
            className="icon-button"
            aria-label="Wiederholen"
            title="Wiederholen"
            disabled={
              !ready ||
              annotation.busy ||
              annotation.formDirty ||
              !annotation.state.canRedo
            }
            onClick={() => void annotation.edit({ action: "redo" })}
          >
            <Icon name="redo" />
          </button>
          <button
            className="icon-button export"
            aria-label={exportLabel}
            title={exportLabel}
            disabled={
              !canSave ||
              !ready ||
              annotation.busy ||
              annotation.formDirty ||
              !!annotation.state.readOnly
            }
            onClick={() => void annotation.save()}
          >
            <Icon name="download" />
          </button>
        </div>
      </header>
      <section
        id="view-menu"
        popover="auto"
        className="compact-menu view-menu"
        aria-label="Ansicht und Navigation"
      >
        <MenuHeading target="view-menu">Ansicht und Navigation</MenuHeading>
        {multipleWindows && (
          <div className="menu-row">
            <button
              onClick={() => {
                document.getElementById("view-menu")?.hidePopover();
                void newPdfWindow().catch((failure: unknown) =>
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "Ein weiteres PDF-Fenster konnte nicht geöffnet werden.",
                  ),
                );
              }}
              title="Neues PDF-Fenster"
            >
              Neues Fenster
            </button>
          </div>
        )}
        <div className="menu-row">
          <button
            disabled={!ready || annotation.formDirty || page === 0}
            onClick={() => navigate(page - 1)}
            aria-label="Vorherige Seite"
          >
            ←
          </button>
          <label className="page-number">
            Seite{" "}
            <input
              aria-label="Seite"
              type="number"
              min="1"
              max={pages.length || 1}
              value={page + 1}
              disabled={!ready || annotation.formDirty}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 1 && n <= pages.length)
                  navigate(n - 1);
              }}
            />{" "}
            / {pages.length || "–"}
          </label>
          <button
            disabled={
              !ready || annotation.formDirty || page === pages.length - 1
            }
            onClick={() => navigate(page + 1)}
            aria-label="Nächste Seite"
          >
            →
          </button>
        </div>
        <div className="menu-row">
          <button
            disabled={!ready}
            onClick={() =>
              updateView((v) =>
                zoomAt(v, { x: box.x / 2, y: box.y / 2 }, 1 / 1.2),
              )
            }
            aria-label="Verkleinern"
          >
            −
          </button>
          <output aria-label="Zoom">{Math.round(view.scale * 100)} %</output>
          <button
            disabled={!ready}
            onClick={() =>
              updateView((v) => zoomAt(v, { x: box.x / 2, y: box.y / 2 }, 1.2))
            }
            aria-label="Vergrößern"
          >
            +
          </button>
        </div>
        <div className="menu-row">
          <button disabled={!ready} onClick={() => fitPage(page)}>
            Seite einpassen
          </button>
          <button disabled={!ready} onClick={() => fitPage(page, true)}>
            Breite
          </button>
        </div>
        <label className="menu-field">
          Seitenansicht
          <select
            aria-label="Ansicht"
            disabled={!ready || annotation.formDirty}
            value={continuous ? "continuous" : "single"}
            onChange={(e) => {
              const mode = e.target.value === "continuous";
              setContinuous(mode);
              fitPage(page, false, mode);
            }}
          >
            <option value="continuous">Fortlaufend</option>
            <option value="single">Einzelblatt</option>
          </select>
        </label>
        <p className="small">
          Mausrad scrollt. Strg (Ctrl) + Mausrad oder Pinch auf dem Trackpad
          zoomt. Mitteltaste oder Leertaste + Ziehen verschiebt die Ansicht. Auf
          dem Touchscreen mit zwei Fingern zoomen und verschieben.
        </p>
        <a
          href="https://github.com/roju0ch/PDF-Annotation-Editor"
          target="_blank"
          rel="noreferrer"
        >
          Prototyp · Quellcode · AGPL
        </a>
      </section>
      <input
        ref={annotation.imageInput}
        type="file"
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        aria-label="Bilddatei auswählen"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) annotation.imageFile(file);
        }}
      />
      <AnnotationToolbar editor={annotation} ready={ready} />
      <FreeTextDialog editor={annotation} returnFocus={stage} />
      {discard.dialog}
      <PageOrganizer
        key={generation.current}
        pages={pages}
        page={page}
        client={client}
        editor={annotation}
        navigate={navigate}
        documentKey={generation.current}
        onError={setError}
      />
      {error && (
        <div role="alert" className="error">
          {error}
          <button onClick={() => setError("")} aria-label="Meldung schließen">
            ×
          </button>
        </div>
      )}
      <div className="workspace">
        <div
          ref={stage}
          className="stage"
          data-testid="viewport"
          tabIndex={0}
          aria-label="PDF-Arbeitsfläche"
          aria-busy={loading}
          onKeyDown={keyNavigate}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) void open(f);
          }}
        >
          {!ready && (
            <div className="empty">
              <div className="paper-icon">PDF</div>
              <h1>
                {loading ? "PDF wird geöffnet …" : "Platz für Ihre Pläne."}
              </h1>
              <p>PDF hier ablegen oder oben öffnen.</p>
              <p className="muted">
                Ihre Datei bleibt auf diesem Gerät.
                <br />
                Lokale Darstellung · keine Anmeldung · kein Upload
              </p>
            </div>
          )}
          {ready && (
            <div
              key={generation.current}
              className="world"
              data-testid="world"
              style={{
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              }}
            >
              {(continuous
                ? pages.map((p, i) => ({ p, i }))
                : [{ p: pages[page], i: page }]
              ).map(({ p, i }) => (
                <div
                  className="sheet"
                  key={i}
                  data-testid={`page-${i}`}
                  style={{ top: tops[i], width: p.width, height: p.height }}
                >
                  <span className="page-label">{i + 1}</span>
                  <AnnotationOverlay
                    editor={annotation}
                    info={p}
                    page={i}
                    scale={view.scale}
                  />
                  {visible.some((v) => v.i === i) && (
                    <canvas
                      aria-label={`PDF-Seite ${i + 1}`}
                      ref={(el) => {
                        if (el) canvases.current.set(i, el);
                        else canvases.current.delete(i);
                      }}
                      style={{ width: p.width, height: p.height }}
                    />
                  )}
                  {visible.some((v) => v.i === i) && (
                    <div
                      className="annotation-overview-layer"
                      aria-hidden="true"
                      ref={(el) => {
                        if (el) overviewLayers.current.set(i, el);
                        else overviewLayers.current.delete(i);
                      }}
                    />
                  )}
                  {visible.some((v) => v.i === i) && (
                    <div
                      className="detail-layer"
                      aria-hidden="true"
                      ref={(el) => {
                        if (el) detailLayers.current.set(i, el);
                        else detailLayers.current.delete(i);
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <AnnotationPanel editor={annotation} page={page} />
      </div>
      {annotation.contextMenu && (
        <AnnotationContextMenu
          editor={annotation}
          context={annotation.contextMenu}
          stage={stage}
        />
      )}
      <footer>
        {annotation.selection.length > 1 && (
          <span className="selection-count" role="status">
            {annotation.selection.length} ausgewählt
          </span>
        )}
        <span className="edit-status" role="status">
          {annotation.busy
            ? "Verarbeitung …"
            : annotation.unsaved
              ? "Ungesicherte Änderungen"
              : ""}
          {annotation.notice && !annotation.busy
            ? `${annotation.unsaved ? " · " : ""}${annotation.notice}`
            : ""}
        </span>
        <span className="filename">{name || "Keine Datei geöffnet"}</span>
        <span className="document-status">
          {loading
            ? "Wird geöffnet …"
            : rendering
              ? "Details werden geladen …"
              : ready
                ? `${pages.length} Seiten · ${annotation.state.readOnly ? "Nur Ansicht" : "Native Annotationen"}`
                : "Bereit"}
        </span>
      </footer>
    </main>
  );
}
