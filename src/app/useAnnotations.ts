import { openControlSelector } from "./CompactMenu";
import {
  FREE_TEXT_PREFERENCES_KEY,
  readFreeTextStyle,
  type FreeTextStyle,
} from "../core/annotations/textPreferences";
import { readClipboardImage } from "../adapters/platform/clipboard";
import {
  usesNativeSave,
  savePdf,
  supportsPdfSave,
  PDF_SAVE_UNAVAILABLE,
} from "../adapters/platform/savePdf";
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
  selectionBounds,
  touchesAnnotation,
} from "../core/annotations/selection";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type SetStateAction,
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
  AnnotationPatch,
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
type FreeTextDraft = {
  page: number;
  point: Point;
  contents: string;
  error: string;
  annotation?: Annotation;
  style?: FreeTextStyle;
};
function textEditPatch(
  value: FreeTextDraft,
  style: FreeTextStyle,
): AnnotationPatch {
  const item = value.annotation;
  if (!item) return {};
  const background = style.transparent ? null : style.backgroundColor;
  return {
    ...(value.contents !== item.contents ? { contents: value.contents } : {}),
    ...(style.color !== item.color ? { color: style.color } : {}),
    ...(item.type === "FreeText" && style.fontSize !== item.fontSize
      ? { fontSize: style.fontSize }
      : {}),
    ...(item.type === "FreeText" &&
    background !== (item.backgroundColor ?? null)
      ? { backgroundColor: background }
      : {}),
  };
}
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
  invalidate: (structural?: boolean) => void,
  onError: (s: string) => void,
  onPagesChange: (pages: PageInfo[], focusPage?: number) => void,
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
    [text, setText] = useState(""),
    [radius, setRadius] = useState(12),
    [formDirty, setFormDirty] = useState(false);
  const [freeTextStyle, setFreeTextStyle] = useState(readFreeTextStyle);
  const [freeTextDraft, setFreeTextDraft] = useState<FreeTextDraft | null>(
    null,
  );
  const freeTextRef = useRef<FreeTextDraft | null>(null);
  const editError = useRef<string | null>(null);
  useEffect(() => {
    // Do not persist invalid intermediate numeric input or any document text.
    if (
      !Number.isFinite(freeTextStyle.fontSize) ||
      freeTextStyle.fontSize < 6 ||
      freeTextStyle.fontSize > 96
    )
      return;
    try {
      localStorage.setItem(
        FREE_TEXT_PREFERENCES_KEY,
        JSON.stringify(freeTextStyle),
      );
    } catch {
      // Preferences still work for this session when storage is unavailable.
    }
  }, [freeTextStyle]);
  const showFreeText = useCallback((value: FreeTextDraft | null) => {
    freeTextRef.current = value;
    setFreeTextDraft(value);
  }, []);
  const [contextMenu, setContextMenu] = useState<AnnotationContext | null>(
    null,
  );
  const [pendingInk, setPendingInk] = useState<
    {
      id: number;
      draft: Draft;
      color: string;
      width: number;
      revision: number | null;
    }[]
  >([]);
  const nextPendingInk = useRef(0);
  const displayedRevision = useRef<number | null>(null);
  const displayed = useCallback((revision: number) => {
    // New edit sequence IDs increase even after undo; old raster replies must
    // not remove feedback for a later stroke that has already committed.
    displayedRevision.current = Math.max(
      displayedRevision.current ?? -1,
      revision,
    );
    setPendingInk((items) =>
      items.filter(
        (item) => item.revision === null || item.revision > revision,
      ),
    );
  }, []);
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
    freeTextRef.current = null;
    setFreeTextDraft(null);
    editError.current = null;
    setState(next);
    setItems([]);
    setSelection([]);
    setDraft(null);
    setPendingInk([]);
    displayedRevision.current = null;
    draftRef.current = null;
    setNotice("");
    setTool("select");
    setFormDirty(false);
    lock.current = false;
    setBusy(false);
  }, []);
  // A replacement PDF is parsed in its own worker while the current document
  // stays intact. Reuse the edit/save lock so no mutation can race that commit.
  const beginDocumentChange = useCallback(() => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    return true;
  }, []);
  const endDocumentChange = useCallback(() => {
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
    async (command: AnnotationCommand, allowFreeTextDialog = false) => {
      const c = client.current;
      if (
        !c ||
        lock.current ||
        (freeTextRef.current !== null && !allowFreeTextDialog) ||
        (current.current.formDirty && command.action !== "update")
      )
        return;
      const token = epoch.current;
      editError.current = null;
      if (!["create", "create-image", "paste"].includes(command.action))
        setPendingInk([]);
      lock.current = true;
      setBusy(true);
      setNotice("");
      try {
        const r = await c.request({ type: "edit", command });
        if (token !== epoch.current) return;
        setState(r.editor!);
        if (r.pages) {
          setPendingInk([]);
          setItems([]);
          setSelection([]);
          showDraft(null);
          contextRef.current = null;
          setContextMenu(null);
          onPagesChange(r.pages, r.focusPage);
        } else if (
          command.action === "create" ||
          command.action === "create-image"
        )
          setSelection([]);
        else if (command.action === "move") setSelection(command.ids);
        else if (command.action !== "undo" && command.action !== "redo")
          setSelection(
            Array.isArray(r.selected)
              ? r.selected
              : r.selected == null
                ? []
                : [r.selected],
          );
        setFormDirty(false);
        invalidate(!!r.pages);
        return r;
      } catch (e) {
        if (token === epoch.current) {
          editError.current =
            e instanceof Error ? e.message : "Bearbeitung fehlgeschlagen.";
          onError(editError.current);
        }
      } finally {
        if (token === epoch.current) {
          lock.current = false;
          setBusy(false);
        }
      }
    },
    [client, invalidate, onError, onPagesChange, showDraft],
  );
  async function insertPdf(file: File, at: number) {
    if (
      lock.current ||
      current.current.formDirty ||
      current.current.state.pageReadOnly
    )
      return;
    const token = epoch.current;
    lock.current = true;
    setBusy(true);
    try {
      if (file.size < 5 || file.size > 100 * 1024 * 1024)
        throw new Error("Bitte eine PDF bis 100 MB hinzufügen.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (token !== epoch.current) return;
      lock.current = false;
      const result = await edit({
        action: "insert-pdf",
        at,
        bytes,
        name: file.name,
      });
      if (result)
        setNotice(
          "PDF hinzugefügt. Rückgängig entfernt alle eingefügten Seiten gemeinsam.",
        );
      return !!result;
    } catch (error) {
      if (token === epoch.current)
        onError(
          error instanceof Error
            ? error.message
            : "PDF konnte nicht hinzugefügt werden.",
        );
    } finally {
      if (token === epoch.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  const save = useCallback(async () => {
    const c = client.current;
    if (!c || lock.current || current.current.state.readOnly) return;
    if (!supportsPdfSave()) {
      onError(PDF_SAVE_UNAVAILABLE);
      return;
    }
    if (freeTextRef.current) {
      onError("Bitte den Textkommentar zuerst bestätigen oder abbrechen.");
      return;
    }
    if (current.current.formDirty) {
      onError("Bitte die Eigenschaften zuerst übernehmen oder verwerfen.");
      return;
    }
    const token = epoch.current;
    lock.current = true;
    setBusy(true);
    setNotice(usesNativeSave() ? "PDF speichern …" : "");
    onError("");
    let savedFileName: string | null = null;
    try {
      const r = await c.request({ type: "export" });
      if (token !== epoch.current) return;
      const result = await savePdf(
        r.bytes!,
        name.replace(/\.pdf$/i, "") + "-annotiert.pdf",
      );
      if (token !== epoch.current) return;
      if (result.status === "cancelled") {
        setNotice(
          r.editor!.dirty
            ? "Speichern abgebrochen. Änderungen bleiben ungesichert."
            : "Speichern abgebrochen.",
        );
        return;
      }
      if (result.status === "saved") savedFileName = result.fileName;
      const ack = await c.request({
        type: "ack-export",
        revision: r.editor!.revision,
      });
      if (token !== epoch.current) return;
      setState(ack.editor!);
      setNotice(
        result.status === "saved"
          ? `PDF gespeichert: ${result.fileName}`
          : "PDF-Download gestartet. Bitte die heruntergeladene Datei prüfen.",
      );
    } catch (e) {
      if (token === epoch.current) {
        if (savedFileName) {
          setNotice(`PDF gespeichert: ${savedFileName}`);
          onError(
            "Die PDF wurde gespeichert, aber die App konnte den Bearbeitungsstatus nicht aktualisieren. Bitte die gespeicherte Datei öffnen und prüfen.",
          );
        } else {
          setNotice("");
          onError(e instanceof Error ? e.message : "Export fehlgeschlagen.");
        }
      }
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
  const editContext = useCallback(() => {
    const cur = current.current;
    const context = contextRef.current;
    if (
      !context ||
      context.mode !== "selection" ||
      cur.tool !== "select" ||
      lock.current ||
      cur.formDirty ||
      cur.state.readOnly ||
      freeTextRef.current ||
      cur.selection.length !== 1
    )
      return;
    const item = cur.items.find(
      (a) =>
        a.id === cur.selection[0] &&
        a.page === context.page &&
        a.editable &&
        (a.type === "FreeText" || a.type === "Text"),
    );
    if (!item || item.page !== cur.layout.page) return;
    showDraft(null);
    closeContext();
    showFreeText({
      page: item.page,
      point: context.point,
      contents: item.contents,
      error: "",
      annotation: item,
      style: {
        color: item.color,
        backgroundColor: item.backgroundColor ?? "#fff6a5",
        transparent: item.backgroundColor == null,
        fontSize: item.fontSize,
      },
    });
  }, [closeContext, showDraft, showFreeText]);
  const cancelFreeText = useCallback(() => {
    if (lock.current || !freeTextRef.current) return;
    showFreeText(null);
    showDraft(null);
    setTool("select");
  }, [showDraft, showFreeText]);
  const escape = useCallback(
    (event?: KeyboardEvent) => {
      if (freeTextRef.current) {
        // A submitted native operation cannot be cancelled mid-transaction.
        // Consume Escape during that brief interval without losing its text.
        cancelFreeText();
        return true;
      }
      if (contextRef.current) {
        closeContext();
        return true;
      }
      const target = event?.target;
      if (
        current.current.formDirty ||
        (target instanceof HTMLElement &&
          target.closest(
            "input,textarea,select,[contenteditable]:not([contenteditable=false])",
          ))
      )
        return false;
      showDraft(null);
      if (current.current.tool === "select") setSelection([]);
      setTool("select");
      return true;
    },
    [cancelFreeText, closeContext, showDraft],
  );
  const setFreeTextContents = useCallback(
    (contents: string) => {
      const value = freeTextRef.current;
      if (!value || lock.current) return;
      showFreeText({ ...value, contents: contents.slice(0, 10000), error: "" });
    },
    [showFreeText],
  );
  function setFreeTextDialogStyle(update: SetStateAction<FreeTextStyle>) {
    const value = freeTextRef.current;
    if (!value || lock.current) return;
    if (value.annotation) {
      const style = value.style!;
      showFreeText({
        ...value,
        style: typeof update === "function" ? update(style) : update,
        error: "",
      });
    } else {
      setFreeTextStyle(update);
      if (value.error) showFreeText({ ...value, error: "" });
    }
  }
  async function confirmFreeText() {
    const value = freeTextRef.current;
    if (!value || lock.current) return;
    const style = value.style ?? freeTextStyle;
    const original = value.annotation;
    const validFont =
      original?.type === "Text" ||
      (original && style.fontSize === original.fontSize) ||
      (Number.isFinite(style.fontSize) &&
        style.fontSize >= 6 &&
        style.fontSize <= 96);
    if (
      ((!original || (original.type === "FreeText" && original.autoSize)) &&
        !value.contents.trim()) ||
      value.contents.length > 10000 ||
      !validFont
    )
      return;
    const patch = original ? textEditPatch(value, style) : null;
    if (patch && !Object.keys(patch).length) {
      showFreeText(null);
      return;
    }
    const token = epoch.current;
    showFreeText({ ...value, error: "" });
    const result = await edit(
      original
        ? {
            action: "update",
            page: value.page,
            id: original.id,
            patch: patch!,
          }
        : {
            action: "create",
            page: value.page,
            kind: "FreeText",
            anchor: value.point,
            rect: [
              value.point.x,
              value.point.y,
              value.point.x + 0.01,
              value.point.y + 0.01,
            ],
            contents: value.contents,
            color: style.color,
            backgroundColor: style.transparent ? null : style.backgroundColor,
            fontSize: style.fontSize,
            width: 1,
            autoSize: true,
          },
      true,
    );
    if (token !== epoch.current) return;
    if (result) showFreeText(null);
    else
      showFreeText({
        ...value,
        error:
          editError.current ??
          (original
            ? "Die Annotation konnte nicht geändert werden. Bitte erneut versuchen."
            : "Der Textkommentar konnte nicht erstellt werden. Bitte erneut versuchen."),
      });
  }
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
          setPendingInk([]);
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
  const deleteSelection = useCallback(() => {
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
      return false;
    showDraft(null);
    closeContext();
    void edit({
      action: "delete-many",
      page: cur.layout.page,
      ids: cur.selection,
    }).then((result) => {
      if (result)
        setNotice(
          `${cur.selection.length} ${cur.selection.length === 1 ? "Markierung" : "Markierungen"} gelöscht.`,
        );
    });
    return true;
  }, [closeContext, edit, showDraft]);
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
          "Bild eingefügt. Zum Skalieren zuerst auswählen und an den Eckgriffen ziehen.",
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
    void insertImage(readClipboardImage);
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
  function selectionContains(point: Point, page: number) {
    const cur = current.current;
    const bounds = selectionBounds(cur.items, page, cur.selection);
    return (
      !!bounds &&
      point.x >= bounds[0] &&
      point.x <= bounds[2] &&
      point.y >= bounds[1] &&
      point.y <= bounds[3]
    );
  }
  function selectionContextAt(p: Point) {
    const cur = current.current,
      at = locate(p);
    return (
      cur.tool === "select" &&
      !cur.formDirty &&
      !cur.state.readOnly &&
      !!at &&
      at.page === cur.layout.page &&
      selectionContains(at.point, at.page)
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
    const inSelection = selectionContains(at.point, at.page);
    // The existing selection takes precedence over empty space or other objects
    // inside its frame. Outside it, ordinary precise hit testing still applies.
    const item = inSelection ? undefined : hit(at.point, at.page);
    if (item && !item.editable) return false;
    if (item && !cur.selection.includes(item.id)) setSelection([item.id]);
    showDraft(null);
    document
      .querySelectorAll<HTMLElement>(".compact-menu:popover-open")
      .forEach((menu) => menu.hidePopover());
    const value: AnnotationContext = {
      mode: inSelection || item ? "selection" : "blank",
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
    (freeTextDraft !== null &&
      (freeTextDraft.annotation
        ? Object.keys(textEditPatch(freeTextDraft, freeTextDraft.style!))
            .length > 0
        : freeTextDraft.contents.length > 0)) ||
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
      if (
        e.defaultPrevented ||
        typing(e.target) ||
        freeTextRef.current ||
        !client.current
      )
        return;
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
        if (!typing(e.target) && !freeTextRef.current)
          clipboardActions.current.paste();
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (freeTextRef.current) {
        // Keep native textarea editing/clipboard/undo intact; never export the
        // underlying PDF or run annotation shortcuts from inside this dialog.
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s")
          e.preventDefault();
        return;
      }
      if (
        (e.key === "Delete" ||
          (e.key === "Backspace" && /^Mac/i.test(navigator.platform))) &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey &&
        !e.repeat &&
        !e.isComposing &&
        !typing(e.target) &&
        !draftRef.current &&
        !document.querySelector(openControlSelector) &&
        deleteSelection()
      )
        e.preventDefault();
      if (!(e.ctrlKey || e.metaKey) || !client.current) return;
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
      const isTyping = typing(e.target);
      if (
        !isTyping &&
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
        !isTyping &&
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
  }, [client, deleteSelection, edit, save, onError]);
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
    if (
      lock.current ||
      cur.state.readOnly ||
      cur.formDirty ||
      freeTextRef.current
    )
      return false;
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
    if (d.kind === "FreeText") {
      closeContext();
      showFreeText({ page: d.page, point: start, contents: "", error: "" });
      return;
    }
    const info = cur.layout.pages[d.page];
    // Text placement uses display-space extents, then returns to canonical PDF space.
    const display = transform(start, info.pdfToPage);
    const w = 24,
      h = 24;
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
    const pendingId = d.kind === "Ink" ? ++nextPendingInk.current : null;
    const token = epoch.current;
    if (pendingId !== null)
      setPendingInk((items) => [
        ...items,
        {
          id: pendingId,
          draft: d,
          color: cur.color,
          width: cur.width,
          revision: null,
        },
      ]);
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
    }).then((result) => {
      if (pendingId === null || token !== epoch.current) return;
      const revision = result?.editor?.revision;
      setPendingInk((items) =>
        items.flatMap((item) => {
          if (item.id !== pendingId) return [item];
          if (
            revision === undefined ||
            (displayedRevision.current ?? -1) >= revision
          )
            return [];
          return [{ ...item, revision }];
        }),
      );
    });
  }
  return {
    editContext,
    canEditContext:
      contextMenu?.mode === "selection" &&
      !busy &&
      !formDirty &&
      !state.readOnly &&
      selection.length === 1 &&
      items.some(
        (a) =>
          a.id === selection[0] &&
          a.page === contextMenu.page &&
          a.editable &&
          (a.type === "FreeText" || a.type === "Text"),
      ),
    freeTextDraft,
    freeTextDialogStyle: freeTextDraft?.style ?? freeTextStyle,
    setFreeTextDialogStyle,
    freeTextStyle,
    setFreeTextStyle,
    setFreeTextContents,
    confirmFreeText,
    cancelFreeText,
    escape,
    pendingInk,
    displayed,
    contextMenu,
    insertPdf,
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
    formDirty: formDirty || freeTextDraft !== null,
    setFormDirty,
    unsaved,
    beginDocumentChange,
    endDocumentChange,
    reset,
    edit,
    save,
    gesture: {
      selectionContextAt,
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
