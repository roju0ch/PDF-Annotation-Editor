import {
  imageInfo,
  imagePlacement,
  rectCorners,
  resizeImage,
  MAX_IMAGE_BYTES,
} from "../core/annotations/image";
import {
  intersectingAnnotations,
  selectionRect,
  touchesAnnotation,
} from "../core/annotations/selection";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { PdfClient } from "../adapters/pdf/client";
import type { PageInfo } from "../adapters/pdf/types";
import {
  inverse,
  toWorld,
  transform,
  type Point,
  type View,
} from "../core/viewport";
import type {
  Annotation,
  AnnotationCommand,
  AnnotationClipboard,
  AnnotationKind,
  EditorState,
  PdfRect,
} from "../core/annotations/model";
export type Tool = "select" | "Ink" | "Text" | "FreeText" | "erase";
export type Draft = {
  page: number;
  points: Point[];
  kind: Tool | "marquee" | "resize";
  corner?: number;
  ids?: number[];
  annotation?: Annotation;
};
const empty: EditorState = {
  revision: 0,
  dirty: false,
  canUndo: false,
  canRedo: false,
  readOnly: null,
};
export type AnnotationContext = {
  mode: "selection" | "blank";
  screen: Point;
  page: number;
  point: Point;
};
type Layout = {
  box: Point;
  view: View;
  pages: PageInfo[];
  tops: number[];
  continuous: boolean;
  page: number;
};
export function useAnnotations(
  client: RefObject<PdfClient | null>,
  layout: Layout,
  name: string,
  invalidate: () => void,
  onError: (s: string) => void,
) {
  const [state, setState] = useState(empty),
    [tool, setTool] = useState<Tool>("select"),
    [items, setItems] = useState<Annotation[]>([]),
    [selection, setSelection] = useState<number[]>([]),
    [draft, setDraft] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [color, setColor] = useState("#d22f32"),
    [width, setWidth] = useState(3),
    [fontSize, setFontSize] = useState(14),
    [text, setText] = useState("Notiz"),
    [radius, setRadius] = useState(12),
    [formDirty, setFormDirty] = useState(false);
  const [contextMenu, setContextMenu] = useState<AnnotationContext | null>(
    null,
  );
  const [hasClipboard, setHasClipboard] = useState(false);
  const clipboard = useRef<AnnotationClipboard | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageDestination = useRef<{
    page: number;
    point: Point;
    epoch: number;
  } | null>(null);
  const contextRef = useRef<AnnotationContext | null>(null);
  const lastPointer = useRef<Point | null>(null);
  const clipboardActions = useRef({
    selectAll: () => {},
    copy: (_cut: boolean) => {
      void _cut;
    },
    paste: () => {},
    image: (_file: Blob) => {
      void _file;
    },
    closeContext: () => {},
  });
  const lock = useRef(false),
    epoch = useRef(0),
    draftRef = useRef<Draft | null>(null),
    current = useRef({
      layout,
      items,
      selection,
      tool,
      color,
      width,
      fontSize,
      text,
      radius,
      state,
      formDirty,
    });
  useEffect(() => {
    current.current = {
      layout,
      items,
      selection,
      tool,
      color,
      width,
      fontSize,
      text,
      radius,
      state,
      formDirty,
    };
  }, [
    layout,
    items,
    selection,
    tool,
    color,
    width,
    fontSize,
    text,
    radius,
    state,
    formDirty,
  ]);
  const showDraft = useCallback((d: Draft | null) => {
    draftRef.current = d;
    setDraft(d);
  }, []);
  const reset = useCallback((next: EditorState = empty) => {
    epoch.current++;
    contextRef.current = null;
    imageDestination.current = null;
    lastPointer.current = null;
    setContextMenu(null);
    setState(next);
    setItems([]);
    setSelection([]);
    setDraft(null);
    draftRef.current = null;
    setNotice("");
    setTool("select");
    setFormDirty(false);
    lock.current = false;
    setBusy(false);
  }, []);
  useEffect(() => {
    const c = client.current;
    if (!c || !layout.pages.length) return;
    let cancelled = false;
    c.request({ type: "list", page: layout.page })
      .then((r) => {
        if (!cancelled) {
          setItems(r.annotations!);
          setSelection((ids) =>
            ids.filter((id) => r.annotations!.some((a) => a.id === id)),
          );
          setState(r.editor!);
        }
      })
      .catch((e) => {
        if (!cancelled) onError(String(e.message));
      });
    return () => {
      cancelled = true;
    };
  }, [client, layout.page, layout.pages, state.revision, onError]);
  const edit = useCallback(
    async (command: AnnotationCommand) => {
      const c = client.current;
      if (!c || lock.current) return;
      const token = epoch.current;
      lock.current = true;
      setBusy(true);
      setNotice("");
      try {
        const r = await c.request({ type: "edit", command });
        if (token !== epoch.current) return;
        setState(r.editor!);
        if (command.action === "move") setSelection(command.ids);
        else if (command.action !== "undo" && command.action !== "redo")
          setSelection(
            Array.isArray(r.selected)
              ? r.selected
              : r.selected == null
                ? []
                : [r.selected],
          );
        setFormDirty(false);
        invalidate();
        return r;
      } catch (e) {
        if (token === epoch.current)
          onError(
            e instanceof Error ? e.message : "Bearbeitung fehlgeschlagen.",
          );
      } finally {
        if (token === epoch.current) {
          lock.current = false;
          setBusy(false);
        }
      }
    },
    [client, invalidate, onError],
  );
  const save = useCallback(async () => {
    const c = client.current;
    if (!c || lock.current || current.current.state.readOnly) return;
    if (current.current.formDirty) {
      onError("Bitte die Eigenschaften zuerst übernehmen oder verwerfen.");
      return;
    }
    const token = epoch.current;
    lock.current = true;
    setBusy(true);
    try {
      const r = await c.request({ type: "export" });
      if (token !== epoch.current) return;
      const url = URL.createObjectURL(
        new Blob([r.bytes!], { type: "application/pdf" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = name.replace(/\.pdf$/i, "") + "-annotiert.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      const ack = await c.request({
        type: "ack-export",
        revision: r.editor!.revision,
      });
      if (token !== epoch.current) return;
      setState(ack.editor!);
      setNotice(
        "PDF-Download gestartet. Bitte die heruntergeladene Datei prüfen.",
      );
    } catch (e) {
      if (token === epoch.current)
        onError(e instanceof Error ? e.message : "Export fehlgeschlagen.");
    } finally {
      if (token === epoch.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }, [client, name, onError]);
  const closeContext = useCallback(() => {
    contextRef.current = null;
    setContextMenu(null);
  }, []);
  const copySelection = useCallback(
    async (cut = false) => {
      const cur = current.current,
        c = client.current;
      if (
        !c ||
        lock.current ||
        cur.formDirty ||
        cur.state.readOnly ||
        !cur.selection.length
      )
        return;
      const ids = cur.selection.filter((id) =>
        cur.items.some(
          (a) => a.id === id && a.page === cur.layout.page && a.editable,
        ),
      );
      if (ids.length !== cur.selection.length) return;
      showDraft(null);
      closeContext();
      // Mark an explicit annotation copy in the native clipboard so an old
      // screenshot cannot override it on the next native paste event. PDF data
      // remains in memory. A synchronous copy event avoids an async permission read.
      const mark = (event: ClipboardEvent) => {
        event.clipboardData?.setData(
          "application/x-pdf-annotation-editor",
          "internal",
        );
        event.clipboardData?.setData("text/plain", "");
        event.preventDefault();
      };
      document.addEventListener("copy", mark);
      try {
        document.execCommand("copy");
      } catch {
        // The internal copy remains available even if native clipboard writing is blocked.
      } finally {
        document.removeEventListener("copy", mark);
      }
      const token = epoch.current;
      lock.current = true;
      setBusy(true);
      try {
        const r = await c.request({
          type: "copy",
          page: cur.layout.page,
          ids,
          cut,
        });
        if (token !== epoch.current) return;
        clipboard.current = r.clipboard!;
        setHasClipboard(true);
        setState(r.editor!);
        if (cut) {
          setSelection([]);
          invalidate();
        }
        setNotice(
          `${ids.length} ${ids.length === 1 ? "Markierung" : "Markierungen"} ${cut ? "ausgeschnitten" : "kopiert"}.`,
        );
      } catch (e) {
        if (token === epoch.current)
          onError(e instanceof Error ? e.message : "Kopieren fehlgeschlagen.");
      } finally {
        if (token === epoch.current) {
          lock.current = false;
          setBusy(false);
        }
      }
    },
    [client, closeContext, invalidate, onError, showDraft],
  );
  async function deleteSelection() {
    const cur = current.current;
    if (
      lock.current ||
      cur.formDirty ||
      cur.state.readOnly ||
      !cur.selection.length ||
      !cur.selection.every((id) =>
        cur.items.some(
          (a) => a.id === id && a.page === cur.layout.page && a.editable,
        ),
      )
    )
      return;
    showDraft(null);
    closeContext();
    const result = await edit({
      action: "delete-many",
      page: cur.layout.page,
      ids: cur.selection,
    });
    if (result)
      setNotice(
        `${cur.selection.length} ${cur.selection.length === 1 ? "Markierung" : "Markierungen"} gelöscht.`,
      );
  }
  const selectAll = useCallback(() => {
    const cur = current.current;
    if (lock.current || cur.formDirty || cur.state.readOnly) return;
    showDraft(null);
    closeContext();
    setTool("select");
    setSelection(
      cur.items
        .filter((a) => a.page === cur.layout.page && a.editable)
        .map((a) => a.id),
    );
  }, [closeContext, showDraft]);
  function insertionTarget() {
    const cur = current.current;
    const at =
      contextRef.current ??
      (lastPointer.current ? locate(lastPointer.current) : null);
    return at?.page === cur.layout.page
      ? at
      : locate(
          { x: cur.layout.box.x / 2, y: cur.layout.box.y / 2 },
          cur.layout.page,
        );
  }
  async function insertImage(
    load: () => Promise<Blob>,
    destination = insertionTarget(),
    token = epoch.current,
  ) {
    const cur = current.current;
    if (
      !destination ||
      lock.current ||
      cur.formDirty ||
      cur.state.readOnly ||
      token !== epoch.current
    )
      return;
    showDraft(null);
    closeContext();
    const info = cur.layout.pages[destination.page];
    lock.current = true;
    setBusy(true);
    try {
      const file = await load();
      if (file.size > MAX_IMAGE_BYTES)
        throw new Error("Das Bild ist größer als 20 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const size = imageInfo(bytes);
      if (
        token !== epoch.current ||
        destination.page !== current.current.layout.page
      )
        return;
      const pt = transform(destination.point, info.pdfToPage);
      const rect = imagePlacement(size.width, size.height, info, {
        x: pt.x - info.origin[0],
        y: pt.y - info.origin[1],
      });
      const corners = rectCorners(rect).map((p) =>
        transform(
          { x: p.x + info.origin[0], y: p.y + info.origin[1] },
          inverse(info.pdfToPage),
        ),
      );
      lock.current = false;
      setTool("select");
      const result = await edit({
        action: "create-image",
        page: destination.page,
        bytes,
        rect: [
          Math.min(...corners.map((p) => p.x)),
          Math.min(...corners.map((p) => p.y)),
          Math.max(...corners.map((p) => p.x)),
          Math.max(...corners.map((p) => p.y)),
        ],
        contents: "",
      });
      if (result)
        setNotice(
          "Bild eingefügt. An den Eckgriffen proportional vergrößern oder verkleinern.",
        );
    } catch (error) {
      if (token === epoch.current)
        onError(
          error instanceof Error
            ? error.message
            : "Bild konnte nicht eingefügt werden.",
        );
    } finally {
      if (token === epoch.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  function chooseImage() {
    const at = insertionTarget();
    if (
      !at ||
      lock.current ||
      current.current.formDirty ||
      current.current.state.readOnly
    )
      return;
    imageDestination.current = { ...at, epoch: epoch.current };
    closeContext();
    document
      .querySelectorAll<HTMLElement>(".compact-menu:popover-open")
      .forEach((el) => el.hidePopover());
    imageInput.current?.click();
  }
  function imageFile(file: File) {
    const at = imageDestination.current;
    imageDestination.current = null;
    if (at) void insertImage(() => Promise.resolve(file), at, at.epoch);
  }
  function pasteImage() {
    void insertImage(async () => {
      if (!navigator.clipboard?.read)
        throw new Error(
          "Dieser Browser erlaubt keinen direkten Bildzugriff. Bitte ‚Bild einfügen …‘ verwenden.",
        );
      let entries: ClipboardItems;
      try {
        entries = await navigator.clipboard.read();
      } catch {
        throw new Error(
          "Kein Zugriff auf die Zwischenablage. Bitte den Zugriff erlauben oder ‚Bild einfügen …‘ verwenden.",
        );
      }
      for (const item of entries) {
        const type = item.types.find((t) =>
          ["image/png", "image/jpeg"].includes(t),
        );
        if (type) return item.getType(type);
      }
      throw new Error(
        "Kein PNG-/JPEG-Bild in der Zwischenablage. Bitte einen Screenshot kopieren oder ‚Bild einfügen …‘ verwenden.",
      );
    });
  }
  async function paste() {
    const cur = current.current,
      clip = clipboard.current;
    if (
      !clip ||
      lock.current ||
      cur.formDirty ||
      cur.state.readOnly ||
      !cur.layout.pages.length
    )
      return;
    const at =
      contextRef.current ??
      (lastPointer.current ? locate(lastPointer.current) : null);
    const target =
      at?.page === cur.layout.page
        ? at
        : locate(
            { x: cur.layout.box.x / 2, y: cur.layout.box.y / 2 },
            cur.layout.page,
          );
    if (!target) return;
    showDraft(null);
    closeContext();
    setTool("select");
    const result = await edit({
      action: "paste",
      page: target.page,
      point: target.point,
      clipboard: clip,
    });
    if (result)
      setNotice(
        `${clip.items.length} ${clip.items.length === 1 ? "Markierung" : "Markierungen"} eingefügt.`,
      );
  }
  function openContext(p: Point, screen: Point) {
    const cur = current.current,
      at = locate(p);
    if (
      cur.tool !== "select" ||
      cur.formDirty ||
      cur.state.readOnly ||
      !at ||
      at.page !== cur.layout.page
    )
      return false;
    const item = hit(at.point, at.page);
    if (item && !item.editable) return false;
    if (item && !cur.selection.includes(item.id)) setSelection([item.id]);
    showDraft(null);
    document
      .querySelectorAll<HTMLElement>(".compact-menu:popover-open")
      .forEach((menu) => menu.hidePopover());
    const value: AnnotationContext = {
      mode: item ? "selection" : "blank",
      screen,
      ...at,
    };
    contextRef.current = value;
    setContextMenu(value);
    return true;
  }
  useEffect(() => {
    clipboardActions.current = {
      selectAll,
      copy: (cut) => {
        void copySelection(cut);
      },
      paste: () => {
        void paste();
      },
      image: (file) => {
        void insertImage(() => Promise.resolve(file));
      },
      closeContext,
    };
  });
  const unsaved =
    state.dirty ||
    formDirty ||
    (draft !== null && draft.kind !== "marquee" && draft.kind !== "select");
  useEffect(() => {
    if (!unsaved && !busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved, busy]);
  useEffect(() => {
    let pendingPaste = false;
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      !!target.closest(
        "input:not([type=file]),textarea,select,[contenteditable]:not([contenteditable=false])",
      );
    const nativePaste = (e: ClipboardEvent) => {
      if (typing(e.target) || !client.current) return;
      pendingPaste = false;
      e.preventDefault();
      const file = [...(e.clipboardData?.files ?? [])].find((f) =>
        f.type.startsWith("image/"),
      );
      if (file) {
        e.preventDefault();
        clipboardActions.current.image(file);
      } else if (e.clipboardData?.getData("text/plain")) {
        onError(
          "Text oder formatierte Inhalte können noch nicht als Annotation eingefügt werden. Bitte ein PNG-/JPEG-Bild oder kopierte Annotationen verwenden.",
        );
      } else if (clipboard.current) {
        clipboardActions.current.paste();
      }
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "v" && pendingPaste) {
        pendingPaste = false;
        if (!typing(e.target)) clipboardActions.current.paste();
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (
        e.key === "Escape" &&
        !(
          e.target instanceof HTMLElement &&
          e.target.closest("input,textarea,select")
        )
      ) {
        if (contextRef.current) {
          clipboardActions.current.closeContext();
          return;
        }
        if (draftRef.current) {
          draftRef.current = null;
          setDraft(null);
        } else if (!current.current.formDirty) setSelection([]);
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || !client.current) return;
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
      const typing =
        e.target instanceof HTMLElement &&
        !!e.target.closest(
          "input:not([type=file]),textarea,select,[contenteditable]:not([contenteditable=false])",
        );
      if (
        !typing &&
        !e.altKey &&
        ["a", "c", "x", "v"].includes(e.key.toLowerCase())
      ) {
        const action = e.key.toLowerCase();
        if (action === "v") {
          if (!e.repeat) pendingPaste = true;
          return; // Native paste reads images without an extra clipboard permission.
        }
        e.preventDefault();
        if (e.repeat) return;
        if (action === "a") clipboardActions.current.selectAll();
        if (action === "c" || action === "x")
          clipboardActions.current.copy(action === "x");
        if (action === "v") clipboardActions.current.paste();
        return;
      }
      if (
        !typing &&
        !current.current.formDirty &&
        ["z", "y"].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
        void edit({
          action: e.key.toLowerCase() === "y" || e.shiftKey ? "redo" : "undo",
        });
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", keyup);
    window.addEventListener("paste", nativePaste);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("paste", nativePaste);
    };
  }, [client, edit, save, onError]);
  function locate(p: Point, forcedPage?: number, clamp = true) {
    const { view, pages, tops, continuous, page } = current.current.layout,
      w = toWorld(p, view);
    const index =
      forcedPage ??
      pages.findIndex(
        (info, i) =>
          (continuous || i === page) &&
          w.x >= 0 &&
          w.x <= info.width &&
          w.y >= tops[i] &&
          w.y <= tops[i] + info.height,
      );
    if (index < 0 || !pages[index]) return null;
    const info = pages[index];
    const local = {
      x:
        (clamp ? Math.max(0, Math.min(info.width, w.x)) : w.x) + info.origin[0],
      y:
        (clamp
          ? Math.max(0, Math.min(info.height, w.y - tops[index]))
          : w.y - tops[index]) + info.origin[1],
    };
    return { page: index, point: transform(local, inverse(info.pdfToPage)) };
  }
  function hit(point: Point, index: number) {
    return [...current.current.items]
      .reverse()
      .find(
        (a) =>
          a.page === index &&
          touchesAnnotation(a, [
            point.x - 3 / current.current.layout.view.scale,
            point.y - 3 / current.current.layout.view.scale,
            point.x + 3 / current.current.layout.view.scale,
            point.y + 3 / current.current.layout.view.scale,
          ]),
      );
  }
  function begin(p: Point) {
    const cur = current.current;
    if (lock.current || cur.state.readOnly || cur.formDirty) return false;
    const at =
      locate(p) ??
      (cur.tool === "select" ? locate(p, cur.layout.page, false) : null);
    if (!at) return false;
    // Editing applies to the active page; navigation and other visible pages remain unaffected.
    if (at.page !== cur.layout.page) return false;
    const a = hit(at.point, at.page);
    if (cur.tool === "select") {
      const image =
        cur.selection.length === 1
          ? cur.items.find(
              (a) =>
                a.id === cur.selection[0] && a.type === "Stamp" && a.editable,
            )
          : undefined;
      if (image) {
        const corner = rectCorners(image.rect).findIndex(
          (p) =>
            Math.hypot(p.x - at.point.x, p.y - at.point.y) *
              cur.layout.view.scale <=
            14,
        );
        if (corner >= 0) {
          showDraft({
            page: at.page,
            points: [at.point],
            kind: "resize",
            annotation: image,
            corner,
          });
          return true;
        }
      }
      if (!a) {
        showDraft({ page: at.page, points: [at.point], kind: "marquee" });
        return true;
      }
      const ids = cur.selection.includes(a.id) ? cur.selection : [a.id];
      setSelection(ids);
      if (!a.editable) return false;
      showDraft({
        page: at.page,
        points: [at.point],
        kind: "select",
        ids: ids.filter((id) =>
          cur.items.some(
            (item) => item.id === id && item.editable && item.page === at.page,
          ),
        ),
      });
      return true;
    }
    if (cur.tool === "erase" && (!a?.editable || a.type !== "Ink"))
      return false;
    showDraft({
      page: at.page,
      points: [at.point],
      kind: cur.tool,
      annotation: a,
    });
    return true;
  }
  function move(p: Point) {
    const d = draftRef.current;
    if (!d) return;
    const at = locate(
      p,
      d.page,
      d.kind !== "select" && d.kind !== "marquee" && d.kind !== "resize",
    );
    if (!at) return;
    if (d.kind === "Ink") {
      const last = d.points.at(-1)!;
      if (
        d.points.length < 20000 &&
        Math.hypot(last.x - at.point.x, last.y - at.point.y) > 0.2
      )
        showDraft({ ...d, points: [...d.points, at.point] });
    } else showDraft({ ...d, points: [d.points[0], at.point] });
  }
  function finish() {
    const d = draftRef.current;
    showDraft(null);
    if (!d) return;
    const cur = current.current,
      start = d.points[0],
      end = d.points.at(-1)!;
    const matrix = cur.layout.pages[d.page].pdfToPage;
    const startDisplay = transform(start, matrix),
      endDisplay = transform(end, matrix);
    const dragged =
      Math.hypot(endDisplay.x - startDisplay.x, endDisplay.y - startDisplay.y) *
        cur.layout.view.scale >
      3;
    if (d.kind === "marquee") {
      setSelection(
        dragged
          ? intersectingAnnotations(
              cur.items,
              d.page,
              selectionRect(start, end),
            )
          : [],
      );
      return;
    }
    if (d.kind === "resize") {
      if (dragged)
        void edit({
          action: "update",
          page: d.page,
          id: d.annotation!.id,
          patch: {
            rect: resizeImage(d.annotation!.rect, d.corner!, {
              x: rectCorners(d.annotation!.rect)[d.corner!].x + end.x - start.x,
              y: rectCorners(d.annotation!.rect)[d.corner!].y + end.y - start.y,
            }),
          },
        });
      return;
    }
    if (d.kind === "select") {
      if (dragged)
        void edit({
          action: "move",
          page: d.page,
          ids: d.ids!,
          offset: { x: end.x - start.x, y: end.y - start.y },
        });
      return;
    }
    if (d.kind === "erase") {
      void edit({
        action: "erase",
        page: d.page,
        id: d.annotation!.id,
        center: end,
        radius: cur.radius,
      });
      return;
    }
    if (d.kind === "Ink" && d.points.length < 2) return;
    const info = cur.layout.pages[d.page];
    // Text placement uses display-space extents, then returns to canonical PDF space.
    const display = transform(start, info.pdfToPage);
    const w = d.kind === "Text" ? 24 : 180,
      h = d.kind === "Text" ? 24 : 60;
    const corners =
      d.kind === "Ink"
        ? d.points
        : [
            start,
            transform(
              { x: display.x + w, y: display.y + h },
              inverse(info.pdfToPage),
            ),
          ];
    const rect: PdfRect = [
      Math.min(...corners.map((p) => p.x)),
      Math.min(...corners.map((p) => p.y)),
      Math.max(...corners.map((p) => p.x)),
      Math.max(...corners.map((p) => p.y)),
    ];
    if (rect[2] === rect[0]) rect[2] += 0.01;
    if (rect[3] === rect[1]) rect[3] += 0.01;
    void edit({
      action: "create",
      page: d.page,
      kind: d.kind as AnnotationKind,
      rect,
      ink: d.kind === "Ink" ? [d.points] : undefined,
      contents: d.kind === "Ink" ? "" : cur.text,
      color: cur.color,
      width: cur.width,
      fontSize: cur.fontSize,
    });
  }
  return {
    contextMenu,
    closeContext,
    hasClipboard,
    imageInput,
    imageFile,
    chooseImage,
    pasteImage,
    copySelection,
    deleteSelection,
    paste,
    selectAll,
    state,
    tool,
    setTool,
    items,
    selection,
    selected: selection.length === 1 ? selection[0] : null,
    setSelected: (id: number | null) => setSelection(id === null ? [] : [id]),
    draft,
    busy,
    notice,
    color,
    setColor,
    width,
    setWidth,
    fontSize,
    setFontSize,
    text,
    setText,
    radius,
    setRadius,
    formDirty,
    setFormDirty,
    unsaved,
    reset,
    edit,
    save,
    gesture: {
      openContext,
      closeContext,
      hover: (p: Point | null) => {
        lastPointer.current = p;
      },
      begin,
      move,
      finish,
      cancel: () => showDraft(null),
      active: () => draftRef.current !== null,
    },
  };
}
export type AnnotationControls = ReturnType<typeof useAnnotations>;
