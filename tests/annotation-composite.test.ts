import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { expect, it, vi } from "vitest";
import { pageInfos } from "../src/adapters/pdf/pages";
import {
  TileRasterizer,
  type Raster,
  type TileRequest,
} from "../src/adapters/pdf/raster";
import type { PageInfo } from "../src/adapters/pdf/types";
import { TILE_SIZE } from "../src/core/render/tiles";

function highlight(doc: mupdf.PDFDocument, page = 0) {
  const loaded = doc.loadPage(page);
  try {
    const annotation = loaded.createAnnotation("Highlight");
    annotation.setQuadPoints([[20, 85, 220, 85, 20, 115, 220, 115]]);
    annotation.setColor([1, 1, 0]);
    annotation.setOpacity(0.65);
    annotation.update();
    return annotation.getObject().asIndirect();
  } finally {
    loaded.destroy();
  }
}

function plan() {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(
    -1,
    doc.addPage([0, 0, 240, 180], 0, {}, "0 0 0 RG 4 w 0 80 m 240 80 l S"),
  );
  highlight(doc);
  return doc;
}

function widgetDocument() {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(-1, doc.addPage([0, 0, 200, 200], 0, {}, ""));
  // A real foreign-style form appearance, deliberately absent from
  // getAnnotations(): MuPDF exposes widgets through a separate collection.
  const appearance = doc.addStream("0 0.3 1 rg 0 0 80 40 re f", {
    Type: "XObject",
    Subtype: "Form",
    BBox: [0, 0, 80, 40],
    Resources: {},
  });
  const widget = doc.addObject({
    Type: "Annot",
    Subtype: "Widget",
    Rect: [30, 70, 110, 110],
    FT: "Btn",
    T: doc.newString("Synthetic button"),
    F: 4,
    AP: { N: appearance },
    P: doc.findPage(0),
  });
  doc.findPage(0).put("Annots", [widget]);
  doc
    .getTrailer()
    .get("Root")
    .put("AcroForm", { Fields: [widget] });
  return doc;
}

/** Independent oracle: MuPDF's opaque RGB full-page renderer, then a crop. */
function nativePixels(
  doc: mupdf.PDFDocument,
  info: PageInfo,
  tile: TileRequest,
  extras: boolean,
) {
  const loaded = doc.loadPage(tile.page);
  const pixmap = loaded.toPixmap(
    [
      tile.scale,
      0,
      0,
      tile.scale,
      -info.origin[0] * tile.scale,
      -info.origin[1] * tile.scale,
    ],
    mupdf.ColorSpace.DeviceRGB,
    false,
    extras,
  );
  try {
    const source = pixmap.getPixels();
    const result = new Uint8ClampedArray(tile.width * tile.height * 4);
    for (let y = 0; y < tile.height; y++)
      for (let x = 0; x < tile.width; x++) {
        const from = ((tile.y + y) * pixmap.getWidth() + tile.x + x) * 3;
        const to = (y * tile.width + x) * 4;
        result.set(source.subarray(from, from + 3), to);
        result[to + 3] = 255;
      }
    return result;
  } finally {
    pixmap.destroy();
    loaded.destroy();
  }
}

function matchesNative(actual: Uint8ClampedArray, expected: Uint8ClampedArray) {
  expect(actual.length).toBe(expected.length);
  let maximum = 0;
  let total = 0;
  for (let i = 0; i < actual.length; i++) {
    const difference = Math.abs(actual[i] - expected[i]);
    maximum = Math.max(maximum, difference);
    total += difference;
  }
  // Clipped MuPDF rasterization can quantize stroke-edge coverage slightly
  // differently. A displaced line or an incorrectly blended highlight fails.
  expect(maximum).toBeLessThanOrEqual(20);
  expect(total / actual.length).toBeLessThan(0.08);
}

