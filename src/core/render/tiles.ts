import type { Point, View } from "../viewport";

export const TILE_SIZE = 1024;
const TILE_STEP = TILE_SIZE - 4; // Two raster pixels of bleed on each edge.
export const MAX_VISIBLE_TILES = 256;
export const RASTER_CACHE_BYTES = 32 * 1024 * 1024;
export const MAX_LIVE_RASTER_PIXELS = 24 * 1024 * 1024;
export type Tile = {
  page: number;
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
  key: string;
};

/** Pixel density is a viewport property, independent of the size of a PDF page. */
export function rasterScale(viewScale: number, devicePixelRatio: number) {
  const dpr = Number.isFinite(devicePixelRatio)
    ? Math.max(1, Math.min(4, devicePixelRatio))
    : 1;
  const requested = viewScale * dpr;
  return Math.min(128, 2 ** (Math.ceil(Math.log2(requested) * 2) / 2));
}

/** Rasterize only viewport-intersecting tiles, ordered from the center out. */
export function visibleTilePlan(
  pages: readonly { width: number; height: number }[],
  tops: readonly number[],
  visiblePageIndices: readonly number[],
  view: View,
  box: Point,
  devicePixelRatio: number,
): Tile[] {
  if (
    ![view.x, view.y, view.scale, box.x, box.y].every(Number.isFinite) ||
    view.scale <= 0 ||
    box.x <= 0 ||
    box.y <= 0
  )
    return [];
  let scale = rasterScale(view.scale, devicePixelRatio);
  let level = Math.round(Math.log2(scale) * 2);
  for (;;) {
    const tiles = tilesAtScale(
      pages,
      tops,
      visiblePageIndices,
      view,
      box,
      scale,
    );
    const pixels = tiles.reduce(
      (sum, tile) => sum + tile.width * tile.height,
      0,
    );
    if (pixels <= MAX_LIVE_RASTER_PIXELS || scale < 1 / 1024) return tiles;
    // Limit live canvas memory too, independently of the bitmap LRU. On very
    // large HiDPI viewports prefer complete coverage at a lower pixel density.
    scale = 2 ** (--level / 2);
  }
}

function tilesAtScale(
  pages: readonly { width: number; height: number }[],
  tops: readonly number[],
  visiblePageIndices: readonly number[],
  view: View,
  box: Point,
  scale: number,
): Tile[] {
  const candidates: { tile: Tile; distance: number }[] = [];
  for (const page of new Set(visiblePageIndices)) {
    const info = pages[page];
    const top = tops[page];
    if (
      !info ||
      ![info.width, info.height, top].every(Number.isFinite) ||
      info.width <= 0 ||
      info.height <= 0
    )
      continue;
    const left = Math.max(0, (-view.x / view.scale) * scale);
    const right = Math.min(
      info.width * scale,
      ((box.x - view.x) / view.scale) * scale,
    );
    const upper = Math.max(0, (-view.y / view.scale - top) * scale);
    const lower = Math.min(
      info.height * scale,
      ((box.y - view.y) / view.scale - top) * scale,
    );
    if (right <= left || lower <= upper) continue;
    const firstColumn = Math.floor(left / TILE_STEP);
    const lastColumn = Math.ceil(right / TILE_STEP) - 1;
    const firstRow = Math.floor(upper / TILE_STEP);
    const lastRow = Math.ceil(lower / TILE_STEP) - 1;
    const width = Math.ceil(info.width * scale);
    const height = Math.ceil(info.height * scale);
    let startColumn = Math.max(0, firstColumn);
    let endColumn = Math.min(Math.ceil(width / TILE_STEP) - 1, lastColumn);
    let startRow = Math.max(0, firstRow);
    let endRow = Math.min(Math.ceil(height / TILE_STEP) - 1, lastRow);
    const columns = endColumn - startColumn + 1;
    const rows = endRow - startRow + 1;
    // Enumerating a complete page first would defeat the work bound on extreme
    // displays. Keep a central candidate window, larger than the result budget.
    const candidateBudget = MAX_VISIBLE_TILES * 4;
    if (columns * rows > candidateBudget) {
      let keepColumns = Math.min(
        columns,
        Math.ceil(Math.sqrt(candidateBudget)),
      );
      const keepRows = Math.min(
        rows,
        Math.floor(candidateBudget / keepColumns),
      );
      keepColumns = Math.min(columns, Math.floor(candidateBudget / keepRows));
      const centerColumn =
        (((box.x / 2 - view.x) / view.scale) * scale) / TILE_STEP;
      const centerRow =
        (((box.y / 2 - view.y) / view.scale - top) * scale) / TILE_STEP;
      startColumn = Math.max(
        startColumn,
        Math.min(
          endColumn - keepColumns + 1,
          Math.floor(centerColumn - keepColumns / 2),
        ),
      );
      startRow = Math.max(
        startRow,
        Math.min(endRow - keepRows + 1, Math.floor(centerRow - keepRows / 2)),
      );
      endColumn = startColumn + keepColumns - 1;
      endRow = startRow + keepRows - 1;
    }
    for (let row = startRow; row <= endRow; row++) {
      for (let column = startColumn; column <= endColumn; column++) {
        const x = Math.max(0, column * TILE_STEP - 2);
        const y = Math.max(0, row * TILE_STEP - 2);
        const tile: Tile = {
          page,
          scale,
          x,
          y,
          width: Math.min(width, (column + 1) * TILE_STEP + 2) - x,
          height: Math.min(height, (row + 1) * TILE_STEP + 2) - y,
          key: "",
        };
        tile.key = `${page}:${scale}:${x}:${y}:${tile.width}:${tile.height}`;
        const centerX = ((x + tile.width / 2) / scale) * view.scale + view.x;
        const centerY =
          ((y + tile.height / 2) / scale + top) * view.scale + view.y;
        candidates.push({
          tile,
          distance: (centerX - box.x / 2) ** 2 + (centerY - box.y / 2) ** 2,
        });
      }
    }
  }
  return candidates
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_VISIBLE_TILES)
    .map(({ tile }) => tile);
}

/** Byte-bounded LRU; live canvas backings are a separate, viewport-limited cost. */
export class RasterCache<T extends { data: { byteLength: number } }> {
  private entries = new Map<string, T>();
  private used = 0;
  constructor(private readonly maxBytes = RASTER_CACHE_BYTES) {
    if (!Number.isFinite(maxBytes) || maxBytes < 0)
      throw new Error("Invalid raster cache budget");
  }
  get size() {
    return this.entries.size;
  }
  get bytes() {
    return this.used;
  }
  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }
  set(key: string, value: T) {
    const size = value.data.byteLength;
    // An uncacheable raster must not flush useful existing entries.
    if (size <= 0 || !Number.isFinite(size) || size > this.maxBytes) return;
    const previous = this.entries.get(key);
    if (previous) {
      this.used -= previous.data.byteLength;
      this.entries.delete(key);
    }
    while (this.used + size > this.maxBytes) {
      const oldest = this.entries.keys().next().value!;
      this.used -= this.entries.get(oldest)!.data.byteLength;
      this.entries.delete(oldest);
    }
    this.entries.set(key, value);
    this.used += size;
  }
  clear() {
    this.entries.clear();
    this.used = 0;
  }
}
