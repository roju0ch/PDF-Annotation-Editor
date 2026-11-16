import * as mupdf from "mupdf";
import { TILE_SIZE } from "../../core/render/tiles";
import type { PageInfo } from "./types";

export type TileRequest = {
  page: number;
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type Raster = {
  pixels: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
};

/** Pixel-bounded details: the size of a page never determines allocation size. */
export class TileRasterizer {
  private lists = new Map<number, mupdf.DisplayList>();
  constructor(private doc: mupdf.PDFDocument) {}

  clear() {
    for (const list of this.lists.values()) list.destroy();
    this.lists.clear();
    mupdf.shrinkStore(50);
  }

  render(info: PageInfo | undefined, tile: TileRequest): Raster {
    const { page, scale, x, y, width, height } = tile;
    if (
      !info ||
      !Number.isInteger(page) ||
      page < 0 ||
      !Number.isFinite(scale) ||
      scale <= 0 ||
      scale > 128 ||
      ![x, y, width, height].every(Number.isSafeInteger) ||
      x < 0 ||
      y < 0 ||
      width < 1 ||
      height < 1 ||
      width > TILE_SIZE ||
      height > TILE_SIZE ||
      x + width > Math.ceil(info.width * scale) ||
      y + height > Math.ceil(info.height * scale)
    )
      throw new Error("Ungültiger PDF-Bildausschnitt.");

    let list = this.lists.get(page);
    if (list) {
      this.lists.delete(page);
    } else {
      const loaded = this.doc.loadPage(page);
      try {
        list = loaded.toDisplayList(true);
      } finally {
        loaded.destroy();
      }
    }
    this.lists.set(page, list);
    while (this.lists.size > 2) {
      const first = this.lists.keys().next().value!;
      this.lists.get(first)!.destroy();
      this.lists.delete(first);
    }
    const pix = new mupdf.Pixmap(
      mupdf.ColorSpace.DeviceRGB,
      [x, y, x + width, y + height],
      true,
    );
    try {
      pix.clear();
      const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
      try {
        list.run(device, [
          scale,
          0,
          0,
          scale,
          -info.origin[0] * scale,
          -info.origin[1] * scale,
        ]);
        device.close();
      } finally {
        device.destroy();
      }
      return {
        pixels: new Uint8ClampedArray(pix.getPixels()),
        width: pix.getWidth(),
        height: pix.getHeight(),
      };
    } finally {
      pix.destroy();
    }
  }
}
