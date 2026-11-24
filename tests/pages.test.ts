import { readFileSync } from "node:fs";
import * as m from "mupdf";
import { expect, it, vi } from "vitest";
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

it.each([-90, 90] as const)(
  "rotates a cropped page by %i with atomic undo/redo and native export",
  (degrees) => {
    const original = source(),
      doc = new m.PDFDocument(original),
      editor = new AnnotationEditor(doc, original);
    try {
      const before = pageInfos(doc),
        contents = doc.findPage(1).get("Contents").toString(),
        crop = doc.findPage(1).get("CropBox").toString();
      editor.apply({ action: "rotate-page", page: 1, degrees });
      const after = pageInfos(doc);
      expect(after[1]).toMatchObject({
        rotation: degrees === 90 ? 180 : 0,
        width: 500,
        height: 400,
      });
      expect(after[1].pdfToPage).not.toEqual(before[1].pdfToPage);
      expect(after[0]).toEqual(before[0]);
      expect(after[2]).toEqual(before[2]);
      expect(doc.findPage(1).get("CropBox").toString()).toBe(crop);
      expect(doc.findPage(1).get("Contents").toString()).toBe(contents);
      editor.apply({ action: "undo" });
      expect(pageInfos(doc)).toEqual(before);
      expect(editor.state().canUndo).toBe(false);
      editor.apply({ action: "redo" });
      expect(pageInfos(doc)).toEqual(after);
      const saved = new m.PDFDocument(editor.export());
      try {
        expect(pageInfos(saved)).toEqual(after);
        expect(saved.resolveLink(saved.loadOutline()![0].uri!)).toBe(1);
        expect(saved.wasRepaired()).toBe(false);
      } finally {
        saved.destroy();
      }
    } finally {
      doc.destroy();
    }
  },
);
it("overrides inherited rotation on one page without modifying annotations and retains later edits after import/reorder", () => {
  const base = new m.PDFDocument(source());
  base.findPage(0).get("Parent").put("Rotate", 90);
  const original = bytes(base);
  base.destroy();
  const doc = new m.PDFDocument(original),
    editor = new AnnotationEditor(doc, original);
  try {
    const before = pageInfos(doc),
      annots = doc.findPage(0).get("Annots"),
      objects: string[] = [];
    annots.forEach((a) => objects.push(a.resolve().toString()));
    for (let n = 0; n < 4; n++)
      editor.apply({ action: "rotate-page", page: 0, degrees: -90 });
    expect(pageInfos(doc)).toEqual(before);
    annots.forEach((a, i) =>
      expect(a.resolve().toString()).toBe(objects[Number(i)]),
    );
    for (let n = 0; n < 4; n++) editor.apply({ action: "undo" });
    expect(doc.findPage(0).get("Rotate").isNull()).toBe(true);
    editor.apply({ action: "rotate-page", page: 0, degrees: 90 });
    expect(pageInfos(doc).map((p) => p.rotation)).toEqual([180, 90, 90]);
    const note = editor.list(0).find((a) => a.type === "Text")!;
    editor.apply({
      action: "update",
      page: 0,
      id: note.id,
      patch: { contents: "After rotation" },
    });
    editor.apply({
      action: "insert-pdf",
      at: 3,
      bytes: input(),
      name: "More.pdf",
    });
    editor.apply({ action: "rotate-page", page: 3, degrees: -90 });
    editor.apply({ action: "reorder-pages", order: [3, 0, 1, 2, 4, 5] });
    for (let n = 0; n < 2; n++) {
      const output = editor.export(),
        saved = new m.PDFDocument(output),
        check = new AnnotationEditor(saved, output);
      try {
        expect(pageInfos(saved).map((p) => p.rotation)).toEqual([
          270, 180, 90, 90, 90, 0,
        ]);
        expect(check.list(1).some((a) => a.contents === "After rotation")).toBe(
          true,
        );
        expect(
          check.list(1).some((a) => a.contents === "Unsupported square"),
        ).toBe(true);
        expect(saved.wasRepaired()).toBe(false);
      } finally {
        saved.destroy();
      }
    }
  } finally {
    doc.destroy();
  }
});
it("rejects invalid rotations and protected page operations without changing history", () => {
  const original = input(),
    doc = new m.PDFDocument(original),
    editor = new AnnotationEditor(doc, original);
  try {
    const before = pageInfos(doc),
      state = editor.state();
    for (const page of [-1, 3, 0.5])
      expect(() =>
        editor.apply({ action: "rotate-page", page, degrees: 90 }),
      ).toThrow("Seitendrehung");
    expect(() =>
      editor.apply({ action: "rotate-page", page: 0, degrees: 45 as 90 }),
    ).toThrow("Seitendrehung");
    expect(pageInfos(doc)).toEqual(before);
    expect(editor.state()).toEqual(state);
  } finally {
    doc.destroy();
  }
  for (const key of ["AcroForm", "StructTreeRoot"]) {
    const source = new m.PDFDocument(original);
    source.getTrailer().get("Root").put(key, {});
    const data = bytes(source);
    source.destroy();
    const blocked = new m.PDFDocument(data),
      edit = new AnnotationEditor(blocked, data);
    try {
      expect(() =>
        edit.apply({ action: "rotate-page", page: 0, degrees: 90 }),
      ).toThrow();
      expect(edit.state().canUndo).toBe(false);
    } finally {
      blocked.destroy();
    }
  }
});

