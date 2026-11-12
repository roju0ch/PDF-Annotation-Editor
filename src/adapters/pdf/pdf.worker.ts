import * as mupdf from "mupdf";
import type { Request, Reply, PageInfo } from "./types";
let doc: mupdf.PDFDocument | undefined;
let pages: PageInfo[] = [];
self.onmessage = ({ data: r }: MessageEvent<Request>) => {
  try {
    if (r.type === "open") {
      doc?.destroy();
      doc = undefined;
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
        const n = candidate.countPages();
        if (n < 1 || n > 2000)
          throw new Error("Bitte eine PDF mit 1 bis 2000 Seiten öffnen.");
        pages = Array.from({ length: n }, (_, i) => {
          const p = candidate.loadPage(i);
          try {
            const b = p.getBounds();
            const width = b[2] - b[0],
              height = b[3] - b[1];
            if (
              !Number.isFinite(width + height) ||
              width <= 0 ||
              height <= 0 ||
              width > 20000 ||
              height > 20000
            )
              throw new Error("Nicht unterstützte Seitengröße.");
            return {
              width,
              height,
              origin: [b[0], b[1]],
              pdfToPage: p.getTransform(),
            };
          } finally {
            p.destroy();
          }
        });
        doc = candidate;
      } catch (e) {
        candidate.destroy();
        throw e;
      }
      self.postMessage({ id: r.id, pages } satisfies Reply);
    } else {
      if (!doc) throw new Error("Keine PDF geöffnet.");
      const info = pages[r.page];
      // Bound each raster to 4 MP / 4096 px; CSS zoom remains immediate.
      const scale = Math.min(
        r.scale,
        Math.sqrt(4_000_000 / (info.width * info.height)),
        4096 / Math.max(info.width, info.height),
      );
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
