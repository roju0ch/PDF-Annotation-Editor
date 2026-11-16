import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { expect, it, vi } from "vitest";
import { TILE_SIZE } from "../src/core/render/tiles";
import { AnnotationEditor } from "../src/adapters/pdf/annotations";
import { pageInfos } from "../src/adapters/pdf/pages";
import { TileRasterizer } from "../src/adapters/pdf/raster";

const input = () => new Uint8Array(readFileSync("artifacts/fixture.pdf"));
function setup() {
  const doc = new mupdf.PDFDocument(input());
  return { doc, pages: pageInfos(doc), raster: new TileRasterizer(doc) };
}

for (const page of [0, 1])
  it(`matches directly rendered pixels including crop/rotation on page ${page}`, () => {
    const { doc, pages, raster } = setup();
    try {
      const info = pages[page];
      for (const scale of [1, Math.SQRT2, 2]) {
        const p = doc.loadPage(page);
        const full = p.toPixmap(
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
          const expected = full.getPixels();
          // Nonzero pixel origins exercise actual clipping, not a scaled crop.
          for (const [x, y, width, height] of [
            [0, 0, 99, 103],
            [41, 58, 151, 137],
            [0, 190, 256, 200],
          ]) {
            const tile = raster.render(info, {
              page,
              scale,
              x,
              y,
              width,
              height,
            });
            expect([tile.width, tile.height]).toEqual([width, height]);
            expect(tile.pixels.byteLength).toBe(width * height * 4);
            // Clipped MuPDF stroke rasterization can quantize edge coverage
            // differently from full-page drawing. Bound both the worst channel
            // error and its mean; a shifted line or changed color fails these.
            let max = 0,
              total = 0;
            for (let row = 0; row < height; row++) {
              const at = ((row + y) * full.getWidth() + x) * 4;
              for (let col = 0; col < width * 4; col++) {
                const delta = Math.abs(
                  tile.pixels[row * width * 4 + col] - expected[at + col],
                );
                max = Math.max(max, delta);
                total += delta;
              }
            }
            expect(max).toBeLessThanOrEqual(20);
            expect(total / tile.pixels.length).toBeLessThan(0.06);
          }
        } finally {
          full.destroy();
          p.destroy();
        }
      }
    } finally {
      raster.clear();
      doc.destroy();
    }
  });

it("preserves high zoom detail on an A0 page while allocating only a bounded tile", () => {
  const { doc, pages, raster } = setup();
  try {
    const tile = raster.render(pages[2], {
      page: 2,
      scale: 24,
      x: 4096,
      y: 8192,
      width: TILE_SIZE,
      height: TILE_SIZE,
    });
    expect([tile.width, tile.height, tile.pixels.byteLength]).toEqual([
      TILE_SIZE,
      TILE_SIZE,
      TILE_SIZE * TILE_SIZE * 4,
    ]);
  } finally {
    raster.clear();
    doc.destroy();
  }
});

it("rejects malformed/outside/oversized requests before building a display list", () => {
  const { doc, pages, raster } = setup();
  const load = vi.spyOn(doc, "loadPage");
  const good = { page: 0, scale: 2, x: 0, y: 0, width: 100, height: 100 };
  try {
    for (const patch of [
      { scale: 0 },
      { scale: Infinity },
      { scale: 129 },
      { x: -1 },
      { y: 1.5 },
      { width: 0 },
      { width: TILE_SIZE + 1 },
      { height: TILE_SIZE + 1 },
      { x: 599, width: 2 },
      { y: 799, height: 2 },
      { page: -1 },
    ])
      expect(() => raster.render(pages[0], { ...good, ...patch })).toThrow(
        /Bildausschnitt/,
      );
    expect(() => raster.render(undefined, good)).toThrow(/Bildausschnitt/);
    expect(load).not.toHaveBeenCalled();
  } finally {
    raster.clear();
    doc.destroy();
  }
});