function pixel(pixels: Uint8ClampedArray, width: number, x: number, y: number) {
  const at = (y * width + x) * 4;
  return Array.from(pixels.subarray(at, at + 4));
}

function fullComposite(split: Raster, tile: TileRequest) {
  const result = new Uint8ClampedArray(split.pixels);
  if (!split.overlayPixels) {
    expect(split.overlayBox).toBeUndefined();
    return result;
  }
  expect(split.overlayBox).toBeDefined();
  const box = split.overlayBox!;
  expect(
    [box.x, box.y, box.width, box.height].every(Number.isSafeInteger),
  ).toBe(true);
  expect(box.x).toBeGreaterThanOrEqual(tile.x);
  expect(box.y).toBeGreaterThanOrEqual(tile.y);
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  expect(box.x + box.width).toBeLessThanOrEqual(tile.x + tile.width);
  expect(box.y + box.height).toBeLessThanOrEqual(tile.y + tile.height);
  expect(split.overlayPixels.length).toBe(box.width * box.height * 4);
  for (let row = 0; row < box.height; row++) {
    const source = row * box.width * 4;
    const destination =
      ((box.y - tile.y + row) * tile.width + box.x - tile.x) * 4;
    result.set(
      split.overlayPixels.subarray(source, source + box.width * 4),
      destination,
    );
  }
  return result;
}

function annotationObjects(doc: mupdf.PDFDocument, page = 0) {
  const annotations: { dictionary: string; appearance: string }[] = [];
  doc
    .findPage(page)
    .get("Annots")
    .forEach((annotation) => {
      const appearance = annotation.get("AP", "N");
      let contents = "";
      if (appearance.isStream()) {
        const stream = appearance.readStream();
        try {
          contents = stream.asString();
        } finally {
          stream.destroy();
        }
      }
      annotations.push({
        dictionary: annotation.resolve().toString(),
        appearance: contents,
      });
    });
  return annotations;
}

it("keeps the black plan line black under a native Multiply highlight", () => {
  const doc = plan();
  const info = pageInfos(doc)[0];
  const raster = new TileRasterizer(doc);
  const tile = { page: 0, scale: 1, x: 0, y: 0, width: 240, height: 180 };
  try {
    const appearance = doc.findPage(0).get("Annots", 0, "AP", "N");
    expect(appearance.get("Resources", "ExtGState", "H", "BM").asName()).toBe(
      "Multiply",
    );
    const split = raster.render(info, tile, { split: true });
    expect([split.width, split.height]).toEqual([240, 180]);
    matchesNative(split.pixels, nativePixels(doc, info, tile, false));
    expect(pixel(split.pixels, 240, 120, 90)).toEqual([255, 255, 255, 255]);
    expect(pixel(split.pixels, 240, 120, 100)).toEqual([0, 0, 0, 255]);
    expect(split.overlayPixels).toBeDefined();
    const full = fullComposite(split, tile);
    expect(split.overlayPixels!.length).toBeLessThan(split.pixels.length);
    matchesNative(full, nativePixels(doc, info, tile, true));
    expect(pixel(full, 240, 120, 90)).toEqual([255, 255, 90, 255]);
    expect(pixel(full, 240, 120, 100)).toEqual([0, 0, 0, 255]);

    const composite = raster.composite(info, tile, split.pixels);
    matchesNative(composite.pixels, nativePixels(doc, info, tile, true));
    expect(pixel(composite.pixels, 240, 120, 100)).toEqual([0, 0, 0, 255]);
  } finally {
    raster.clear();
    doc.destroy();
  }
});