it("inserts disjoint pages as an ordered group at the start, middle and end", () => {
  const group = [4, 1];
  expect(movePageOrder(6, group, 0)).toEqual([1, 4, 0, 2, 3, 5]);
  expect(movePageOrder(6, group, 3)).toEqual([0, 2, 1, 4, 3, 5]);
  expect(movePageOrder(6, group, 6)).toEqual([0, 2, 3, 5, 1, 4]);
  for (const slot of [1, 2, 3])
    expect(movePageOrder(4, [1, 2], slot)).toEqual([0, 1, 2, 3]);
});

it("moves leaves across native tree branches with inherited geometry and catalog destinations", () => {
  const base = new m.PDFDocument(source());
  const root = base.getTrailer().get("Root");
  const tree = root.get("Pages");
  const [a, b, c] = Array.from({ length: 3 }, (_, i) => base.findPage(i));
  const branch = base.addObject({
    Type: "Pages",
    Parent: tree,
    Kids: [b, c],
    Count: 2,
    CropBox: [30, 40, 430, 340],
    Rotate: 270,
  });
  b.put("Parent", branch);
  c.put("Parent", branch);
  tree.put("Kids", [a, branch]);
  root.put("OpenAction", [c, "Fit"]);
  root.put("Dests", { legacy: [b, "Fit"], target: [b, "Fit"] });
  root.put("ViewerPreferences", { DisplayDocTitle: true });
  const original = bytes(base);
  base.destroy();
  const doc = new m.PDFDocument(original);
  try {
    const editor = new AnnotationEditor(doc, original);
    const before = pageInfos(doc);
    expect(doc.resolveLink(doc.loadOutline()![0].uri!)).toBe(1);
    const perm = movePageOrder(3, [2, 1], 0);
    editor.apply({ action: "reorder-pages", order: perm });
    expect(pageInfos(doc)).toEqual(perm.map((i) => before[i]));
    editor.apply({ action: "undo" });
    expect(pageInfos(doc)).toEqual(before);
    expect(editor.state().canUndo).toBe(false);
    editor.apply({ action: "redo" });
    const out = new m.PDFDocument(editor.export());
    try {
      const catalog = out.getTrailer().get("Root");
      expect(pageInfos(out)).toEqual(perm.map((i) => before[i]));
      expect(catalog.get("OpenAction", 0).asIndirect()).toBe(before[2].id);
      expect(catalog.get("Dests", "legacy", 0).asIndirect()).toBe(before[1].id);
      expect(
        catalog.get("ViewerPreferences", "DisplayDocTitle").asBoolean(),
      ).toBe(true);
      expect(out.resolveLink(out.loadOutline()![0].uri!)).toBe(0);
    } finally {
      out.destroy();
    }
  } finally {
    doc.destroy();
  }
});

