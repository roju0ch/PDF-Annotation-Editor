import { pageInfos } from "./pages";
import { TileRasterizer } from "./raster";
import { AnnotationEditor } from "./annotations";
import * as mupdf from "mupdf";
import type { Request, Reply, PageInfo } from "./types";
let doc: mupdf.PDFDocument | undefined;
let pages: PageInfo[] = [];
let editor: AnnotationEditor | undefined;
let rasterizer: TileRasterizer | undefined;
self.onmessage = ({ data: r }: MessageEvent<Request>) => {
  try {
    if (r.type === "open") {
      rasterizer?.clear();
      rasterizer = undefined;
      doc?.destroy();
      doc = undefined;
      editor = undefined;
      mupdf.emptyStore();
      const candidate = new mupdf.PDFDocument(r.data);
      try {
        if (candidate.needsPassword())
          throw new Error(
            "Passwortgeschützte PDFs werden in diesem Prototyp noch nicht unterstützt.",
          );
        if (candidate.wasRepaired())
          throw new Error(
            "Die PDF ist beschädigt und müsste repariert werden. Bitte eine intakte Datei verwenden.",
          );
        pages = pageInfos(candidate);
        editor = new AnnotationEditor(candidate, new Uint8Array(r.data));
        doc = candidate;
        rasterizer = new TileRasterizer(candidate);
      } catch (e) {
        candidate.destroy();
        throw e;
      }
      self.postMessage({
        id: r.id,
        pages,
        editor: editor!.state(),
      } satisfies Reply);
    } else if (r.type === "select-text") {
      if (!doc?.hasPermission("copy"))
        throw new Error("Diese PDF erlaubt das Kopieren von Text nicht.");
      const info = pages[r.page];
      if (!rasterizer || info?.id !== r.pageId || info.rotation !== r.rotation)
        self.postMessage({ id: r.id, stale: true } satisfies Reply);
      else
        self.postMessage({
          id: r.id,
          textSelection: rasterizer.pageText(r.page, info).select(r.query),
        } satisfies Reply);
    } else if (r.type === "list") {
      if (!editor) throw new Error("Keine PDF geöffnet.");
      self.postMessage({
        id: r.id,
        annotations: editor.list(r.page),
        editor: editor.state(),
      } satisfies Reply);
    } else if (r.type === "copy") {
      if (!editor) throw new Error("Keine PDF geöffnet.");
      const clipboard = editor.copy(r.page, r.ids);
      if (r.cut) {
        rasterizer?.invalidateAnnotations();
        editor.apply({ action: "delete-many", page: r.page, ids: r.ids });
      }
      self.postMessage({
        id: r.id,
        clipboard,
        editor: editor.state(),
      } satisfies Reply);
    } else if (r.type === "edit") {
      if (!editor) throw new Error("Keine PDF geöffnet.");
      rasterizer?.invalidateAnnotations();
      const before = pages.map((p) => `${p.id}:${p.rotation}`);
      const selected = editor.apply(r.command);
      const structural = [
        "rotate-page",
        "reorder-pages",
        "delete-pages",
        "insert-pdf",
        "undo",
        "redo",
      ].includes(r.command.action);
      const after = structural
        ? Array.from({ length: doc!.countPages() }, (_, i) => {
            const page = doc!.findPage(i);
            return `${page.asIndirect()}:${page.getInheritable("Rotate").asNumber()}`;
          })
        : before;
      const changed =
        before.length !== after.length ||
        after.some((id, i) => id !== before[i]);
      if (changed) {
        rasterizer?.clear();
        pages = pageInfos(doc!);
      }
      self.postMessage({
        ...(changed
          ? {
              pages,
              focusPage:
                r.command.action === "insert-pdf" ? r.command.at : undefined,
            }
          : {}),
        id: r.id,
        selected,
        editor: editor.state(),
      } satisfies Reply);
    } else if (r.type === "export") {
      if (!editor) throw new Error("Keine PDF geöffnet.");
      const bytes = editor.export();
      self.postMessage(
        { id: r.id, bytes, editor: editor.state() } satisfies Reply,
        { transfer: [bytes.buffer] },
      );
    } else if (r.type === "ack-export") {
      if (!editor) throw new Error("Keine PDF geöffnet.");
      editor.acknowledgeExport(r.revision);
      self.postMessage({ id: r.id, editor: editor.state() } satisfies Reply);
    } else if (
      r.type === "annotation-bounds" ||
      r.type === "render-annotation-patch"
    ) {
      if (!rasterizer || !editor) throw new Error("Keine PDF geöffnet.");
      const rasterRevision = editor.state().revision;
      if (r.revision !== rasterRevision) {
        self.postMessage({
          id: r.id,
          stale: true,
          rasterRevision,
        } satisfies Reply);
      } else if (r.type === "annotation-bounds") {
        if (!Array.isArray(r.pages) || r.pages.length > 32)
          throw new Error("Zu viele PDF-Seiten angefordert.");
        const annotationBounds = [...new Set(r.pages)].map((page) => ({
          page,
          bounds: rasterizer!.annotationBounds(pages[page], page),
        }));
        self.postMessage({
          id: r.id,
          rasterRevision,
          annotationBounds,
        } satisfies Reply);
      } else {
        const result = rasterizer.composite(pages[r.page], r, r.background);
        self.postMessage(
          { id: r.id, ...result, rasterRevision } satisfies Reply,
          { transfer: [result.pixels.buffer] },
        );
      }
    } else if (r.type === "render-tile") {
      if (!rasterizer || !editor) throw new Error("Keine PDF geöffnet.");
      const result = rasterizer.render(pages[r.page], r, { split: r.split });
      self.postMessage(
        {
          id: r.id,
          ...result,
          rasterRevision: editor.state().revision,
        } satisfies Reply,
        {
          transfer: [
            result.pixels.buffer,
            ...(result.overlayPixels ? [result.overlayPixels.buffer] : []),
          ],
        },
      );
    } else {
      if (!doc) throw new Error("Keine PDF geöffnet.");
      const info = pages[r.page];
      // Bound each raster to 4 MP / 4096 px; CSS zoom remains immediate.
      const scale = Math.min(
        r.scale,
        Math.sqrt(4_000_000 / (info.width * info.height)),
        4096 / Math.max(info.width, info.height),
      );
      if (r.split) {
        if (!rasterizer || !editor) throw new Error("Keine PDF geöffnet.");
        const result = rasterizer.render(
          info,
          {
            page: r.page,
            scale,
            x: 0,
            y: 0,
            width: Math.ceil(info.width * scale),
            height: Math.ceil(info.height * scale),
          },
          { split: true, overview: true },
        );
        self.postMessage(
          {
            id: r.id,
            ...result,
            rasterRevision: editor.state().revision,
          } satisfies Reply,
          {
            transfer: [
              result.pixels.buffer,
              ...(result.overlayPixels ? [result.overlayPixels.buffer] : []),
            ],
          },
        );
        return;
      }
      const p = doc.loadPage(r.page);
      try {
        const pix = p.toPixmap(
          [
            scale,
            0,
            0,
            scale,
            -info.origin[0] * scale,
            -info.origin[1] * scale,
          ],
          mupdf.ColorSpace.DeviceRGB,
          true,
          true,
        );
        try {
          const pixels = new Uint8ClampedArray(pix.getPixels());
          self.postMessage(
            {
              id: r.id,
              pixels,
              width: pix.getWidth(),
              height: pix.getHeight(),
            } satisfies Reply,
            { transfer: [pixels.buffer] },
          );
        } finally {
          pix.destroy();
        }
      } finally {
        p.destroy();
        mupdf.shrinkStore(50);
      }
    }
  } catch (e) {
    self.postMessage({
      id: r.id,
      error:
        e instanceof Error ? e.message : "PDF konnte nicht verarbeitet werden.",
    } satisfies Reply);
  }
};

// Top-level WASM initialization is asynchronous: announce handler readiness.
self.postMessage({ id: 0 } satisfies Reply);
