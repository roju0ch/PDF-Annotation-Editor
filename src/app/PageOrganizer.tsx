import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type PointerEvent,
  type MouseEvent,
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
  indices: number[];
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
  const [dragSlot, setDragSlot] = useState<number | null>(null);
  // null follows ordinary viewer navigation. An explicit (possibly empty)
  // selection belongs to this keyed document and uses native page object IDs.
  const [selection, setSelection] = useState<Set<number> | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const anchor = useRef<number | undefined>(undefined);
  const selected = useMemo(
    () => selection ?? new Set(pages[page] ? [pages[page].id] : []),
    [selection, pages, page],
  );
  const indices = useMemo(
    () => pages.flatMap((p, i) => (selected.has(p.id) ? [i] : [])),
    [pages, selected],
  );
  const first = indices[0],
    last = indices[indices.length - 1];
  const contiguous = indices.length === last - first + 1;
  const [insertion, setInsertion] = useState("end");
  const blocked =
    editor.busy ||
    editor.formDirty ||
    !pages.length ||
    !!editor.state.pageReadOnly;
  const cancel = () => {
    if (gesture.current) clearTimeout(gesture.current.timer);
    gesture.current = null;
    setDragSlot(null);
  };
  useLayoutEffect(() => {
    if (gesture.current) {
      suppressClick.current = true;
      cancel();
    }
    setConfirmDelete(false);
  }, [pages, blocked, editor.state.revision, page]);
  useLayoutEffect(() => {
    const live = new Set(pages.map((p) => p.id));
    if (anchor.current !== undefined && !live.has(anchor.current))
      anchor.current = undefined;
    setSelection((old) => {
      if (!old) return null;
      const kept = new Set([...old].filter((id) => live.has(id)));
      return kept.size === old.size ? old : kept.size ? kept : null;
    });
  }, [pages]);
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
      if (gesture.current) {
        suppressClick.current = true;
        clearTimeout(gesture.current.timer);
      }
      gesture.current = null;
      setDragSlot(null);
    };
    window.addEventListener("blur", stop);
    return () => {
      if (gesture.current) clearTimeout(gesture.current.timer);
      window.removeEventListener("blur", stop);
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
  const dragging = dragSlot !== null;
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
        setDragSlot(slot);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging, pages.length]);
  const move = async (group: number[], slot: number) => {
    if (blocked || !group.length) return;
    cancel();
    const order = movePageOrder(pages.length, group, slot);
    if (order.every((value, i) => value === i)) return;
    const result = await editor.edit({ action: "reorder-pages", order });
    if (!result) panel.current?.hidePopover();
  };
  const choose = (e: MouseEvent<HTMLButtonElement>, index: number) => {
    if (suppressClick.current && e.detail !== 0) {
      suppressClick.current = false;
      return;
    }
    cancel();
    setConfirmDelete(false);
    const id = pages[index].id;
    if (e.shiftKey) {
      const found = pages.findIndex((p) => p.id === anchor.current);
      const start = found >= 0 ? found : page;
      anchor.current = pages[start].id;
      setSelection(
        new Set(
          pages
            .slice(Math.min(start, index), Math.max(start, index) + 1)
            .map((p) => p.id),
        ),
      );
    } else if (selectionMode || e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelection(next);
      anchor.current = id;
    } else {
      anchor.current = id;
      setSelection(null);
      navigate(index);
    }
  };
  const beginDrag = (g: Gesture) => {
    g.mode = "drag";
    setConfirmDelete(false);
    if (!selected.has(pages[g.from].id)) {
      setSelection(new Set([pages[g.from].id]));
      anchor.current = pages[g.from].id;
    }
  };
  const down = (e: PointerEvent<HTMLButtonElement>, index: number) => {
    if (editor.busy || editor.formDirty || e.button !== 0) return;
    if (gesture.current) {
      cancel();
      suppressClick.current = true;
      return;
    }
    suppressClick.current = false;
    // In selection mode the card uses native touch panning. Its grip retains
    // long-press dragging, even when the virtual list scrolls beneath it.
    if (
      e.pointerType === "touch" &&
      selectionMode &&
      !(e.target as Element).closest(".page-grip")
    )
      return;
    const g: Gesture = {
      from: index,
      indices: selected.has(pages[index].id) ? indices : [index],
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
          beginDrag(g);
          setDragSlot(index);
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
      if (e.pointerType === "touch" || blocked) g.mode = "scroll";
      else beginDrag(g);
    }
    if (g.mode === "scroll") list.current!.scrollTop -= e.clientY - g.lastY;
    if (g.mode === "drag") setDragSlot(slotAt(e.clientY));
    g.lastY = e.clientY;
  };
  const up = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    const mode = g.mode,
      slot = slotAt(e.clientY),
      group = g.indices;
    cancel();
    if (mode !== "pending") {
      suppressClick.current = true;
      e.preventDefault();
    }
    if (mode === "drag" && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 6)
      void move(group, slot);
  };
  const start = Math.max(0, Math.floor(scroll / ROW) - 2),
    end = Math.min(pages.length, start + Math.ceil(height / ROW) + 5);
  const visibleIndices = Array.from(
    { length: Math.max(0, end - start) },
    (_, i) => start + i,
  );
  const captured = gesture.current?.from;
  if (
    captured !== undefined &&
    captured < pages.length &&
    !visibleIndices.includes(captured)
  )
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
        if (!shown) {
          cancel();
          setConfirmDelete(false);
        }
      }}
    >
      <MenuHeading target="pages-menu">Seiten · {pages.length}</MenuHeading>
      <div className="page-organizer-actions">
        <button
          aria-pressed={selectionMode}
          disabled={editor.busy || editor.formDirty}
          onClick={() => {
            cancel();
            setConfirmDelete(false);
            setSelectionMode(!selectionMode);
            if (selectionMode) {
              setSelection(null);
              anchor.current = undefined;
            }
          }}
        >
          Mehrfachauswahl
        </button>
        <span role="status">{indices.length} ausgewählt</span>
      </div>
      <div className="page-organizer-actions">
        <button
          disabled={blocked || !indices.length || (contiguous && first === 0)}
          aria-label={
            indices.length > 1
              ? "Ausgewählte Seiten nach vorne verschieben"
              : "Seite nach vorne verschieben"
          }
          onClick={() => void move(indices, Math.max(0, first - 1))}
        >
          ↑ Vorher
        </button>
        <button
          disabled={
            blocked ||
            !indices.length ||
            (contiguous && last === pages.length - 1)
          }
          aria-label={
            indices.length > 1
              ? "Ausgewählte Seiten nach hinten verschieben"
              : "Seite nach hinten verschieben"
          }
          onClick={() => void move(indices, Math.min(pages.length, last + 2))}
        >
          ↓ Nachher
        </button>
        <span>Angezeigt · Seite {page + 1}</span>
      </div>
      <div
        className="page-organizer-actions"
        role="group"
        aria-label="Seite drehen"
      >
        {([-90, 90] as const).map((degrees) => (
          <button
            key={degrees}
            disabled={blocked}
            aria-label={`Seite 90° nach ${degrees < 0 ? "links" : "rechts"} drehen`}
            title={`Aktuelle Seite 90° nach ${degrees < 0 ? "links" : "rechts"} drehen`}
            onClick={() => {
              cancel();
              void editor
                .edit({ action: "rotate-page", page, degrees })
                .then((result) => {
                  if (!result) panel.current?.hidePopover();
                });
            }}
          >
            {degrees < 0 ? "↶ 90° links" : "↷ 90° rechts"}
          </button>
        ))}
      </div>
      {confirmDelete ? (
        <div
          role="group"
          aria-label="Löschen bestätigen"
          className="page-organizer-actions"
        >
          <button autoFocus onClick={() => setConfirmDelete(false)}>
            Abbrechen
          </button>
          <button
            disabled={blocked}
            onClick={() => {
              setConfirmDelete(false);
              void editor
                .edit({ action: "delete-pages", indices })
                .then((result) => {
                  if (!result) panel.current?.hidePopover();
                });
            }}
          >
            {indices.length} {indices.length === 1 ? "Seite" : "Seiten"} löschen
          </button>
        </div>
      ) : (
        <button
          disabled={
            blocked || !indices.length || indices.length === pages.length
          }
          title={
            indices.length === pages.length
              ? "Mindestens eine Seite muss verbleiben."
              : undefined
          }
          onClick={() => {
            cancel();
            setConfirmDelete(true);
          }}
        >
          Ausgewählte Seiten löschen
        </button>
      )}
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
          (confirmDelete
            ? "Verweise auf gelöschte Seiten wechseln zur nächsten verbleibenden Seite, am Ende zur vorherigen."
            : editor.formDirty
              ? "Eigenschaften zuerst übernehmen oder verwerfen."
              : selectionMode
                ? "Miniaturen antippen zum Auswählen. Zum Verschieben den Griff halten und ziehen."
                : "Strg/⌘-Klick wählt einzelne Seiten, Umschalt-Klick einen Bereich. Bei Touch zum Ziehen kurz halten.")}
      </p>
      {open && (
        <div
          ref={list}
          className={selectionMode ? "page-list selecting-pages" : "page-list"}
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
                  className={`page-card${dragging && selected.has(info.id) ? " dragging" : ""}`}
                  style={{ top: index * ROW, height: ROW - 8 }}
                  data-page-id={info.id}
                  data-page-index={index}
                  aria-label={`Seite ${index + 1} anzeigen`}
                  aria-pressed={selected.has(info.id)}
                  aria-current={page === index ? "page" : undefined}
                  disabled={editor.busy || editor.formDirty}
                  onPointerDown={(e) => down(e, index)}
                  onPointerMove={pointerMove}
                  onPointerUp={up}
                  onPointerCancel={() => {
                    suppressClick.current = true;
                    cancel();
                  }}
                  onLostPointerCapture={(e) => {
                    if (gesture.current?.pointer === e.pointerId) {
                      suppressClick.current = true;
                      cancel();
                    }
                  }}
                  onClick={(e) => choose(e, index)}
                >
                  <Thumbnail
                    client={client}
                    info={info}
                    index={index}
                    revision={editor.state.revision}
                  />
                  <span className="page-card-label">
                    {selected.has(info.id) && (
                      <span aria-hidden="true">✓ </span>
                    )}
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
            {dragSlot !== null && (
              <div
                className="page-insertion"
                data-testid="page-insertion"
                style={{
                  top: Math.max(
                    0,
                    Math.min(dragSlot * ROW - 2, pages.length * ROW - 4),
                  ),
                }}
              />
            )}
          </div>
        </div>
      )}
      {dragSlot !== null && (
        <span role="status" className="small">
          {indices.length} {indices.length === 1 ? "Seite" : "Seiten"}{" "}
          {dragSlot === pages.length ? "am Ende" : `vor Seite ${dragSlot + 1}`}{" "}
          ablegen
        </span>
      )}
    </section>
  );
}