it("deletes imported and annotated pages together, preserves surviving targets and exports only the active document", () => {
  const original = source();
  const doc = new m.PDFDocument(original);
  try {
    const editor = new AnnotationEditor(doc, original);
    editor.apply({
      action: "insert-pdf",
      at: 3,
      bytes: input(),
      name: "Synthetic.pdf",
    });
    const imported = editor.list(3)[0];
    editor.apply({
      action: "update",
      page: 3,
      id: imported.id,
      patch: { contents: "Removed synthetic comment" },
    });
    const before = pageInfos(doc);
    const journal = doc.getJournal().position;
    editor.apply({ action: "delete-pages", indices: [3, 2] });
    const kept = [0, 1, 4, 5].map((i) => before[i]);
    expect(pageInfos(doc)).toEqual(kept);
    expect(doc.getJournal().position).toBe(journal + 1);
    editor.apply({ action: "undo" });
    expect(pageInfos(doc)).toEqual(before);
    expect(editor.list(3)[0].contents).toBe("Removed synthetic comment");
    editor.apply({ action: "redo" });
    for (let i = 0; i < 2; i++) {
      const out = new m.PDFDocument(editor.export());
      try {
        expect(pageInfos(out)).toEqual(kept);
        expect(out.countVersions()).toBe(1);
        for (const deleted of [before[2].id, before[3].id, imported.id])
          expect(out.newIndirect(deleted).resolve().isNull()).toBe(true);
        const page = out.loadPage(0);
        try {
          expect(page.getLabel()).toBe("S-1");
          expect(page.getAnnotations().map((a) => a.getContents())).toContain(
            "Unsupported square",
          );
          expect(
            page.getLinks().some((l) => out.resolveLink(l.getURI()) === 1),
          ).toBe(true);
        } finally {
          page.destroy();
        }
        expect(out.resolveLink(out.loadOutline()![0].uri!)).toBe(1);
        expect(out.wasRepaired()).toBe(false);
      } finally {
        out.destroy();
      }
    }
    editor.apply({ action: "undo" });
    editor.apply({ action: "delete-pages", indices: [0] });
    expect(editor.state().canRedo).toBe(false);
    const out = new m.PDFDocument(editor.export());
    try {
      expect(out.countPages()).toBe(5);
      expect(out.resolveLink(out.loadOutline()![0].uri!)).toBe(0);
      const p = out.loadPage(0);
      try {
        expect(p.getLabel()).toBe("S-2");
      } finally {
        p.destroy();
      }
    } finally {
      out.destroy();
    }
  } finally {
    doc.destroy();
  }
});

it.each([
  "Link",
  "Lesezeichen",
  "Namensbaum",
  "Dests",
  "Startziel",
  "Kommentarantwort",
  "privater Verweis",
])(
  "handles a surviving %s referring to a deleted page or annotation",
  (kind) => {
    const base = new m.PDFDocument(input());
    const catalog = base.getTrailer().get("Root"),
      target = base.findPage(0),
      other = base.findPage(1);
    const dest = [target, "Fit"];
    if (kind === "Link")
      other.put("Annots", [
        base.addObject({
          Subtype: "Link",
          Rect: [0, 0, 40, 20],
          A: { S: "GoTo", D: dest },
        }),
      ]);
    if (kind === "Lesezeichen") {
      const outline = base.addObject({ Type: "Outlines", Count: 1 });
      const item = base.addObject({
        Parent: outline,
        Title: base.newString("Synthetic bookmark"),
        Dest: dest,
      });
      outline.put("First", item);
      outline.put("Last", item);
      catalog.put("Outlines", outline);
    }
    if (kind === "Namensbaum")
      catalog.put("Names", {
        Dests: { Kids: [{ Names: [base.newString("A"), { D: dest }] }] },
      });
    if (kind === "Dests") catalog.put("Dests", { A: dest });
    if (kind === "Startziel") catalog.put("OpenAction", dest);
    if (kind === "Kommentarantwort")
      other.put("Annots", [
        base.addObject({
          Subtype: "Text",
          IRT: target.get("Annots", 0),
          Rect: [0, 0, 20, 20],
        }),
      ]);
    if (kind === "privater Verweis")
      catalog.put("CustomReference", base.addObject({ Target: target }));
    const original = bytes(base);
    base.destroy();
    const doc = new m.PDFDocument(original);
    try {
      const editor = new AnnotationEditor(doc, original);
      editor.apply({ action: "rotate-page", page: 1, degrees: 90 });
      editor.apply({ action: "undo" });
      const before = order(doc),
        state = editor.state();
      if (kind === "Kommentarantwort" || kind === "privater Verweis") {
        expect(() =>
          editor.apply({ action: "delete-pages", indices: [2, 0] }),
        ).toThrow("PDF-Verweis");
        expect(order(doc)).toEqual(before);
        expect(editor.state()).toEqual(state);
        expect(editor.state().canRedo).toBe(true);
      } else {
        const targetId = (pdf: m.PDFDocument) => {
          const root = pdf.getTrailer().get("Root");
          if (kind === "Link")
            return pdf
              .findPage(pdf.countPages() === 1 ? 0 : 1)
              .get("Annots", 0, "A", "D", 0)
              .asIndirect();
          if (kind === "Lesezeichen")
            return root.get("Outlines", "First", "Dest", 0).asIndirect();
          if (kind === "Namensbaum")
            return root
              .get("Names", "Dests", "Kids", 0, "Names", 1, "D", 0)
              .asIndirect();
          if (kind === "Dests") return root.get("Dests", "A", 0).asIndirect();
          return root.get("OpenAction", 0).asIndirect();
        };
        editor.apply({ action: "delete-pages", indices: [2, 0] });
        expect(targetId(doc)).toBe(before[1]);
        editor.apply({ action: "undo" });
        expect(targetId(doc)).toBe(before[0]);
        editor.apply({ action: "redo" });
        const out = new m.PDFDocument(editor.export());
        try {
          expect(out.countPages()).toBe(1);
          expect(targetId(out)).toBe(before[1]);
        } finally {
          out.destroy();
        }
      }
    } finally {
      doc.destroy();
    }
  },
);

