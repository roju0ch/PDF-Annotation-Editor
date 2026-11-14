import { readFileSync } from "node:fs";
import * as m from "mupdf";
import { expect, it } from "vitest";
import { AnnotationEditor } from "../src/adapters/pdf/annotations";
import { pageInfos } from "../src/adapters/pdf/pages";
import { movePageOrder } from "../src/core/document/pages";
function input() {
  return new Uint8Array(readFileSync("artifacts/fixture.pdf"));
}
function bytes(doc: m.PDFDocument) {
  const b = doc.saveToBuffer("compress=yes");
  try {
    return new Uint8Array(b.asUint8Array());
  } finally {
    b.destroy();
  }
}
function source() {
  const doc = new m.PDFDocument(input());
  const p = doc.loadPage(0),
    note = p.getAnnotations()[0];
  note.setContents("Imported note");
  note.update();
  const square = p.createAnnotation("Square");
  square.setRect([80, 160, 130, 220]);
  square.setContents("Unsupported square");
  square.update();
  const annotation = doc.addObject({
    Type: "Annot",
    Subtype: "Link",
    Rect: [30, 100, 90, 120],
    Border: [0, 0, 0],
    A: { S: "GoTo", D: doc.newString("target") },
    P: doc.findPage(0),
  });
  doc.findPage(0).get("Annots").push(annotation);
  doc
    .getTrailer()
    .get("Root")
    .put("Names", {
      Dests: { Names: [doc.newString("target"), [doc.findPage(1), "Fit"]] },
    });
  const outline = doc.addObject({ Type: "Outlines", Count: 1 });
  const item = doc.addObject({
    Title: doc.newString("Source bookmark"),
    Parent: outline,
    Dest: doc.newString("target"),
  });
  outline.put("First", item);
  outline.put("Last", item);
  doc.getTrailer().get("Root").put("Outlines", outline);
  doc.setPageLabels(0, "D", "S-", 1);
  p.destroy();
  const result = bytes(doc);
  doc.destroy();
  return result;
}
const order = (doc: m.PDFDocument) =>
  Array.from({ length: doc.countPages() }, (_, i) =>
    doc.findPage(i).asIndirect(),
  );
