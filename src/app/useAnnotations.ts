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
  AnnotationKind,
  EditorState,
  PdfRect,
} from "../core/annotations/model";
export type Tool = "select" | "Ink" | "Text" | "FreeText" | "erase";
export type Draft = {
  page: number;
  points: Point[];
  kind: Tool;
  annotation?: Annotation;
};
const empty: EditorState = {
  revision: 0,
  dirty: false,
  canUndo: false,
  canRedo: false,
  readOnly: null,
};
type Layout = {
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
    [selected, setSelected] = useState<number | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [color, setColor] = useState("#d22f32"),
    [width, setWidth] = useState(3),
    [fontSize, setFontSize] = useState(14),
    [text, setText] = useState("Notiz"),
    [radius, setRadius] = useState(12),
    [formDirty, setFormDirty] = useState(false);
  const lock = useRef(false),
    epoch = useRef(0),
    draftRef = useRef<Draft | null>(null),
    current = useRef({
      layout,
      items,
      selected,
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
      selected,
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
    selected,
    tool,
    color,
    width,
    fontSize,
    text,
    radius,
    state,
    formDirty,
  ]);
  const showDraft = (d: Draft | null) => {
    draftRef.current = d;
    setDraft(d);
  };
  const reset = useCallback((next: EditorState = empty) => {
    epoch.current++;
    setState(next);
    setItems([]);
    setSelected(null);
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
        setSelected(r.selected ?? null);
        setFormDirty(false);
        invalidate();
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
  const unsaved = state.dirty || formDirty || draft !== null;
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
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !client.current) return;
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
      const typing =
        e.target instanceof HTMLElement &&
        !!e.target.closest("input,textarea,select");
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
    return () => window.removeEventListener("keydown", key);
  }, [client, edit, save]);
  function locate(p: Point, forcedPage?: number) {
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
      x: Math.max(0, Math.min(info.width, w.x)) + info.origin[0],
      y: Math.max(0, Math.min(info.height, w.y - tops[index])) + info.origin[1],
    };
    return { page: index, point: transform(local, inverse(info.pdfToPage)) };
  }
  function hit(point: Point, index: number) {
    return [...current.current.items]
      .reverse()
      .find(
        (a) =>
          a.page === index &&
          point.x >= a.rect[0] - 3 &&
          point.x <= a.rect[2] + 3 &&
          point.y >= a.rect[1] - 3 &&
          point.y <= a.rect[3] + 3,
      );
  }
  function begin(p: Point) {
    const cur = current.current;
    if (lock.current || cur.state.readOnly || cur.formDirty) return false;
    const at = locate(p);
    if (!at) return false;
    // Editing applies to the active page; navigation and other visible pages remain unaffected.
    if (at.page !== cur.layout.page) return false;
    const a = hit(at.point, at.page);
    if (cur.tool === "select") {
      setSelected(a?.id ?? null);
      if (!a?.editable) return false;
      showDraft({
        page: at.page,
        points: [at.point],
        kind: "select",
        annotation: a,
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
    const at = locate(p, d.page);
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
    if (d.kind === "select") {
      const offset = { x: end.x - start.x, y: end.y - start.y };
      if (Math.hypot(offset.x, offset.y) > 0.5)
        void edit({
          action: "update",
          page: d.page,
          id: d.annotation!.id,
          patch: { offset },
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
    state,
    tool,
    setTool,
    items,
    selected,
    setSelected,
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
      begin,
      move,
      finish,
      cancel: () => showDraft(null),
      active: () => draftRef.current !== null,
    },
  };
}
export type AnnotationControls = ReturnType<typeof useAnnotations>;