it("rejects invalid selections and rolls back a failure after a native deletion", () => {
  const original = input(),
    doc = new m.PDFDocument(original);
  try {
    const editor = new AnnotationEditor(doc, original),
      before = pageInfos(doc),
      state = editor.state();
    for (const indices of [[], [1, 1], [-1], [1.5], [1, 3], [0, 1, 2]])
      expect(() => editor.apply({ action: "delete-pages", indices })).toThrow();
    const nativeDelete = doc.deletePage.bind(doc);
    const spy = vi
      .spyOn(doc, "deletePage")
      .mockImplementationOnce(nativeDelete)
      .mockImplementationOnce(() => {
        throw new Error("Synthetic failure");
      });
    expect(() =>
      editor.apply({ action: "delete-pages", indices: [0, 2] }),
    ).toThrow("Synthetic failure");
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
    expect(pageInfos(doc)).toEqual(before);
    expect(editor.state()).toEqual(state);
    expect(editor.list(0)[0].contents).toBe("Independent fixture note");
  } finally {
    doc.destroy();
  }
});

it.each([
  "AcroForm",
  "StructTreeRoot",
  "Perms",
  "PrintPageRange",
  "JavaScript",
  "numeric destination",
  "GoToE",
  "encryption",
])("preserves the document when %s prevents group editing", (kind) => {
  const base = new m.PDFDocument(input());
  const root = base.getTrailer().get("Root");
  if (kind === "PrintPageRange")
    root.put("ViewerPreferences", { PrintPageRange: [0, 2] });
  else if (kind === "JavaScript")
    root.put("OpenAction", {
      S: "JavaScript",
      JS: base.newString("/* synthetic */"),
    });
  else if (kind === "GoToE")
    root.put("OpenAction", { S: "GoToE", T: { R: "C", P: 2 }, D: [0, "Fit"] });
  else if (kind === "numeric destination") root.put("OpenAction", [2, "Fit"]);
  else if (kind !== "encryption") root.put(kind, {});
  const buf = base.saveToBuffer(
    kind === "encryption"
      ? "encrypt=aes-256,owner-password=synthetic,permissions=0"
      : "compress=yes",
  );
  const original = new Uint8Array(buf.asUint8Array());
  buf.destroy();
  base.destroy();
  const doc = new m.PDFDocument(original);
  try {
    const editor = new AnnotationEditor(doc, original),
      before = order(doc);
    expect(() =>
      editor.apply({ action: "delete-pages", indices: [1, 2] }),
    ).toThrow();
    expect(() =>
      editor.apply({ action: "reorder-pages", order: [1, 2, 0] }),
    ).toThrow();
    expect(order(doc)).toEqual(before);
    expect(editor.state().canUndo).toBe(false);
  } finally {
    doc.destroy();
  }
});

it("retargets a shared indirect destination at the end and restores the named link and bookmark on undo", () => {
  const base = new m.PDFDocument(source());
  const target = base.addObject([base.findPage(2), "XYZ", 15, 20, 1]);
  const catalog = base.getTrailer().get("Root");
  catalog.get("Names", "Dests", "Names").put(1, { D: target });
  catalog.put("OpenAction", target);
  const original = bytes(base);
  base.destroy();
  const doc = new m.PDFDocument(original);
  const verify = (pdf: m.PDFDocument, index: number) => {
    const root = pdf.getTrailer().get("Root");
    const dest = root.get("OpenAction");
    expect(dest.asIndirect()).toBe(
      root.get("Names", "Dests", "Names", 1, "D").asIndirect(),
    );
    expect(dest.get(0).asIndirect()).toBe(pdf.findPage(index).asIndirect());
    expect(dest.get(1).asName()).toBe("XYZ");
    expect(dest.get(2).asNumber()).toBe(15);
    expect(pdf.resolveLink(pdf.loadOutline()![0].uri!)).toBe(index);
    const page = pdf.loadPage(0);
    try {
      expect(
        page
          .getLinks()
          .some((link) => pdf.resolveLink(link.getURI()) === index),
      ).toBe(true);
    } finally {
      page.destroy();
    }
  };
  try {
    const editor = new AnnotationEditor(doc, original);
    verify(doc, 2);
    editor.apply({ action: "delete-pages", indices: [1, 2] });
    verify(doc, 0);
    editor.apply({ action: "undo" });
    verify(doc, 2);
    editor.apply({ action: "redo" });
    const out = new m.PDFDocument(editor.export());
    try {
      verify(out, 0);
    } finally {
      out.destroy();
    }
  } finally {
    doc.destroy();
  }
});
