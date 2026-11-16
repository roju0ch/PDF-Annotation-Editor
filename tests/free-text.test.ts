import { readFileSync, writeFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { describe, expect, it } from "vitest";
import { AnnotationEditor } from "../src/adapters/pdf/annotations";
import { inverse, transform } from "../src/core/viewport";

const input = () => new Uint8Array(readFileSync("artifacts/fixture.pdf"));
function setup() {
  const bytes = input(),
    doc = new mupdf.PDFDocument(bytes);
  return { doc, editor: new AnnotationEditor(doc, bytes) };
}
function create(
  editor: AnnotationEditor,
  doc: mupdf.PDFDocument,
  contents: string,
  page = 0,
  x = 30,
  y = 80,
  fontSize = 14,
) {
  const p = doc.loadPage(page);
  const anchor = transform({ x, y }, inverse(p.getTransform()));
  p.destroy();
  return editor.apply({
    action: "create",
    page,
    kind: "FreeText",
    rect: [anchor.x, anchor.y, anchor.x + 0.01, anchor.y + 0.01],
    anchor,
    autoSize: true,
    contents,
    color: "#123456",
    backgroundColor: "#fff0a0",
    width: 1,
    fontSize,
  })!;
}
function appearance(doc: mupdf.PDFDocument, page: number, id: number) {
  const p = doc.loadPage(page);
  const a = p.getAnnotations().find((a) => a.getObject().asIndirect() === id)!;
  const list = a.toDisplayList(),
    text = list.toStructuredText({});
  try {
    const quads: number[][] = [];
    text.walk({
      onChar(c, _origin, _font, _size, quad) {
        if (c.trim()) quads.push(quad);
      },
    });
    return {
      text: text.asText(),
      rect: a.getRect(),
      quads,
      object: a.getObject().resolve().toString(),
    };
  } finally {
    text.destroy();
    list.destroy();
    p.destroy();
  }
}

describe("native automatically sized FreeText", () => {
  it.each(
    [0, 1].flatMap((page) => [6, 18, 48, 96].map((size) => ({ page, size }))),
  )(
    "contains actual ascender/descender quads at $size pt on page $page",
    ({ page, size }) => {
      const { doc, editor } = setup();
      try {
        const id = create(editor, doc, "Ägyp\nÖü", page, 10, 20, size);
        const ap = appearance(doc, page, id);
        expect(ap.text.replace(/\s/g, "")).toBe("ÄgypÖü");
        for (const q of ap.quads) {
          const xs = q.filter((_, i) => i % 2 === 0),
            ys = q.filter((_, i) => i % 2 === 1);
          expect(Math.min(...xs)).toBeGreaterThanOrEqual(ap.rect[0] + 2);
          expect(Math.max(...xs)).toBeLessThanOrEqual(ap.rect[2] - 2);
          expect(Math.min(...ys)).toBeGreaterThanOrEqual(ap.rect[1] + 2);
          expect(Math.max(...ys)).toBeLessThanOrEqual(ap.rect[3] - 2);
        }
      } finally {
        doc.destroy();
      }
    },
  );
  it("persists original multiline text, native background and padded non-clipped appearance", () => {
    const { doc, editor } = setup();
    try {
      const contents = "Erste Zeile äöü\n\nDritte Zeile\nLetzte Zeile gyp";
      const id = create(editor, doc, contents);
      const item = editor.list(0).find((a) => a.id === id)!;
      expect(item).toMatchObject({
        type: "FreeText",
        contents,
        color: "#123456",
        backgroundColor: "#fff0a0",
        autoSize: true,
        fontSize: 14,
      });
      const bytes = editor.export();
      writeFileSync("artifacts/free-text-native.pdf", bytes);
      const reopened = new mupdf.PDFDocument(bytes);
      try {
        const copy = new AnnotationEditor(reopened, bytes)
          .list(0)
          .find((a) => a.id === id)!;
        expect(copy).toEqual(item);
        const ap = appearance(reopened, 0, id);
        expect(ap.text.replace(/\s/g, "")).toBe(contents.replace(/\s/g, ""));
        expect(ap.quads.length).toBeGreaterThan(20);
        for (const q of ap.quads) {
          const xs = q.filter((_, i) => i % 2 === 0),
            ys = q.filter((_, i) => i % 2 === 1);
          expect(Math.min(...xs)).toBeGreaterThanOrEqual(ap.rect[0] + 2);
          expect(Math.max(...xs)).toBeLessThanOrEqual(ap.rect[2] - 2);
          expect(Math.min(...ys)).toBeGreaterThanOrEqual(ap.rect[1]);
          expect(Math.max(...ys)).toBeLessThanOrEqual(ap.rect[3]);
        }
        expect(ap.object).toContain("/Subtype/FreeText");
        expect(ap.object).toContain("/PDFAnnotationEditorAutoSize 1");
      } finally {
        reopened.destroy();
      }
    } finally {
      doc.destroy();
    }
  });

  it("uses real font advances instead of a fixed size and wraps long unbroken words", () => {
    const { doc, editor } = setup();
    try {
      const narrow = create(editor, doc, "iii"),
        wide = create(editor, doc, "WWW", 0, 30, 120);
      const nr = editor.list(0).find((a) => a.id === narrow)!.rect,
        wr = editor.list(0).find((a) => a.id === wide)!.rect;
      expect(wr[2] - wr[0]).toBeGreaterThan(nr[2] - nr[0] + 15);
      const contents = "W".repeat(75),
        id = create(editor, doc, contents, 0, 20, 160);
      const ap = appearance(doc, 0, id);
      expect(ap.text.replace(/\s/g, "")).toBe(contents);
      const yPositions = new Set(ap.quads.map((q) => Math.round(q[1])));
      expect(yPositions.size).toBeGreaterThan(2);
      expect(ap.rect[2]).toBeLessThanOrEqual(298);
    } finally {
      doc.destroy();
    }
  });

  it.each([0, 1])(
    "keeps an edge placement inside cropped/rotated page %i and text upright",
    (page) => {
      const { doc, editor } = setup();
      try {
        const p = doc.loadPage(page),
          bounds = p.getBounds();
        p.destroy();
        const id = create(
          editor,
          doc,
          "Links\nRechts",
          page,
          bounds[2] - 1,
          bounds[3] - 1,
          18,
        );
        const ap = appearance(doc, page, id);
        expect(ap.rect[0]).toBeGreaterThanOrEqual(bounds[0]);
        expect(ap.rect[1]).toBeGreaterThanOrEqual(bounds[1]);
        expect(ap.rect[2]).toBeLessThanOrEqual(bounds[2]);
        expect(ap.rect[3]).toBeLessThanOrEqual(bounds[3]);
        const firstLine = ap.quads.slice(0, 5);
        expect(firstLine[0][0]).toBeLessThan(firstLine[4][0]);
        expect(firstLine[0][1]).toBeCloseTo(firstLine[4][1], 2);
        expect(ap.text.replace(/\s/g, "")).toBe("LinksRechts");
      } finally {
        doc.destroy();
      }
    },
  );

  it("resizes own annotations after reopen and preserves their appearance on move/paste/undo", () => {
    const { doc, editor } = setup();
    try {
      const id = create(editor, doc, "Kurz"),
        initial = editor.list(0).find((a) => a.id === id)!;
      const contents = "LangeZeile".repeat(12) + "\nWeitere Zeile";
      editor.apply({
        action: "update",
        page: 0,
        id,
        patch: { contents, fontSize: 16, backgroundColor: null },
      });
      const item = editor.list(0).find((a) => a.id === id)!;
      expect(item.rect[3] - item.rect[1]).toBeGreaterThan(
        initial.rect[3] - initial.rect[1],
      );
      expect(item.backgroundColor).toBeNull();
      editor.apply({
        action: "move",
        page: 0,
        ids: [id],
        offset: { x: 1, y: 2 },
      });
      expect(appearance(doc, 0, id).text.replace(/\s/g, "")).toBe(
        contents.replace(/\s/g, ""),
      );
      const copied = editor.copy(0, [id]);
      const p = doc.loadPage(1),
        anchor = transform({ x: 30, y: 50 }, inverse(p.getTransform()));
      p.destroy();
      const pasted = editor.apply({
        action: "paste",
        page: 1,
        point: anchor,
        clipboard: copied,
      })[0];
      expect(appearance(doc, 1, pasted).text.replace(/\s/g, "")).toBe(
        contents.replace(/\s/g, ""),
      );
      editor.apply({ action: "undo" });
      editor.apply({ action: "redo" });
      const bytes = editor.export(),
        reopened = new mupdf.PDFDocument(bytes);
      try {
        const e = new AnnotationEditor(reopened, bytes);
        e.apply({
          action: "update",
          page: 0,
          id,
          patch: { contents: "Wieder kurz", backgroundColor: "#abcdef" },
        });
        expect(e.list(0).find((a) => a.id === id)!.backgroundColor).toBe(
          "#abcdef",
        );
        expect(appearance(reopened, 0, id).text.replace(/\s/g, "")).toBe(
          "Wiederkurz",
        );
      } finally {
        reopened.destroy();
      }
    } finally {
      doc.destroy();
    }
  });

  it("does not resize foreign FreeText on text/font/background edits", () => {
    const { doc, editor } = setup();
    try {
      const id = editor.apply({
        action: "create",
        page: 0,
        kind: "FreeText",
        rect: [20, 60, 200, 120],
        contents: "Fremdes Textfeld",
        color: "#000000",
        width: 1,
        fontSize: 14,
      })!;
      const before = editor.list(0).find((a) => a.id === id)!;
      expect(before.autoSize).toBe(false);
      editor.apply({
        action: "update",
        page: 0,
        id,
        patch: {
          contents: "Geändert",
          fontSize: 24,
          backgroundColor: "#ddeeff",
        },
      });
      const after = editor.list(0).find((a) => a.id === id)!;
      expect(after.rect).toEqual(before.rect);
      expect(after.backgroundColor).toBe("#ddeeff");
    } finally {
      doc.destroy();
    }
  });

  it("uses native fallback metrics for CJK and rejects unavailable glyphs or overflow atomically", () => {
    const { doc, editor } = setup();
    try {
      const id = create(editor, doc, "中文\nDeutsch äöü");
      expect(appearance(doc, 0, id).text.replace(/\s/g, "")).toBe(
        "中文Deutschäöü",
      );
      const before = editor.list(0),
        state = editor.state();
      for (const text of [" \n ", "Unbekannt 😀", "W".repeat(10000)]) {
        expect(() => create(editor, doc, text)).toThrow();
        expect(editor.list(0)).toEqual(before);
        expect(editor.state()).toEqual(state);
      }
    } finally {
      doc.destroy();
    }
  });
});