it("renders native widget appearances when the ordinary annotation collection is empty", () => {
  const doc = widgetDocument();
  const info = pageInfos(doc)[0];
  const raster = new TileRasterizer(doc);
  const tile = { page: 0, scale: 1, x: 0, y: 0, width: 200, height: 200 };
  try {
    const loaded = doc.loadPage(0);
    try {
      expect(loaded.getAnnotations()).toHaveLength(0);
      expect(loaded.getWidgets()).toHaveLength(1);
    } finally {
      loaded.destroy();
    }
    const split = raster.render(info, tile, { split: true });
    expect(pixel(split.pixels, 200, 50, 100)).toEqual([255, 255, 255, 255]);
    expect(split.overlayPixels).toBeDefined();
    const full = fullComposite(split, tile);
    expect(split.overlayPixels!.length).toBeLessThan(split.pixels.length);
    matchesNative(full, nativePixels(doc, info, tile, true));
    expect(pixel(full, 200, 50, 100)).toEqual([0, 76, 255, 255]);
    matchesNative(
      raster.composite(info, tile, split.pixels).pixels,
      nativePixels(doc, info, tile, true),
    );
    expect(raster.annotationBounds(info, 0)).toEqual([[30, 90, 110, 130]]);
  } finally {
    raster.clear();
    doc.destroy();
  }
});

it("matches native crop and rotation for clipped composites and normalized bounds", () => {
  const doc = new mupdf.PDFDocument(
    new Uint8Array(readFileSync("artifacts/fixture.pdf")),
  );
  highlight(doc, 1);
  const info = pageInfos(doc)[1];
  const raster = new TileRasterizer(doc);
  try {
    expect(info.rotation).toBe(90);
    const loaded = doc.loadPage(1);
    let expectedBounds: number[][];
    try {
      expectedBounds = loaded.getAnnotations().map((annotation) => {
        const [x0, y0, x1, y1] = annotation.getBounds();
        return [
          x0 - info.origin[0],
          y0 - info.origin[1],
          x1 - info.origin[0],
          y1 - info.origin[1],
        ];
      });
    } finally {
      loaded.destroy();
    }
    expect(raster.annotationBounds(info, 1)).toHaveLength(
      expectedBounds.length,
    );
    raster
      .annotationBounds(info, 1)
      .forEach((bounds, index) =>
        bounds.forEach((coordinate, axis) =>
          expect(coordinate).toBeCloseTo(expectedBounds[index][axis], 4),
        ),
      );
    for (const scale of [1, Math.SQRT2, 2]) {
      const tile = { page: 1, scale, x: 41, y: 58, width: 231, height: 173 };
      const split = raster.render(info, tile, { split: true });
      matchesNative(split.pixels, nativePixels(doc, info, tile, false));
      expect(split.overlayPixels).toBeDefined();
      matchesNative(
        fullComposite(split, tile),
        nativePixels(doc, info, tile, true),
      );
      matchesNative(
        raster.composite(info, tile, split.pixels).pixels,
        nativePixels(doc, info, tile, true),
      );
    }
  } finally {
    raster.clear();
    doc.destroy();
  }
});

it("rejects invalid composite pixel payloads and bounds before loading a page", () => {
  const doc = new mupdf.PDFDocument(
    new Uint8Array(readFileSync("artifacts/fixture.pdf")),
  );
  const info = pageInfos(doc)[2];
  const raster = new TileRasterizer(doc);
  const load = vi.spyOn(doc, "loadPage");
  const good = { page: 2, scale: 2, x: 0, y: 0, width: 10, height: 10 };
  try {
    for (const pixels of [
      new Uint8ClampedArray(0),
      new Uint8ClampedArray(399),
      new Uint8ClampedArray(401),
      new Uint8Array(400) as unknown as Uint8ClampedArray<ArrayBuffer>,
    ])
      expect(() => raster.composite(info, good, pixels)).toThrow();
    for (const patch of [
      { page: -1 },
      { scale: 0 },
      { scale: Infinity },
      { scale: 129 },
      { x: -1 },
      { y: 0.5 },
      { width: 0 },
      { width: 4097 },
      { width: 3000, height: 1500 },
      { x: 4760, width: 10 },
      { y: 6740 },
    ])
      expect(() =>
        raster.composite(
          info,
          { ...good, ...patch },
          new Uint8ClampedArray(400),
        ),
      ).toThrow();
    expect(() =>
      raster.composite(undefined, good, new Uint8ClampedArray(400)),
    ).toThrow();
    expect(() =>
      raster.render(info, { ...good, width: TILE_SIZE + 1 }, { split: true }),
    ).toThrow();
    expect(() => raster.annotationBounds(undefined, 2)).toThrow();
    expect(() => raster.annotationBounds(info, -1)).toThrow();
    expect(() => raster.annotationBounds(info, 3)).toThrow();
    expect(load).not.toHaveBeenCalled();

    // A composed annotation region may exceed the normal 1024-pixel tile side.
    const region = { page: 2, scale: 1, x: 0, y: 0, width: 1025, height: 2 };
    const background = new Uint8ClampedArray(region.width * region.height * 4);
    background.fill(255);
    const result = raster.composite(info, region, background);
    expect([result.width, result.height]).toEqual([1025, 2]);
    expect(result.pixels).toEqual(background);
  } finally {
    raster.clear();
    doc.destroy();
  }
});