it("reuses two display lists and frees/rebuilds evicted or invalidated pages", () => {
  const { doc, pages, raster } = setup();
  const load = vi.spyOn(doc, "loadPage");
  const render = (page: number) =>
    raster.render(pages[page], {
      page,
      scale: 1,
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
  try {
    render(0);
    render(0);
    render(1);
    render(2);
    expect(load).toHaveBeenCalledTimes(3);
    render(0);
    expect(load).toHaveBeenCalledTimes(4);
    raster.clear();
    render(0);
    expect(load).toHaveBeenCalledTimes(5);
  } finally {
    raster.clear();
    doc.destroy();
  }
});

it("shows edited native annotations after invalidation and preserves them through PDF export", () => {
  const { doc, pages, raster } = setup();
  const request = { page: 0, scale: 1, x: 0, y: 0, width: 300, height: 400 };
  try {
    const before = raster.render(pages[0], request).pixels;
    const editor = new AnnotationEditor(doc, input());
    editor.apply({
      action: "create",
      page: 0,
      kind: "Ink",
      rect: [40, 80, 200, 160],
      contents: "Raster round trip",
      color: "#ff0000",
      width: 5,
      fontSize: 14,
      ink: [
        [
          { x: 40, y: 80 },
          { x: 200, y: 160 },
        ],
      ],
    });
    raster.clear();
    const updated = raster.render(pages[0], request).pixels;
    expect(updated).not.toEqual(before);
    const saved = new mupdf.PDFDocument(editor.export());
    const reopened = new TileRasterizer(saved);
    try {
      expect(saved.wasRepaired()).toBe(false);
      expect(reopened.render(pageInfos(saved)[0], request).pixels).toEqual(
        updated,
      );
    } finally {
      reopened.clear();
      saved.destroy();
    }
  } finally {
    raster.clear();
    doc.destroy();
  }
});

it("resolves closely spaced fine vector lines at zoom scale instead of enlarging the overview", () => {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(
    -1,
    doc.addPage(
      [0, 0, 3000, 2000],
      0,
      {},
      "0 0 0 RG 0.25 w 100 1900 m 140 1900 l S 100 1899 m 140 1899 l S 100 1898 m 140 1898 l S",
    ),
  );
  const info = pageInfos(doc)[0],
    raster = new TileRasterizer(doc);
  try {
    const tile = raster.render(info, {
      page: 0,
      scale: 8,
      x: 800,
      y: 784,
      width: 320,
      height: 48,
    });
    const alpha = (row: number) =>
      tile.pixels[(row * tile.width + 100) * 4 + 3];
    // Each 0.25 pt line becomes two actual raster pixels at 8x; the
    // intervening one-point spacing remains independently resolved.
    for (const row of [16, 24, 32]) expect(alpha(row)).toBeGreaterThan(240);
    for (const row of [20, 28]) expect(alpha(row)).toBe(0);
  } finally {
    raster.clear();
    doc.destroy();
  }
});

it("keeps page-content display lists and pixels across native annotation edits", () => {
  const { doc, pages, raster } = setup();
  const request = { page: 0, scale: 1, x: 0, y: 0, width: 300, height: 400 };
  const displayList = vi.spyOn(mupdf.PDFPage.prototype, "toDisplayList");
  const editor = new AnnotationEditor(doc, input());
  try {
    const initial = raster.render(pages[0], request, { split: true });
    expect(initial.overlayPixels).toBeDefined(); // Existing third-party note.
    const builds = () =>
      displayList.mock.calls.filter(([extras]) => extras === false).length;
    expect(builds()).toBe(1);
    const before = raster.composite(pages[0], request, initial.pixels).pixels;
    const id = editor.apply({
      action: "create",
      page: 0,
      kind: "Ink",
      rect: [40, 80, 200, 160],
      contents: "Fast native annotation",
      color: "#ff0000",
      width: 5,
      fontSize: 14,
      ink: [
        [
          { x: 40, y: 80 },
          { x: 200, y: 160 },
        ],
      ],
    })!;
    const created = new Uint8ClampedArray(
      raster.composite(pages[0], request, initial.pixels).pixels,
    );
    expect(created).not.toEqual(before);
    for (const command of [
      { action: "move", page: 0, ids: [id], offset: { x: 7, y: 9 } },
      { action: "delete-many", page: 0, ids: [id] },
      { action: "undo" },
      { action: "redo" },
    ] satisfies import("../src/core/annotations/model").AnnotationCommand[]) {
      editor.apply(command);
      raster.invalidateAnnotations();
      const patch = raster.composite(pages[0], request, initial.pixels);
      expect(patch.pixels.byteLength).toBe(initial.pixels.byteLength);
      const next = raster.render(pages[0], request, { split: true });
      expect(next.pixels).toEqual(initial.pixels);
      expect(builds()).toBe(1);
    }
    raster.clear();
    raster.render(pages[0], request, { split: true });
    expect(builds()).toBe(2); // Document/structure invalidation may rebuild.
  } finally {
    displayList.mockRestore();
    raster.clear();
    doc.destroy();
  }
});
