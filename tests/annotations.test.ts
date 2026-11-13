import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { describe, it, expect } from "vitest";
import { AnnotationEditor } from "../src/adapters/pdf/annotations";
import type { AnnotationKind } from "../src/core/annotations/model";
import { eraseInk } from "../src/core/annotations/erase";
const input = () => new Uint8Array(readFileSync("artifacts/fixture.pdf"));
function setup() {
  const doc = new mupdf.PDFDocument(input());
  return { doc, editor: new AnnotationEditor(doc, input()) };
}
function create(editor: AnnotationEditor, kind: AnnotationKind, page = 0) {
  return editor.apply({
    action: "create",
    page,
    kind,
    rect: [40, 180, 220, 220],
    contents: `Test ${kind}`,
    color: "#ff0000",
    width: 3,
    fontSize: 14,
    ink: [
      [
        { x: 40, y: 200 },
        { x: 100, y: 200 },
        { x: 180, y: 210 },
      ],
    ],
  })!;
}
describe("native annotation editor", () => {
  it.each<AnnotationKind>(["Ink", "Text", "FreeText"])(
    "creates, edits, exports and reopens native %s",
    (kind) => {
      const { doc, editor } = setup();
      try {
        const id = create(editor, kind);
        editor.apply({
          action: "update",
          page: 0,
          id,
          patch: {
            contents: "Geändert äöü",
            color: "#008000",
            offset: { x: 10, y: 20 },
          },
        });
        const bytes = editor.export();
        expect(bytes.slice(0, input().length)).toEqual(input());
        const saved = new mupdf.PDFDocument(bytes);
        try {
          const page = saved.loadPage(0);
          try {
            const a = page
              .getAnnotations()
              .find((a) => a.getObject().asIndirect() === id)!;
            expect(a.getType()).toBe(kind);
            expect(a.getContents()).toBe("Geändert äöü");
            expect(a.getObject().get("AP", "N").isStream()).toBe(true);
            expect(
              page.getObject().get("Annots", 1, "A", "URI").asString(),
            ).toBe("https://example.invalid/never-followed");
          } finally {
            page.destroy();
          }
        } finally {
          saved.destroy();
        }
      } finally {
        doc.destroy();
      }
    },
  );
  it("edits an existing note and preserves unrelated dictionaries and content", () => {
    const { doc, editor } = setup();
    try {
      const page = doc.loadPage(0);
      const content = page.getObject().get("Contents").readStream().asString();
      const link = page.getObject().get("Annots", 1).resolve().toString();
      page.destroy();
      const note = editor.list(0).find((a) => a.type === "Text")!;
      editor.apply({
        action: "update",
        page: 0,
        id: note.id,
        patch: { contents: "Fremdnotiz bearbeitet" },
      });
      const saved = new mupdf.PDFDocument(editor.export());
      const p = saved.loadPage(0);
      try {
        expect(
          p
            .getAnnotations()
            .find((a) => a.getType() === "Text")!
            .getContents(),
        ).toBe("Fremdnotiz bearbeitet");
        expect(p.getObject().get("Contents").readStream().asString()).toBe(
          content,
        );
        expect(p.getObject().get("Annots", 1).resolve().toString()).toBe(link);
      } finally {
        p.destroy();
        saved.destroy();
      }
    } finally {
      doc.destroy();
    }
  });
  it("supports undo/redo, delete, branching history and export acknowledgement", () => {
    const { doc, editor } = setup();
    try {
      const id = create(editor, "Ink");
      const savedRevision = editor.state().revision;
      editor.export();
      editor.acknowledgeExport(savedRevision);
      expect(editor.state().dirty).toBe(false);
      editor.apply({ action: "delete", page: 0, id });
      expect(editor.list(0).some((a) => a.id === id)).toBe(false);
      editor.apply({ action: "undo" });
      expect(editor.list(0).some((a) => a.id === id)).toBe(true);
      expect(editor.state().dirty).toBe(false);
      editor.apply({ action: "redo" });
      expect(editor.state().dirty).toBe(true);
      editor.apply({ action: "undo" });
      editor.apply({ action: "undo" });
      create(editor, "Text");
      expect(editor.state().dirty).toBe(true);
      expect(editor.state().canRedo).toBe(false);
      editor.acknowledgeExport(savedRevision);
      expect(editor.state().dirty).toBe(true);
    } finally {
      doc.destroy();
    }
  });
  it("rolls back invalid edits atomically", () => {
    const { doc, editor } = setup();
    try {
      const id = create(editor, "Ink");
      const state = editor.state();
      expect(() =>
        editor.apply({
          action: "update",
          page: 0,
          id,
          patch: { contents: "must roll back", width: -5 },
        }),
      ).toThrow();
      expect(editor.list(0).find((a) => a.id === id)!.contents).toBe(
        "Test Ink",
      );
      expect(editor.state()).toEqual(state);
      expect(() =>
        editor.apply({
          action: "update",
          page: 0,
          id: 8,
          patch: { contents: "bad" },
        }),
      ).toThrow();
    } finally {
      doc.destroy();
    }
  });
  it("maps ink through rotated CropBox coordinates and preserves its PDF InkList", () => {
    const { doc, editor } = setup();
    try {
      const id = create(editor, "Ink", 1);
      const item = editor.list(1).find((a) => a.id === id)!;
      expect(item.ink![0][0]).toEqual({ x: 40, y: 200 });
      const saved = new mupdf.PDFDocument(editor.export());
      const p = saved.loadPage(1);
      try {
        const raw = p.getAnnotations()[0].getObject().get("InkList", 0);
        expect(raw.get(0).asNumber()).toBe(40);
        expect(raw.get(1).asNumber()).toBe(200);
      } finally {
        p.destroy();
        saved.destroy();
      }
    } finally {
      doc.destroy();
    }
  });
  it("cuts ink geometrically, round-trips split paths and undoes the whole operation", () => {
    const { doc, editor } = setup();
    try {
      const id = create(editor, "Ink");
      editor.apply({
        action: "erase",
        page: 0,
        id,
        center: { x: 75, y: 200 },
        radius: 10,
      });
      expect(editor.list(0).find((a) => a.id === id)!.ink).toHaveLength(2);
      const saved = new mupdf.PDFDocument(editor.export());
      const p = saved.loadPage(0);
      try {
        expect(
          p
            .getAnnotations()
            .find((a) => a.getType() === "Ink")!
            .getInkList(),
        ).toHaveLength(2);
      } finally {
        p.destroy();
        saved.destroy();
      }
      editor.apply({ action: "undo" });
      expect(editor.list(0).find((a) => a.id === id)!.ink).toHaveLength(1);
    } finally {
      doc.destroy();
    }
  });
  it("blocks editing signature-bearing and individually locked documents/annotations", () => {
    const source = new mupdf.PDFDocument(input());
    source
      .getTrailer()
      .get("Root")
      .put("AcroForm", { Fields: [{ FT: "Sig", T: "Signature" }] });
    const bytes = source.saveToBuffer("");
    const doc = new mupdf.PDFDocument(bytes.asUint8Array());
    try {
      const e = new AnnotationEditor(doc, new Uint8Array(bytes.asUint8Array()));
      expect(e.state().readOnly).toContain("Signatur");
      expect(() => create(e, "Ink")).toThrow();
      expect(() => e.export()).toThrow();
    } finally {
      doc.destroy();
      bytes.destroy();
      source.destroy();
    }
    const locked = new mupdf.PDFDocument(input());
    const p = locked.loadPage(0);
    p.getAnnotations()[0].setFlags(mupdf.PDFAnnotation.IS_LOCKED);
    p.destroy();
    const e = new AnnotationEditor(locked, input());
    try {
      const a = e.list(0)[0];
      expect(a.editable).toBe(false);
      expect(() => e.apply({ action: "delete", page: 0, id: a.id })).toThrow();
    } finally {
      locked.destroy();
    }
  });
});
describe("circular ink clipping", () => {
  it("keeps exact endpoints, removes the middle and preserves disjoint paths", () => {
    expect(
      eraseInk(
        [
          [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
        ],
        { x: 50, y: 0 },
        10,
      ),
    ).toEqual([
      [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
      ],
      [
        { x: 60, y: 0 },
        { x: 100, y: 0 },
      ],
    ]);
  });
  it("handles complete removal, tangents, repeated points and bends", () => {
    expect(
      eraseInk(
        [
          [
            { x: 0, y: 0 },
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        ],
        { x: 0, y: 0 },
        3,
      ),
    ).toEqual([]);
    expect(
      eraseInk(
        [
          [
            { x: 0, y: 10 },
            { x: 100, y: 10 },
          ],
        ],
        { x: 50, y: 0 },
        10,
      ),
    ).toHaveLength(1);
    expect(
      eraseInk(
        [
          [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 50 },
          ],
        ],
        { x: 50, y: 0 },
        10,
      ),
    ).toHaveLength(2);
  });
});

it("exports repeatedly after undo, redo and a new branch without corrupting xref state", () => {
  const { doc, editor } = setup();
  try {
    create(editor, "Ink");
    const id = create(editor, "Text");
    for (const action of [
      "export",
      "undo",
      "export",
      "redo",
      "export",
      "undo",
      "branch",
      "export",
    ]) {
      if (action === "undo" || action === "redo") editor.apply({ action });
      if (action === "branch") create(editor, "FreeText");
      if (action === "export") {
        const bytes = editor.export();
        const saved = new mupdf.PDFDocument(bytes);
        try {
          expect(saved.wasRepaired()).toBe(false);
          expect(saved.countPages()).toBe(3);
          const page = saved.loadPage(0);
          try {
            expect(
              page
                .getAnnotations()
                .map((a) => a.getType())
                .sort(),
            ).toEqual(
              editor
                .list(0)
                .map((a) => a.type)
                .sort(),
            );
          } finally {
            page.destroy();
          }
        } finally {
          saved.destroy();
        }
      }
    }
    expect(
      editor.list(0).find((a) => a.id === id && a.type === "Text"),
    ).toBeUndefined();
  } finally {
    doc.destroy();
  }
});

it("preserves unsupported stamps and treats rich FreeText as read-only", () => {
  const source = new mupdf.PDFDocument(input());
  const p = source.loadPage(0);
  const stamp = source.addObject({
    Type: "Annot",
    Subtype: "Stamp",
    Rect: [10, 10, 80, 60],
    Name: "Approved",
    Contents: source.newString("Unsupported stamp"),
    PrivateData: "preserve-this",
  });
  p.getObject().get("Annots").push(stamp);
  const rich = p.createAnnotation("FreeText");
  rich.setRect([20, 100, 180, 150]);
  rich.setContents("Rich text");
  rich.getObject().put("RC", source.newString("<body><p>Rich text</p></body>"));
  rich.update();
  const buffer = source.saveToBuffer("");
  const original = new Uint8Array(buffer.asUint8Array());
  p.destroy();
  buffer.destroy();
  source.destroy();
  const doc = new mupdf.PDFDocument(original);
  try {
    const editor = new AnnotationEditor(doc, original);
    const before = editor.list(0);
    expect(before.find((a) => a.type === "Stamp")!.editable).toBe(false);
    expect(before.find((a) => a.type === "FreeText")!.editable).toBe(false);
    create(editor, "Ink");
    const saved = new mupdf.PDFDocument(editor.export());
    const page = saved.loadPage(0);
    try {
      const a = page.getAnnotations().find((a) => a.getType() === "Stamp")!;
      expect(a.getObject().get("PrivateData").asName()).toBe("preserve-this");
      expect(a.getContents()).toBe("Unsupported stamp");
    } finally {
      page.destroy();
      saved.destroy();
    }
  } finally {
    doc.destroy();
  }
});

it("keeps rendered ink and exported geometry consistent through undo/redo", () => {
  const { doc, editor } = setup();
  const render = () => {
    const p = doc.loadPage(0);
    try {
      const pix = p.toPixmap(
        mupdf.Matrix.identity,
        mupdf.ColorSpace.DeviceRGB,
        true,
      );
      try {
        const bytes = pix.getPixels();
        const i = (200 * pix.getWidth() + 75) * 4;
        return [...bytes.slice(i, i + 4)];
      } finally {
        pix.destroy();
      }
    } finally {
      p.destroy();
    }
  };
  try {
    const id = create(editor, "Ink");
    render();
    editor.apply({
      action: "erase",
      page: 0,
      id,
      center: { x: 75, y: 200 },
      radius: 10,
    });
    expect(editor.list(0).find((a) => a.id === id)!.ink).toHaveLength(2);
    expect(render()[3]).toBe(0);
    editor.export();
    editor.apply({ action: "undo" });
    render();
    editor.export();
    editor.apply({ action: "redo" });
    render();
    editor.apply({ action: "delete", page: 0, id });
    render();
    editor.apply({ action: "undo" });
    expect(editor.list(0).find((a) => a.id === id)!.ink).toHaveLength(2);
    expect(render()[3]).toBe(0);
  } finally {
    doc.destroy();
  }
});

describe("atomic group movement", () => {
  it.each([0, 1])(
    "moves Ink, Text and FreeText on page %i in one undo step and preserves export geometry",
    (index) => {
      const { doc, editor } = setup();
      try {
        const ids = (["Ink", "Text", "FreeText"] as const).map((kind) =>
          create(editor, kind, index),
        );
        const before = editor.list(index).filter((a) => ids.includes(a.id));
        const position = doc.getJournal().position;
        editor.apply({
          action: "move",
          page: index,
          ids,
          offset: { x: 25, y: -35 },
        });
        expect(doc.getJournal().position).toBe(position + 1);
        const after = editor.list(index).filter((a) => ids.includes(a.id));
        for (let i = 0; i < before.length; i++) {
          after[i].rect.forEach((v, j) =>
            expect(v).toBeCloseTo(
              before[i].rect[j] + (j % 2 === 0 ? 25 : -35),
              3,
            ),
          );
          expect(after[i].contents).toBe(before[i].contents);
        }
        expect(after.find((a) => a.type === "Ink")!.ink![0][0]).toEqual({
          x: 65,
          y: 165,
        });
        editor.apply({ action: "undo" });
        expect(editor.list(index).filter((a) => ids.includes(a.id))).toEqual(
          before,
        );
        editor.apply({ action: "redo" });
        expect(editor.list(index).filter((a) => ids.includes(a.id))).toEqual(
          after,
        );
        const bytes = editor.export();
        const saved = new mupdf.PDFDocument(bytes);
        try {
          const reopened = new AnnotationEditor(saved, bytes);
          expect(
            reopened.list(index).filter((a) => ids.includes(a.id)),
          ).toEqual(after);
        } finally {
          saved.destroy();
        }
        editor.apply({ action: "undo" });
        create(editor, "Ink", index);
        editor.apply({
          action: "move",
          page: index,
          ids,
          offset: { x: -10, y: 12 },
        });
        const branched = new mupdf.PDFDocument(editor.export());
        try {
          const page = branched.loadPage(index);
          expect(
            page.getAnnotations().filter((a) => a.getType() === "Ink"),
          ).toHaveLength(2);
          page.destroy();
          expect(branched.wasRepaired()).toBe(false);
        } finally {
          branched.destroy();
        }
      } finally {
        doc.destroy();
      }
    },
  );
  it("rolls back the entire group if a later item is protected, missing or has invalid destination geometry", () => {
    const doc = new mupdf.PDFDocument(input());
    const page = doc.loadPage(0);
    const lockedId = page.getAnnotations()[0].getObject().asIndirect();
    page.getAnnotations()[0].setFlags(mupdf.PDFAnnotation.IS_LOCKED);
    page.destroy();
    const editor = new AnnotationEditor(doc, input());
    try {
      const id = create(editor, "Ink");
      const before = editor.list(0),
        state = editor.state();
      for (const ids of [[id, lockedId], [id, 999999], [id, id], []]) {
        expect(() =>
          editor.apply({
            action: "move",
            page: 0,
            ids,
            offset: { x: 10, y: 20 },
          }),
        ).toThrow();
        expect(editor.list(0)).toEqual(before);
        expect(editor.state()).toEqual(state);
      }
      expect(() =>
        editor.apply({
          action: "move",
          page: 0,
          ids: [id],
          offset: { x: Infinity, y: 0 },
        }),
      ).toThrow();
      expect(editor.list(0)).toEqual(before);
    } finally {
      doc.destroy();
    }
  });
});