it("retains content display lists when edited native appearances are invalidated", () => {
  const doc = plan();
  const info = pageInfos(doc)[0];
  const raster = new TileRasterizer(doc);
  const toDisplayList = vi.spyOn(mupdf.PDFPage.prototype, "toDisplayList");
  const contentBuilds = () =>
    toDisplayList.mock.calls.filter(([extras]) => extras === false).length;
  const tile = { page: 0, scale: 1, x: 0, y: 0, width: 240, height: 180 };
  try {
    const before = raster.render(info, tile, { split: true });
    const beforeFull = fullComposite(before, tile);
    expect(contentBuilds()).toBe(1);
    const loaded = doc.loadPage(0);
    try {
      const annotation = loaded.getAnnotations()[0];
      annotation.setColor([0, 1, 1]);
      annotation.update();
    } finally {
      loaded.destroy();
    }
    raster.invalidateAnnotations();
    const after = raster.render(info, tile, { split: true });
    const afterFull = fullComposite(after, tile);
    expect(after.pixels).toEqual(before.pixels);
    expect(afterFull).not.toEqual(beforeFull);
    matchesNative(afterFull, nativePixels(doc, info, tile, true));
    expect(pixel(afterFull, 240, 120, 90)).toEqual([90, 255, 255, 255]);
    expect(contentBuilds()).toBe(1);
    raster.clear();
    raster.render(info, tile, { split: true });
    expect(contentBuilds()).toBe(2);
  } finally {
    raster.clear();
    toDisplayList.mockRestore();
    doc.destroy();
  }
});

it("preserves native annotation dictionaries and appearance streams through rendering and export", () => {
  for (const doc of [plan(), widgetDocument()]) {
    const raster = new TileRasterizer(doc);
    const info = pageInfos(doc)[0];
    const tile = {
      page: 0,
      scale: 1,
      x: 0,
      y: 0,
      width: info.width,
      height: info.height,
    };
    try {
      const before = annotationObjects(doc);
      const split = raster.render(info, tile, { split: true });
      raster.composite(info, tile, split.pixels);
      raster.annotationBounds(info, 0);
      raster.invalidateAnnotations();
      raster.render(info, tile, { split: true });
      expect(annotationObjects(doc)).toEqual(before);
      const buffer = doc.saveToBuffer("compress");
      const saved = new mupdf.PDFDocument(buffer);
      try {
        expect(saved.wasRepaired()).toBe(false);
        expect(annotationObjects(saved)).toEqual(before);
        matchesNative(
          nativePixels(saved, pageInfos(saved)[0], tile, true),
          nativePixels(doc, info, tile, true),
        );
      } finally {
        saved.destroy();
        buffer.destroy();
      }
    } finally {
      raster.clear();
      doc.destroy();
    }
  }
});
