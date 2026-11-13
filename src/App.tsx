import { useAnnotations } from "./app/useAnnotations";
import { AnnotationToolbar, AnnotationPanel } from "./app/AnnotationToolbar";
import { AnnotationOverlay } from "./app/AnnotationOverlay";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PdfClient } from "./adapters/pdf/client";
import type { PageInfo } from "./adapters/pdf/types";
import {
  fit,
  toWorld,
  wheelPixels,
  zoomAt,
  type Point,
  type View,
} from "./core/viewport";
import "./style.css";
const initial: View = { x: 24, y: 24, scale: 1 };
const messages = {
  badFile: "Bitte eine gültige PDF-Datei auswählen (maximal 100 MB).",
};
function inputTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    !!target.closest("input,select,button,a,textarea")
  );
}
export default function App() {
  const stage = useRef<HTMLDivElement>(null),
    client = useRef<PdfClient | null>(null),
    generation = useRef(0);
  const canvases = useRef(new Map<number, HTMLCanvasElement>());
  const cache = useRef(new Map<string, ImageData>());
  const [pages, setPages] = useState<PageInfo[]>([]),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0),
    [continuous, setContinuous] = useState(false),
    [view, setView] = useState<View>(initial);
  const [box, setBox] = useState<Point>({ x: 800, y: 600 });
  const [profile, setProfile] = useState<"mouse" | "trackpad">(() => {
    try {
      return localStorage.getItem("input-profile") === "trackpad"
        ? "trackpad"
        : "mouse";
    } catch {
      return "mouse";
    }
  });
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
  const [renderRevision, setRenderRevision] = useState(0);
  const invalidate = useCallback(() => {
    cache.current.clear();
    setRenderRevision((v) => v + 1);
  }, []);
  const annotation = useAnnotations(
    client,
    { view, pages, tops, continuous, page },
    name,
    invalidate,
    setError,
  );
  const annotationInput = useRef(annotation.gesture);
  useEffect(() => {
    annotationInput.current = annotation.gesture;
  });
  const current = useRef({ view, box, profile, pages, tops, continuous, page });
  useEffect(() => {
    current.current = { view, box, profile, pages, tops, continuous, page };
  }, [view, box, profile, pages, tops, continuous, page]);
  const updateView = useCallback((fn: (v: View) => View) => {
    setView((v) => {
      const next = fn(v);
      current.current.view = next;
      return next;
    });
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
      client.current?.dispose();
    },
    [],
  );
  useEffect(() => {
    try {
      localStorage.setItem("input-profile", profile);
    } catch {
      /* optional preference storage */
    }
  }, [profile]);
  useEffect(() => {
    const el = stage.current!;
    let space = false;
    const points = new Map<number, Point>();
    let drag: Point | null = null;
    const local = (e: { clientX: number; clientY: number }): Point => {
      const b = el.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const wheel = (e: WheelEvent) => {
      if (!current.current.pages.length) return;
      e.preventDefault();
      annotationInput.current.cancel();
      const dy = wheelPixels(e.deltaY, e.deltaMode, el.clientHeight),
        dx = wheelPixels(e.deltaX, e.deltaMode, el.clientHeight);
      if (current.current.profile === "trackpad" && !e.ctrlKey && !e.metaKey)
        updateView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
      else
        updateView((v) =>
          zoomAt(
            v,
            local(e),
            Math.exp(-Math.max(-200, Math.min(200, dy)) * 0.002),
          ),
        );
    };
    const down = (e: PointerEvent) => {
      if (!current.current.pages.length) return;
      if (e.pointerType === "touch") {
        points.set(e.pointerId, local(e));
        if (points.size === 1) annotationInput.current.begin(local(e));
        else annotationInput.current.cancel();
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
        } else if (now.length === 1)
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
      if (e.type === "pointerup") annotationInput.current.finish();
      else annotationInput.current.cancel();
      points.delete(e.pointerId);
      drag = null;
      el.classList.remove("panning");
    };
    const keydown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !inputTarget(e.target)) {
        space = true;
        e.preventDefault();
      }
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.code === "Space") space = false;
    };
    const reset = () => {
      annotationInput.current.cancel();
      space = false;
      drag = null;
      points.clear();
      el.classList.remove("panning");
    };
    const aux = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
    el.addEventListener("auxclick", aux);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", reset);
    return () => {
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("lostpointercapture", up);
      el.removeEventListener("auxclick", aux);
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
  const rasterScale = Math.pow(
    Math.SQRT2,
    Math.ceil(Math.log2(view.scale * (window.devicePixelRatio || 1)) * 2),
  );
  const renderSpec = JSON.stringify(
    visible.map(({ i }) => ({ page: i, scale: rasterScale })),
  );
  useEffect(() => {
    let cancelled = false;
    const c = client.current;
    const timer = setTimeout(() => {
      void (async () => {
        if (!c) return;
        setRendering(true);
        try {
          const requests = JSON.parse(renderSpec) as {
            page: number;
            scale: number;
          }[];
          for (const r of requests) {
            if (cancelled) break;
            const key = `${r.page}:${r.scale}`;
            let img = cache.current.get(key);
            if (!img) {
              const result = await c.request({ type: "render", ...r });
              if (cancelled) break;
              img = new ImageData(
                result.pixels!,
                result.width!,
                result.height!,
              );
              cache.current.set(key, img);
              while (cache.current.size > 3)
                cache.current.delete(cache.current.keys().next().value!);
            }
            const canvas = canvases.current.get(r.page);
            if (canvas) {
              canvas.width = img.width;
              canvas.height = img.height;
              canvas.getContext("2d")!.putImageData(img, 0, 0);
              canvas.dataset.rendered = "true";
            }
          }
        } catch (e) {
          if (!cancelled)
            setError(
              e instanceof Error ? e.message : "Darstellung fehlgeschlagen.",
            );
        } finally {
          if (!cancelled) setRendering(false);
        }
      })();
    }, 140);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [renderSpec, pages, renderRevision]);
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
  async function open(file: File) {
    if (annotation.busy) {
      setError("Bitte warten, bis die PDF-Verarbeitung abgeschlossen ist.");
      return;
    }
    if (
      annotation.unsaved &&
      !window.confirm(
        "Ungesicherte Änderungen verwerfen und eine andere PDF öffnen?",
      )
    )
      return;
    annotation.reset();
    const token = ++generation.current;
    client.current?.dispose();
    client.current = null;
    cache.current.clear();
    setPages([]);
    setError("");
    setLoading(true);
    setRendering(false);
    setName("");
    try {
      if (file.size > 100 * 1024 * 1024 || file.size < 5)
        throw new Error(messages.badFile);
      const data = await file.arrayBuffer();
      if (token !== generation.current) return;
      if (new TextDecoder().decode(data.slice(0, 1024)).indexOf("%PDF-") < 0)
        throw new Error(messages.badFile);
      const c = new PdfClient();
      client.current = c;
      const result = await c.request({ type: "open", data });
      if (token !== generation.current) return;
      const infos = result.pages!;
      annotation.reset(result.editor!);
      setPages(infos);
      setName(file.name);
      setPage(0);
      setContinuous(false);
      updateView(() =>
        fit(infos[0].width, infos[0].height, current.current.box),
      );
    } catch (e) {
      if (token === generation.current) {
        setError(
          e instanceof Error ? e.message : "PDF konnte nicht geöffnet werden.",
        );
        client.current?.dispose();
        client.current = null;
      }
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }
  const ready = pages.length > 0;
  return (
    <main>
      <header>
        <div className="brand">
          <span className="mark">P</span>
          <strong>
            PDF<span className="brand-sub"> / Annotieren</span>
          </strong>
          <span className="badge">PROTOTYP</span>
        </div>
        <label className="open">
          PDF öffnen
          <input
            aria-label="PDF öffnen"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void open(f);
              e.target.value = "";
            }}
          />
        </label>
        <div className="divider" />
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
          disabled={!ready || annotation.formDirty || page === pages.length - 1}
          onClick={() => navigate(page + 1)}
          aria-label="Nächste Seite"
        >
          →
        </button>
        <div className="divider" />
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
        <button disabled={!ready} onClick={() => fitPage(page)}>
          Seite einpassen
        </button>
        <button disabled={!ready} onClick={() => fitPage(page, true)}>
          Breite
        </button>
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
          <option value="single">Einzelblatt</option>
          <option value="continuous">Fortlaufend</option>
        </select>
        <select
          aria-label="Eingabeprofil"
          value={profile}
          onChange={(e) => setProfile(e.target.value as typeof profile)}
        >
          <option value="mouse">Maus: Rad zoomt</option>
          <option value="trackpad">Trackpad: Scrollen</option>
        </select>
      </header>
      <AnnotationToolbar editor={annotation} ready={ready} />
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
                </div>
              ))}
            </div>
          )}
        </div>
        <AnnotationPanel editor={annotation} page={page} />
      </div>
      <footer>
        <span className="filename">{name || "Keine Datei geöffnet"}</span>
        <span>
          {loading
            ? "Wird geöffnet …"
            : rendering
              ? "Details werden geladen …"
              : ready
                ? `${pages.length} Seiten · ${annotation.state.readOnly ? "Nur Ansicht" : "Native Annotationen"}`
                : "Bereit"}
        </span>
        <span className="hint">
          {profile === "mouse"
            ? "Mausrad: Zoom"
            : "Trackpad: Pan · Pinch: Zoom"}{" "}
          · Mitteltaste / Leertaste + Ziehen: Pan
        </span>
        <a
          href="https://github.com/roju0ch/PDF-Annotation-Editor"
          target="_blank"
          rel="noreferrer"
        >
          Quellcode · AGPL
        </a>
      </footer>
    </main>
  );
}
