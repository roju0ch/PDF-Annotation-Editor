import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { expect, it } from "vitest";
import { transform } from "../src/core/viewport";
import { AnnotationEditor } from "../src/adapters/pdf/annotations";

const input = () => new Uint8Array(readFileSync("artifacts/fixture.pdf"));
function setup() {
  const bytes = input(),
    doc = new mupdf.PDFDocument(bytes),
    editor = new AnnotationEditor(doc, bytes);
  const ids = (["Ink", "Text", "FreeText"] as const).map((kind, i) =>
    editor.apply({
      action: "create",
      page: 0,
      kind,
      rect: [40 + i * 30, 180, 70 + i * 30, 210],
      contents: kind,
      color: "#ff0000",
      width: 3,
      fontSize: 14,
      ink: [
        [
          { x: 40, y: 200 },
          { x: 80, y: 210 },
        ],
      ],
    })!,
  );
  return { doc, editor, ids };
}
it("copies immutable native snapshots, pastes to rotated pages, and replays pasted IDs for export", () => {
  const { doc, editor, ids } = setup();
  try {
    const state = editor.state();
    const clip = editor.copy(0, ids);
    expect(editor.state()).toEqual(state);
    editor.apply({
      action: "update",
      page: 0,
      id: ids[1],
      patch: { contents: "Changed after copy" },
    });
    const before = doc.getJournal().position;
    const pasted = editor.apply({
      action: "paste",
      page: 1,
      point: { x: 120, y: 200 },
      clipboard: clip,
    });
    expect(pasted).toHaveLength(3);
    expect(doc.getJournal().position).toBe(before + 1);
    const items = editor.list(1);
    expect(items.map((a) => a.contents)).toEqual(["Ink", "Text", "FreeText"]);
    const target = doc.loadPage(1),
      matrix = target.getTransform(),
      anchor = transform({ x: 120, y: 200 }, matrix);
    target.destroy();
    const sourceRects = clip.items.map((a) =>
      mupdf.Rect.transform(a.rect, clip.matrix),
    );
    const left = Math.min(...sourceRects.map((r) => r[0])),
      top = Math.min(...sourceRects.map((r) => r[1]));
    for (const [i, item] of items.entries()) {
      const rect = mupdf.Rect.transform(item.rect, matrix);
      expect(rect[0]).toBeCloseTo(sourceRects[i][0] - left + anchor.x, 3);
      expect(rect[1]).toBeCloseTo(sourceRects[i][1] - top + anchor.y, 3);
      expect(item.editable).toBe(true);
    }
    editor.apply({ action: "undo" });
    expect(editor.list(1)).toHaveLength(0);
    editor.apply({ action: "redo" });
    expect(editor.list(1)).toEqual(items);
    editor.apply({
      action: "move",
      page: 1,
      ids: pasted,
      offset: { x: 20, y: -10 },
    });
    editor.apply({ action: "delete-many", page: 0, ids });
    const savedBytes = editor.export(),
      saved = new mupdf.PDFDocument(savedBytes);
    try {
      const restored = new AnnotationEditor(saved, savedBytes);
      expect(saved.wasRepaired()).toBe(false);
      expect(restored.list(1)).toEqual(editor.list(1));
      expect(restored.list(0)).toEqual(editor.list(0));
    } finally {
      saved.destroy();
    }
  } finally {
    doc.destroy();
  }
});
it("preserves native opacity, border, appearance and custom properties without page or popup references", () => {
  const doc = new mupdf.PDFDocument(input()),
    page = doc.loadPage(0);
  const note = page.getAnnotations()[0];
  note.getObject().put("CA", 0.4);
  note.getObject().put("BS", { W: 2, S: "D", D: [2, 3] });
  note.getObject().put("PrivateTag", doc.newString("keep-me"));
  note.getObject().put("NM", doc.newString("old-identity"));
  note.getObject().put("P", page.getObject());
  note.update();
  const buffer = doc.saveToBuffer(""),
    bytes = new Uint8Array(buffer.asUint8Array());
  page.destroy();
  buffer.destroy();
  doc.destroy();
  const source = new mupdf.PDFDocument(bytes),
    editor = new AnnotationEditor(source, bytes);
  try {
    const id = editor.list(0)[0].id,
      clip = editor.copy(0, [id]);
    const [copy] = editor.apply({
      action: "paste",
      page: 0,
      point: { x: 40, y: 100 },
      clipboard: clip,
    });
    const p = source.loadPage(0),
      a = p.getAnnotations().find((a) => a.getObject().asIndirect() === copy)!;
    expect(a.getObject().get("CA").asNumber()).toBeCloseTo(0.4);
    expect(a.getObject().get("BS", "W").asNumber()).toBe(2);
    expect(a.getObject().get("BS", "D").asJS()).toEqual([2, 3]);
    expect(a.getObject().get("PrivateTag").asString()).toBe("keep-me");
    expect(a.getObject().get("NM").asString()).not.toBe("old-identity");
    expect(a.getObject().get("AP", "N").isStream()).toBe(true);
    p.destroy();
  } finally {
    source.destroy();
  }
});
it("cuts the whole group as one undoable edit and rejects invalid groups without partial deletion", () => {
  const { doc, editor, ids } = setup();
  try {
    const original = editor.list(0),
      state = editor.state();
    expect(() => editor.copy(0, [ids[0], 999999])).toThrow();
    expect(editor.state()).toEqual(state);
    expect(() =>
      editor.apply({ action: "delete-many", page: 0, ids: [ids[0], 999999] }),
    ).toThrow();
    expect(editor.list(0)).toEqual(original);
    const clip = editor.copy(0, ids);
    editor.apply({ action: "delete-many", page: 0, ids });
    expect(editor.list(0)).toHaveLength(original.length - 3);
    editor.apply({ action: "undo" });
    expect(editor.list(0)).toEqual(original);
    editor.apply({ action: "redo" });
    editor.apply({
      action: "paste",
      page: 0,
      point: { x: 50, y: 120 },
      clipboard: clip,
    });
    expect(editor.list(0)).toHaveLength(original.length);
    const bytes = editor.export(),
      exported = new mupdf.PDFDocument(bytes);
    expect(exported.wasRepaired()).toBe(false);
    exported.destroy();
  } finally {
    doc.destroy();
  }
});
it("rolls back failed pastes and remaps copied identities after branching history", () => {
  const { doc, editor, ids } = setup();
  try {
    const clip = editor.copy(0, ids),
      before = editor.list(0),
      state = editor.state();
    const bad = structuredClone(clip);
    bad.items[1].editable = false;
    expect(() =>
      editor.apply({
        action: "paste",
        page: 0,
        point: { x: 10, y: 50 },
        clipboard: bad,
      }),
    ).toThrow();
    expect(editor.list(0)).toEqual(before);
    expect(editor.state()).toEqual(state);
    editor.apply({
      action: "paste",
      page: 0,
      point: { x: 10, y: 50 },
      clipboard: clip,
    });
    editor.apply({ action: "undo" });
    const branch = editor.apply({
      action: "paste",
      page: 1,
      point: { x: 80, y: 150 },
      clipboard: clip,
    });
    editor.apply({
      action: "update",
      page: 1,
      id: branch[1],
      patch: { contents: "Edited copied note" },
    });
    editor.apply({ action: "delete-many", page: 0, ids });
    for (let i = 0; i < 2; i++) {
      const bytes = editor.export(),
        saved = new mupdf.PDFDocument(bytes);
      try {
        const reopened = new AnnotationEditor(saved, bytes);
        expect(saved.wasRepaired()).toBe(false);
        expect(reopened.list(0).map((a) => a.contents)).toEqual(
          editor.list(0).map((a) => a.contents),
        );
        expect(
          reopened
            .list(1)
            .map((a) => ({ type: a.type, rect: a.rect, contents: a.contents })),
        ).toEqual(
          editor
            .list(1)
            .map((a) => ({ type: a.type, rect: a.rect, contents: a.contents })),
        );
      } finally {
        saved.destroy();
      }
    }
  } finally {
    doc.destroy();
  }
});
it("preserves a text field's rotation relative to the page when pasting on a rotated sheet", () => {
  const source = new mupdf.PDFDocument(input()),
    p = source.loadPage(0);
  const field = p.createAnnotation("FreeText");
  field.setRect([30, 60, 170, 100]);
  field.setContents("Individually rotated");
  field.setDefaultAppearance("Helv", 14, [1, 0, 0]);
  field.getObject().put("Rotate", 90);
  field.update();
  const buffer = source.saveToBuffer(""),
    bytes = new Uint8Array(buffer.asUint8Array());
  p.destroy();
  buffer.destroy();
  source.destroy();
  const doc = new mupdf.PDFDocument(bytes),
    editor = new AnnotationEditor(doc, bytes);
  try {
    const id = editor.list(0).find((a) => a.type === "FreeText")!.id;
    const clip = editor.copy(0, [id]);
    const [pasted] = editor.apply({
      action: "paste",
      page: 1,
      point: { x: 80, y: 140 },
      clipboard: clip,
    });
    const target = doc.loadPage(1);
    const a = target
      .getAnnotations()
      .find((a) => a.getObject().asIndirect() === pasted)!;
    expect(a.getObject().get("Rotate").asNumber()).toBe(180);
    expect(a.getContents()).toBe("Individually rotated");
    target.destroy();
  } finally {
    doc.destroy();
  }
});
