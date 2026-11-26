import { transform } from "../src/core/viewport";
import * as mupdf from "mupdf";
import { describe, expect, it, vi } from "vitest";
import { TileRasterizer } from "../src/adapters/pdf/raster";
import { pageInfos } from "../src/adapters/pdf/pages";
import { lines, pdfTextFixture } from "./pdfTextFixture";

describe("structured page text", () => {
  for (const rotation of [0, 90, 180, 270] as const)
    it(`selects exact words and reversed lines on cropped pages at ${rotation}°`, () => {
      const doc = new mupdf.PDFDocument(pdfTextFixture(rotation));
      const raster = new TileRasterizer(doc);
      const lists = vi.spyOn(mupdf.PDFPage.prototype, "toDisplayList");
      try {
        const [first, blank] = pageInfos(doc);
        raster.render(
          first,
          { page: 0, scale: 1, x: 0, y: 0, width: 50, height: 50 },
          { split: true },
        );
        const page = raster.pageText(0, first);
        const pt = (x: number, y: number): mupdf.Point => {
          const p = transform({ x: 20 + x, y: 430 - y }, first.pdfToPage);
          return [p.x, p.y];
        };
        const all = page.select({ mode: "all" });
        expect(all.text).toBe(lines.join("\n"));
        expect(all.quads).toHaveLength(2);
        expect(page.select({ mode: "word", at: pt(65, 72) }).text).toBe(
          "Grüße",
        );
        expect(page.select({ mode: "word", at: pt(320, 300) }).text).toBe("");
        expect(
          page.select({ mode: "range", start: pt(112, 104), end: pt(40, 72) })
            .text,
        ).toBe(lines[0] + "\nZweite");
        raster.invalidateAnnotations();
        expect(raster.pageText(0, first)).toBe(page);
        expect(lists).toHaveBeenCalledTimes(1);
        expect(lists).toHaveBeenCalledWith(false);
        expect(raster.pageText(1, blank).select({ mode: "all" })).toEqual({
          readable: false,
          text: "",
          quads: [],
        });
      } finally {
        lists.mockRestore();
        raster.clear();
        doc.destroy();
      }
    });
  it("copies and paints every line beyond MuPDF's default quad limit", () => {
    const rows = Array.from({ length: 260 }, (_, i) => `Zeile ${i + 1}`);
    const doc = new mupdf.PDFDocument(pdfTextFixture(0, rows)),
      raster = new TileRasterizer(doc);
    try {
      const selection = raster
        .pageText(0, pageInfos(doc)[0])
        .select({ mode: "all" });
      expect(selection.text).toBe(rows.join("\n"));
      expect(selection.quads).toHaveLength(rows.length);
    } finally {
      raster.clear();
      doc.destroy();
    }
  });
});
