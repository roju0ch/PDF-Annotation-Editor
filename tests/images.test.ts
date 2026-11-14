import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { expect, it } from "vitest";
import { AnnotationEditor } from "../src/adapters/pdf/annotations";
import {
  imageInfo,
  imagePlacement,
  resizeImage,
} from "../src/core/annotations/image";
import { inverse, transform } from "../src/core/viewport";
function picture() {
  const pix = new mupdf.Pixmap(
    mupdf.ColorSpace.DeviceRGB,
    [0, 0, 100, 50],
    true,
  );
  try {
    const data = pix.getPixels();
    for (let y = 0; y < 50; y++)
      for (let x = 0; x < 100; x++) {
        const i = (y * 100 + x) * 4;
        data[i] = x < 50 ? 255 : 0;
        data[i + 1] = x >= 50 ? 255 : 0;
        data[i + 2] = 0;
        data[i + 3] = y < 25 ? 255 : 128;
      }
    return new Uint8Array(pix.asPNG());
  } finally {
    pix.destroy();
  }
}
function assertPixels(doc: mupdf.PDFDocument, page: number, id: number) {
  const p = doc.loadPage(page);
  try {
    const a = p
      .getAnnotations()
      .find((a) => a.getObject().asIndirect() === id)!;
    const [x, y, x1, y1] = a.getRect();
    const pix = p.toPixmap(
      mupdf.Matrix.identity,
      mupdf.ColorSpace.DeviceRGB,
      false,
      true,
    );
    try {
      const at = (u: number, v: number) => {
        const i =
          (Math.floor(y + (y1 - y) * v) * pix.getWidth() +
            Math.floor(x + (x1 - x) * u)) *
          3;
        return [...pix.getPixels().slice(i, i + 3)];
      };
      expect(at(0.25, 0.25)).toEqual([255, 0, 0]);
      expect(at(0.75, 0.25)).toEqual([0, 255, 0]);
    } finally {
      pix.destroy();
    }
  } finally {
    p.destroy();
  }
}
for (const index of [0, 1, 2])
  it(`native image round trip, proportional resize and copy on page ${index}`, () => {
    const original = new Uint8Array(readFileSync("artifacts/fixture.pdf"));
    const doc = new mupdf.PDFDocument(original),
      editor = new AnnotationEditor(doc, original);
    try {
      const page = doc.loadPage(index),
        matrix = page.getTransform();
      const rect = mupdf.Rect.transform([30, 240, 130, 290], inverse(matrix));
      page.destroy();
      const id = editor.apply({
        action: "create-image",
        page: index,
        bytes: picture(),
        rect,
        contents: "Screenshot",
      })!;
      expect(editor.list(index).find((a) => a.id === id)).toMatchObject({
        type: "Stamp",
        editable: true,
        contents: "Screenshot",
      });
      assertPixels(doc, index, id);
      const p = doc.loadPage(index),
        a = p.getAnnotations().find((a) => a.getObject().asIndirect() === id)!;
      expect(a.getObject().get("AP", "N").isStream()).toBe(true);
      expect(a.getFlags() & mupdf.PDFAnnotation.IS_PRINT).toBeTruthy();
      expect(
        a
          .getObject()
          .get("AP", "N", "Resources", "XObject", "I", "SMask")
          .isStream(),
      ).toBe(true);
      p.destroy();
      const resized = resizeImage(rect, 2, {
        x: rect[2] + (rect[2] - rect[0]) * 0.5,
        y: rect[3] + (rect[3] - rect[1]) * 0.5,
      });
      editor.apply({
        action: "update",
        page: index,
        id,
        patch: { rect: resized, contents: "Bildkommentar" },
      });
      assertPixels(doc, index, id);
      editor.apply({ action: "undo" });
      expect(editor.list(index).find((a) => a.id === id)!.rect).toEqual(rect);
      editor.apply({ action: "redo" });
      const clip = editor.copy(index, [id]),
        target = (index + 1) % 3;
      const tp = doc.loadPage(target),
        point = transform({ x: 30, y: 240 }, inverse(tp.getTransform()));
      tp.destroy();
      const [copy] = editor.apply({
        action: "paste",
        page: target,
        point,
        clipboard: clip,
      });
      assertPixels(doc, target, copy);
      editor.apply({
        action: "move",
        page: target,
        ids: [copy],
        offset: { x: 5, y: 5 },
      });
      editor.apply({
        action: "update",
        page: target,
        id: copy,
        patch: { contents: "Kopie" },
      });
      const bytes = editor.export(),
        reopened = new mupdf.PDFDocument(bytes),
        check = new AnnotationEditor(reopened, bytes);
      try {
        expect(reopened.wasRepaired()).toBe(false);
        const copied = check.list(target).find((a) => a.contents === "Kopie")!;
        expect(copied.type).toBe("Stamp");
        assertPixels(reopened, target, copied.id);
        check.apply({ action: "delete-many", page: target, ids: [copied.id] });
        expect(check.list(target).some((a) => a.id === copied.id)).toBe(false);
        check.apply({ action: "undo" });
        assertPixels(reopened, target, copied.id);
      } finally {
        reopened.destroy();
      }
    } finally {
      doc.destroy();
    }
  });
it("rejects malformed/oversized images atomically and rejects distorted resizing", () => {
  const original = new Uint8Array(readFileSync("artifacts/fixture.pdf"));
  const doc = new mupdf.PDFDocument(original),
    editor = new AnnotationEditor(doc, original);
  try {
    const before = editor.list(0),
      state = editor.state();
    for (const bytes of [
      new Uint8Array([1, 2]),
      new Uint8Array(21 * 1024 * 1024),
      picture().slice(0, 24),
    ]) {
      expect(() =>
        editor.apply({
          action: "create-image",
          page: 0,
          bytes,
          rect: [10, 10, 110, 60],
          contents: "",
        }),
      ).toThrow();
      expect(editor.list(0)).toEqual(before);
      expect(editor.state()).toEqual(state);
    }
    const huge = picture();
    new DataView(huge.buffer).setUint32(16, 100000);
    expect(() => imageInfo(huge)).toThrow(/groß/);
    const id = editor.apply({
      action: "create-image",
      page: 0,
      bytes: picture(),
      rect: [10, 10, 110, 60],
      contents: "",
    })!;
    expect(() =>
      editor.apply({
        action: "update",
        page: 0,
        id,
        patch: { rect: [10, 10, 110, 90] },
      }),
    ).toThrow(/Seitenverhältnis/);
  } finally {
    doc.destroy();
  }
});
it("fits initial images on the page and keeps all resize corners proportional", () => {
  expect(
    imagePlacement(2000, 1000, { width: 300, height: 400 }, { x: 290, y: 390 }),
  ).toEqual([120, 310, 300, 400]);
  for (const corner of [0, 1, 2, 3]) {
    const rect = resizeImage([10, 20, 210, 120], corner, { x: 500, y: 500 });
    expect((rect[2] - rect[0]) / (rect[3] - rect[1])).toBeCloseTo(2);
    expect(
      Math.min(rect[2] - rect[0], rect[3] - rect[1]),
    ).toBeGreaterThanOrEqual(8);
  }
});
