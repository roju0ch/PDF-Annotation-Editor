import * as mupdf from "mupdf";
import { TILE_SIZE } from "../../core/render/tiles";
import { PageText } from "./text";
import type { PageInfo } from "./types";

export type TileRequest = {
  page: number;
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type RasterBox = Pick<TileRequest, "x" | "y" | "width" | "height">;
export type Raster = {
  pixels: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  overlayPixels?: Uint8ClampedArray<ArrayBuffer>;
  overlayBox?: RasterBox;
};
export type RasterOptions = { split?: boolean; overview?: boolean };
const MAX_PATCH_SIDE = 4096;
const MAX_PATCH_PIXELS = 4_200_000;

/** Keep expensive page contents separate from editable native appearances. */
export class TileRasterizer {
  private lists = new Map<number, mupdf.DisplayList>();
  private contentLists = new Map<number, mupdf.DisplayList>();
  private bounds = new Map<number, mupdf.Rect[]>();
  private text?: { id: number; page: PageText };
  constructor(private doc: mupdf.PDFDocument) {}

  /** Native annotation changes must never evict the page-content display list. */
  invalidateAnnotations() {
    this.drop(this.lists);
    this.bounds.clear();
  }

  clear() {
    this.invalidateAnnotations();
    this.text?.page.destroy();
    this.text = undefined;
    this.drop(this.contentLists);
    mupdf.shrinkStore(50);
  }

  private drop(lists: Map<number, mupdf.DisplayList>) {
    for (const list of lists.values()) list.destroy();
    lists.clear();
  }

  private validate(
    info: PageInfo | undefined,
    tile: TileRequest,
    patch = false,
  ): asserts info is PageInfo {
    const { page, scale, x, y, width, height } = tile;
    const side = patch ? MAX_PATCH_SIDE : TILE_SIZE;
    if (
      !info ||
      !Number.isInteger(page) ||
      page < 0 ||
      page >= this.doc.countPages() ||
      !Number.isFinite(scale) ||
      scale <= 0 ||
      scale > 128 ||
      ![x, y, width, height].every(Number.isSafeInteger) ||
      x < 0 ||
      y < 0 ||
      width < 1 ||
      height < 1 ||
      width > side ||
      height > side ||
      (patch && width * height > MAX_PATCH_PIXELS) ||
      x + width > Math.ceil(info.width * scale) ||
      y + height > Math.ceil(info.height * scale)
    )
      throw new Error("Ungültiger PDF-Bildausschnitt.");
  }

  private matrix(info: PageInfo, scale: number): mupdf.Matrix {
    return [
      scale,
      0,
      0,
      scale,
      -info.origin[0] * scale,
      -info.origin[1] * scale,
    ];
  }

  annotationBounds(info: PageInfo | undefined, page: number): mupdf.Rect[] {
    if (
      !info ||
      !Number.isInteger(page) ||
      page < 0 ||
      page >= this.doc.countPages()
    )
      throw new Error("Ungültige PDF-Seite.");
    const cached = this.bounds.get(page);
    if (cached) return cached;
    const p = this.doc.loadPage(page);
    try {
      const hidden =
        mupdf.PDFAnnotation.IS_HIDDEN | mupdf.PDFAnnotation.IS_NO_VIEW;
      const bounds = [...p.getAnnotations(), ...p.getWidgets()]
        .filter((a) => !(a.getFlags() & hidden))
        .map((a) => {
          const b = a.getBounds();
          return [
            b[0] - info.origin[0],
            b[1] - info.origin[1],
            b[2] - info.origin[0],
            b[3] - info.origin[1],
          ] as mupdf.Rect;
        })
        .filter((b) => b.every(Number.isFinite) && b[2] > b[0] && b[3] > b[1]);
      this.bounds.set(page, bounds);
      while (this.bounds.size > 8)
        this.bounds.delete(this.bounds.keys().next().value!);
      return bounds;
    } finally {
      p.destroy();
    }
  }

  pageText(page: number, info: PageInfo) {
    if (this.text?.id !== info.id) {
      this.text?.page.destroy();
      this.text = undefined;
      this.text = {
        id: info.id,
        page: new PageText(this.displayList(page, true)),
      };
    }
    return this.text.page;
  }

  // Borrowed from this renderer: callers must not destroy the list.
  private displayList(page: number, contentsOnly: boolean) {
    const lists = contentsOnly ? this.contentLists : this.lists;
    let list = lists.get(page);
    if (list) lists.delete(page);
    else {
      const loaded = this.doc.loadPage(page);
      try {
        list = loaded.toDisplayList(!contentsOnly);
      } finally {
        loaded.destroy();
      }
    }
    lists.set(page, list);
    while (lists.size > 2) {
      const first = lists.keys().next().value!;
      lists.get(first)!.destroy();
      lists.delete(first);
    }
    return list;
  }

  render(
    info: PageInfo | undefined,
    tile: TileRequest,
    options: RasterOptions = {},
  ): Raster {
    this.validate(info, tile, options.overview);
    const { page, scale, x, y, width, height } = tile;
    const list = this.displayList(page, !!options.split);
    const pix = new mupdf.Pixmap(
      mupdf.ColorSpace.DeviceRGB,
      [x, y, x + width, y + height],
      true,
    );
    try {
      // A native white backdrop keeps later blending (e.g. Multiply highlight)
      // equivalent to a complete PDF page viewed against white paper.
      if (options.split) pix.clear(255);
      else pix.clear();
      const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
      try {
        list.run(device, this.matrix(info, scale));
        device.close();
      } finally {
        device.destroy();
      }
      const result: Raster = {
        pixels: new Uint8ClampedArray(pix.getPixels()),
        width,
        height,
      };
      if (options.split) {
        // Transfer only the native-appearance region, not another full tile for
        // a small note. Include filter/AA bleed without exceeding this surface.
        const regions = this.annotationBounds(info, page).filter(
          (b) =>
            b[0] * scale < x + width &&
            b[2] * scale > x &&
            b[1] * scale < y + height &&
            b[3] * scale > y,
        );
        if (regions.length) {
          const left = Math.max(
            x,
            Math.floor(Math.min(...regions.map((b) => b[0])) * scale) - 3,
          );
          const top = Math.max(
            y,
            Math.floor(Math.min(...regions.map((b) => b[1])) * scale) - 3,
          );
          const right = Math.min(
            x + width,
            Math.ceil(Math.max(...regions.map((b) => b[2])) * scale) + 3,
          );
          const bottom = Math.min(
            y + height,
            Math.ceil(Math.max(...regions.map((b) => b[3])) * scale) + 3,
          );
          const box: RasterBox = {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
          };
          const background = new Uint8ClampedArray(box.width * box.height * 4);
          for (let row = 0; row < box.height; row++) {
            const offset = ((box.y - y + row) * width + box.x - x) * 4;
            background.set(
              result.pixels.subarray(offset, offset + box.width * 4),
              row * box.width * 4,
            );
          }
          result.overlayPixels = this.composite(
            info,
            { ...tile, ...box },
            background,
          ).pixels;
          result.overlayBox = box;
        }
      }
      return result;
    } finally {
      pix.destroy();
    }
  }

  /** Replay only native annotations/widgets over cached, clean content pixels. */
  composite(
    info: PageInfo | undefined,
    tile: TileRequest,
    background: Uint8ClampedArray<ArrayBuffer>,
  ): Raster {
    this.validate(info, tile, true);
    const { page, scale, x, y, width, height } = tile;
    if (
      !(background instanceof Uint8ClampedArray) ||
      background.byteLength !== width * height * 4
    )
      throw new Error("Ungültige PDF-Hintergrundpixel.");
    const pix = new mupdf.Pixmap(
      mupdf.ColorSpace.DeviceRGB,
      [x, y, x + width, y + height],
      true,
    );
    try {
      pix.getPixels().set(background);
      const p = this.doc.loadPage(page);
      try {
        const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
        try {
          p.runPageAnnots(device, this.matrix(info, scale));
          p.runPageWidgets(device, this.matrix(info, scale));
          device.close();
        } finally {
          device.destroy();
        }
      } finally {
        p.destroy();
      }
      return { pixels: new Uint8ClampedArray(pix.getPixels()), width, height };
    } finally {
      pix.destroy();
    }
  }
}