it("reorders page identities with annotations, links, labels and atomic undo/redo", () => {
  const doc = new m.PDFDocument(source()),
    original = bytes(doc),
    editor = new AnnotationEditor(doc, original);
  try {
    const before = order(doc),
      content = doc.findPage(0).get("Annots").toString();
    editor.apply({ action: "reorder-pages", order: [2, 0, 1] });
    expect(order(doc)).toEqual([before[2], before[0], before[1]]);
    expect(doc.findPage(1).get("Annots").toString()).toBe(content);
    expect(pageInfos(doc).map((p) => p.width)).toEqual([2384, 300, 400]);
    const page = doc.loadPage(1);
    expect(page.getLabel()).toBe("S-1");
    page.destroy();
    expect(doc.resolveLink(doc.loadOutline()![0].uri!)).toBe(2);
    editor.apply({ action: "undo" });
    expect(order(doc)).toEqual(before);
    editor.apply({ action: "redo" });
    expect(order(doc)).toEqual([before[2], before[0], before[1]]);
    const saved = new m.PDFDocument(editor.export());
    try {
      expect(saved.countPages()).toBe(3);
      expect(saved.resolveLink(saved.loadOutline()![0].uri!)).toBe(2);
      expect(saved.wasRepaired()).toBe(false);
    } finally {
      saved.destroy();
    }
  } finally {
    doc.destroy();
  }
});
it("imports all native pages/annotations and named links/bookmarks, then edits/reorders/exports after history branching", () => {
  const original = input(),
    doc = new m.PDFDocument(original),
    editor = new AnnotationEditor(doc, original);
  try {
    const before = order(doc),
      ids = editor.apply({
        action: "insert-pdf",
        at: 1,
        bytes: source(),
        name: "Added.pdf",
      });
    expect(doc.countPages()).toBe(6);
    expect(order(doc)[0]).toBe(before[0]);
    expect(order(doc).slice(4)).toEqual(before.slice(1));
    expect(ids.length).toBeGreaterThanOrEqual(4);
    const note = editor.list(1).find((a) => a.contents === "Imported note")!;
    const square = editor
      .list(1)
      .find((a) => a.contents === "Unsupported square")!;
    expect(square.editable).toBe(false);
    const page = doc.findPage(1),
      annots = page.get("Annots");
    const link = Array.from({ length: annots.length }, (_, i) =>
      annots.get(i),
    ).find((a) => a.get("A", "S").asName() === "GoTo")!;
    expect(link.get("A", "D", 0).asIndirect()).toBe(
      doc.findPage(2).asIndirect(),
    );
    expect(link.get("P").asIndirect()).toBe(page.asIndirect());
    expect(doc.loadOutline()?.[0]).toMatchObject({ title: "Added.pdf" });
    expect(doc.loadOutline()?.[0].down?.[0].uri).toContain("page=3");
    editor.apply({
      action: "update",
      page: 1,
      id: note.id,
      patch: { contents: "Edited import" },
    });
    editor.apply({ action: "reorder-pages", order: [5, 0, 1, 2, 3, 4] });
    editor.apply({ action: "undo" });
    editor.apply({ action: "undo" });
    editor.apply({ action: "undo" });
    expect(order(doc)).toEqual(before);
    expect(doc.loadOutline()).toBeNull();
    editor.apply({ action: "redo" });
    const imported = editor
      .list(1)
      .find((a) => a.contents === "Imported note")!;
    editor.apply({
      action: "update",
      page: 1,
      id: imported.id,
      patch: { contents: "Branch edit" },
    });
    editor.apply({ action: "reorder-pages", order: [1, 2, 3, 0, 4, 5] });
    for (let n = 0; n < 2; n++) {
      const output = editor.export(),
        saved = new m.PDFDocument(output),
        check = new AnnotationEditor(saved, output);
      try {
        expect(saved.wasRepaired()).toBe(false);
        expect(saved.countPages()).toBe(6);
        expect(check.list(0).some((a) => a.contents === "Branch edit")).toBe(
          true,
        );
        expect(
          check.list(0).some((a) => a.contents === "Unsupported square"),
        ).toBe(true);
        expect(saved.loadOutline()?.[0].down?.[0].uri).toContain("page=2");
        const a = saved.findPage(0).get("Annots");
        const l = Array.from({ length: a.length }, (_, i) => a.get(i)).find(
          (a) => a.get("A", "S").asName() === "GoTo",
        )!;
        expect(l.get("A", "D", 0).asIndirect()).toBe(
          saved.findPage(1).asIndirect(),
        );
      } finally {
        saved.destroy();
      }
    }
  } finally {
    doc.destroy();
  }
});
it("rejects invalid permutations and unsupported imports without changing the document/history", () => {
  const original = input(),
    doc = new m.PDFDocument(original),
    editor = new AnnotationEditor(doc, original);
  try {
    const before = order(doc),
      state = editor.state();
    for (const order of [
      [0, 0, 1],
      [0, 1],
      [0, 1, 9],
    ])
      expect(() => editor.apply({ action: "reorder-pages", order })).toThrow();
    for (const key of [
      "AcroForm",
      "StructTreeRoot",
      "OCProperties",
      "OutputIntents",
      "AF",
    ]) {
      const other = new m.PDFDocument(input());
      other.getTrailer().get("Root").put(key, {});
      const data = bytes(other);
      other.destroy();
      expect(() =>
        editor.apply({
          action: "insert-pdf",
          at: 1,
          bytes: data,
          name: "bad.pdf",
        }),
      ).toThrow();
      expect(order(doc)).toEqual(before);
      expect(editor.state()).toEqual(state);
    }
    expect(() =>
      editor.apply({
        action: "insert-pdf",
        at: 1,
        bytes: new Uint8Array([1, 2, 3]),
        name: "bad",
      }),
    ).toThrow();
    expect(order(doc)).toEqual(before);
    expect(editor.state()).toEqual(state);
    editor.apply({ action: "reorder-pages", order: [0, 1, 2] });
    expect(editor.state()).toEqual(state);
  } finally {
    doc.destroy();
  }
});
it("computes insertion-slot moves in both directions and at boundaries", () => {
  expect(movePageOrder(4, 0, 4)).toEqual([1, 2, 3, 0]);
  expect(movePageOrder(4, 3, 0)).toEqual([3, 0, 1, 2]);
  expect(movePageOrder(4, 1, 2)).toEqual([0, 1, 2, 3]);
  expect(() => movePageOrder(4, -1, 2)).toThrow();
});

it("imports a plain PDF without Names/Outlines and retains popup/reply references through export", () => {
  const original = input(),
    doc = new m.PDFDocument(original),
    editor = new AnnotationEditor(doc, original),
    source = new m.PDFDocument(input());
  try {
    const root = source.getTrailer().get("Root");
    root.delete("Names");
    root.delete("Outlines");
    const page = source.findPage(0),
      parent = page.get("Annots", 0);
    const popup = source.addObject({
      Type: "Annot",
      Subtype: "Popup",
      Rect: [20, 20, 100, 100],
      Parent: parent,
      P: page,
    });
    const reply = source.addObject({
      Type: "Annot",
      Subtype: "Text",
      Rect: [30, 30, 50, 50],
      IRT: parent,
      P: page,
      Contents: source.newString("Reply"),
    });
    parent.put("Popup", popup);
    page.get("Annots").push(popup);
    page.get("Annots").push(reply);
    editor.apply({
      action: "insert-pdf",
      at: 3,
      bytes: bytes(source),
      name: "Plain.pdf",
    });
    editor.apply({ action: "reorder-pages", order: [3, 4, 5, 0, 1, 2] });
    const saved = new m.PDFDocument(editor.export());
    try {
      const p = saved.findPage(0),
        note = p.get("Annots", 0),
        pop = note.get("Popup");
      expect(pop.get("Parent").asIndirect()).toBe(note.asIndirect());
      expect(pop.get("P").asIndirect()).toBe(p.asIndirect());
      const a = p.get("Annots");
      const response = Array.from({ length: a.length }, (_, i) =>
        a.get(i),
      ).find((x) => x.get("Contents").asString() === "Reply")!;
      expect(response.get("IRT").asIndirect()).toBe(note.asIndirect());
      expect(response.get("P").asIndirect()).toBe(p.asIndirect());
      expect(saved.loadOutline()).toBeNull();
      expect(saved.wasRepaired()).toBe(false);
    } finally {
      saved.destroy();
    }
  } finally {
    source.destroy();
    doc.destroy();
  }
});
