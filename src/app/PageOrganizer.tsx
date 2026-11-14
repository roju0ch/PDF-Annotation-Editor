import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent,
} from "react";
import type { PdfClient } from "../adapters/pdf/client";
import type { PageInfo } from "../adapters/pdf/types";
import type { AnnotationControls } from "./useAnnotations";
import { movePageOrder } from "../core/document/pages";
import { MenuHeading } from "./CompactMenu";
const ROW = 126;
function Thumbnail({
  client,
  info,
  index,
  revision,
}: {
  client: RefObject<PdfClient | null>;
  info: PageInfo;
  index: number;
  revision: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const el = canvas.current!;
    delete el.dataset.rendered;
    const c = client.current;
    if (!c) return;
    c.request({
      type: "render",
      page: index,
      scale: Math.min(90 / info.width, 108 / info.height),
    })
      .then((result) => {
        if (cancelled) return;
        el.width = result.width!;
        el.height = result.height!;
        el.getContext("2d")!.putImageData(
          new ImageData(result.pixels!, result.width!, result.height!),
          0,
          0,
        );
        el.dataset.rendered = "true";
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [client, info, index, revision]);
  return (
    <span className="page-thumbnail">
      {failed && <span>Keine Vorschau</span>}
      <canvas ref={canvas} aria-label={`Miniatur Seite ${index + 1}`} />
    </span>
  );
}
type Gesture = {
  from: number;
  pointer: number;
  x: number;
  y: number;
  lastY: number;
  mode: "pending" | "scroll" | "drag";
  timer?: ReturnType<typeof setTimeout>;
};
export function PageOrganizer({
  pages,
  page,
  client,
  editor,
  navigate,
  documentKey,
  onError,
}: {
  pages: PageInfo[];
  page: number;
  client: RefObject<PdfClient | null>;
  editor: AnnotationControls;
  navigate: (page: number) => void;
  documentKey: number;
  onError: (message: string) => void;
}) {
  const panel = useRef<HTMLElement>(null),
    list = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const gesture = useRef<Gesture | null>(null),
    suppressClick = useRef(false);
  const pendingImport = useRef<{
    at: number;
    documentKey: number;
    revision: number;
  } | null>(null);
  const [open, setOpen] = useState(false),
    [scroll, setScroll] = useState(0),
    [height, setHeight] = useState(400);
  const [drag, setDrag] = useState<{ from: number; slot: number } | null>(null);
  const [insertion, setInsertion] = useState("end");
  const blocked =
    editor.busy ||
    editor.formDirty ||
    !pages.length ||
    !!editor.state.pageReadOnly;
  const cancel = () => {
    if (gesture.current) clearTimeout(gesture.current.timer);
    gesture.current = null;
    setDrag(null);
  };
  useEffect(() => {
    if (!open) return;
    const el = list.current!;
    const observer = new ResizeObserver(([entry]) =>
      setHeight(entry.contentRect.height),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);
  useEffect(() => {
    if (!open || !list.current) return;
    const el = list.current;
    if (
      page * ROW < el.scrollTop ||
      (page + 1) * ROW > el.scrollTop + el.clientHeight
    )
      el.scrollTop = page * ROW;
    setScroll(el.scrollTop);
  }, [open, page, pages]);
  useEffect(() => {
    const stop = () => {
      if (gesture.current) clearTimeout(gesture.current.timer);
      gesture.current = null;
      setDrag(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("blur", stop);
    window.addEventListener("keydown", key);
    return () => {
      if (gesture.current) clearTimeout(gesture.current.timer);
      window.removeEventListener("blur", stop);
      window.removeEventListener("keydown", key);
    };
  }, []);
  const slotAt = (y: number) => {
    const el = list.current!;
    return Math.max(
      0,
      Math.min(
        pages.length,
        Math.floor(
          (y - el.getBoundingClientRect().top + el.scrollTop + ROW / 2) / ROW,
        ),
      ),
    );
  };
  // Autoscroll keeps long documents reachable while dragging through virtual rows.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    let frame: number;
    const tick = () => {
      const el = list.current,
        g = gesture.current;
      if (!el || !g || g.mode !== "drag") return;
      const b = el.getBoundingClientRect();
      const speed =
        g.lastY < b.top + 32 ? -10 : g.lastY > b.bottom - 32 ? 10 : 0;
      if (speed) {
        el.scrollTop += speed;
        const slot = Math.max(
          0,
          Math.min(
            pages.length,
            Math.floor((g.lastY - b.top + el.scrollTop + ROW / 2) / ROW),
          ),
        );
        setDrag((prev) =>
          prev?.slot === slot ? prev : { from: g.from, slot },
        );
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging, pages.length]);
  const move = async (from: number, slot: number) => {
    if (blocked) return;
    cancel();
    const result = await editor.edit({
      action: "reorder-pages",
      order: movePageOrder(pages.length, from, slot),
    });
    if (!result) panel.current?.hidePopover();
  };
  const down = (e: PointerEvent<HTMLButtonElement>, index: number) => {
    if (editor.busy || editor.formDirty || e.button !== 0) return;
    if (gesture.current) {
      cancel();
      suppressClick.current = true;
      return;
    }
    suppressClick.current = false;
    const g: Gesture = {
      from: index,
      pointer: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      lastY: e.clientY,
      mode: "pending",
    };
    gesture.current = g;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.pointerType === "touch" && !blocked)
      g.timer = setTimeout(() => {
        if (gesture.current === g && g.mode === "pending") {
          g.mode = "drag";
          setDrag({ from: index, slot: index });
        }
      }, 400);
  };
  const pointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    if (
      g.mode === "pending" &&
      Math.hypot(e.clientX - g.x, e.clientY - g.y) > 6
    ) {
      clearTimeout(g.timer);
      g.mode = e.pointerType === "touch" || blocked ? "scroll" : "drag";
    }
    if (g.mode === "scroll") list.current!.scrollTop -= e.clientY - g.lastY;
    if (g.mode === "drag") setDrag({ from: g.from, slot: slotAt(e.clientY) });
    g.lastY = e.clientY;
  };
  const up = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    const mode = g.mode,
      slot = slotAt(e.clientY),
      from = g.from;
    cancel();
    if (mode !== "pending") {
      suppressClick.current = true;
      e.preventDefault();
    }
    if (mode === "drag") void move(from, slot);
  };
  const start = Math.max(0, Math.floor(scroll / ROW) - 2),
    end = Math.min(pages.length, start + Math.ceil(height / ROW) + 5);
  const visibleIndices = Array.from(
    { length: Math.max(0, end - start) },
    (_, i) => start + i,
  );
  const captured = gesture.current?.from;
  if (captured !== undefined && !visibleIndices.includes(captured))
    visibleIndices.push(captured);
  // Keep the captured row in DOM order: moving its node would release capture.
  visibleIndices.sort((a, b) => a - b);
  return (
    <section
      ref={panel}
      id="pages-menu"
      popover="auto"
      className="compact-menu page-organizer"
      aria-label="Seitenübersicht"
      onToggle={(e) => {
        const shown = e.currentTarget.matches(":popover-open");
        setOpen(shown);
        if (!shown) cancel();
      }}
    >
      <MenuHeading target="pages-menu">Seiten · {pages.length}</MenuHeading>
      <div className="page-organizer-actions">
        <button
          disabled={blocked || page === 0}
          aria-label="Seite nach vorne verschieben"
          onClick={() => void move(page, page - 1)}
        >
          ↑ Vorher
        </button>
        <button
          disabled={blocked || page >= pages.length - 1}
          aria-label="Seite nach hinten verschieben"
          onClick={() => void move(page, page + 2)}
        >
          ↓ Nachher
        </button>
        <span>Seite {page + 1}</span>
      </div>
      <div className="page-import">
        <select
          aria-label="PDF einfügen"
          value={insertion}
          disabled={blocked}
          onChange={(e) => setInsertion(e.target.value)}
        >
          <option value="end">Am Ende</option>
          <option value="after">Nach aktueller Seite</option>
        </select>
        <button
          disabled={blocked}
          onClick={() => {
            pendingImport.current = {
              at: insertion === "end" ? pages.length : page + 1,
              documentKey,
              revision: editor.state.revision,
            };
            input.current?.click();
          }}
        >
          PDF hinzufügen …
        </button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          aria-label="PDF zum Hinzufügen auswählen"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0],
              at = pendingImport.current;
            e.target.value = "";
            pendingImport.current = null;
            if (!file || !at) return;
            if (
              at.documentKey !== documentKey ||
              at.revision !== editor.state.revision
            ) {
              onError(
                "Das Dokument hat sich geändert. Bitte die PDF erneut hinzufügen.",
              );
              panel.current?.hidePopover();
              return;
            }
            void editor.insertPdf(file, at.at).then((ok) => {
              if (!ok) panel.current?.hidePopover();
            });
          }}
        />
      </div>
      <p className="small">
        {editor.state.pageReadOnly ||
          (editor.formDirty
            ? "Eigenschaften zuerst übernehmen oder verwerfen."
            : "Miniatur ziehen. Bei Touch kurz halten und ziehen; direktes Wischen scrollt. Alternativ Vorher/Nachher verwenden.")}
      </p>
      {open && (
        <div
          ref={list}
          className="page-list"
          data-testid="page-list"
          onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
        >
          <div
            className="page-list-space"
            style={{ height: pages.length * ROW }}
          >
            {visibleIndices.map((index) => {
              const info = pages[index];
              return (
                <button
                  key={info.id}
                  className={`page-card${drag?.from === index ? " dragging" : ""}`}
                  style={{ top: index * ROW, height: ROW - 8 }}
                  data-page-id={info.id}
                  data-page-index={index}
                  aria-label={`Seite ${index + 1} anzeigen`}
                  aria-current={page === index ? "page" : undefined}
                  disabled={editor.busy || editor.formDirty}
                  onPointerDown={(e) => down(e, index)}
                  onPointerMove={pointerMove}
                  onPointerUp={up}
                  onPointerCancel={() => {
                    suppressClick.current = true;
                    cancel();
                  }}
                  onLostPointerCapture={() => {
                    if (gesture.current) cancel();
                  }}
                  onClick={() => {
                    if (suppressClick.current) {
                      suppressClick.current = false;
                      return;
                    }
                    navigate(index);
                  }}
                >
                  <Thumbnail
                    client={client}
                    info={info}
                    index={index}
                    revision={editor.state.revision}
                  />
                  <span className="page-card-label">
                    Seite {index + 1}
                    <small>
                      {Math.round(info.width)} × {Math.round(info.height)} pt
                    </small>
                  </span>
                  <span className="page-grip" aria-hidden="true">
                    ⠿
                  </span>
                </button>
              );
            })}
            {drag && (
              <div
                className="page-insertion"
                data-testid="page-insertion"
                style={{ top: drag.slot * ROW - 3 }}
              />
            )}
          </div>
        </div>
      )}
      {drag && (
        <span role="status" className="small">
          Seite {drag.from + 1} vor Position {drag.slot + 1} ablegen
        </span>
      )}
    </section>
  );
}
