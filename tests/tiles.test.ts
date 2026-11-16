import { describe, expect, it } from "vitest";
import {
  MAX_VISIBLE_TILES,
  MAX_LIVE_RASTER_PIXELS,
  RasterCache,
  TILE_SIZE,
  rasterScale,
  visibleTilePlan,
} from "../src/core/render/tiles";

const large = [{ width: 10000, height: 7000 }];
const box = { x: 390, y: 720 };

describe("viewport tile plan", () => {
  it("increases detail at large-plan zoom without allocating a whole-page raster", () => {
    for (const zoom of [0.1, 1, 4, 12]) {
      const tiles = visibleTilePlan(
        large,
        [0],
        [0],
        { x: -20, y: -30, scale: zoom },
        box,
        3,
      );
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles.length).toBeLessThan(16);
      expect(
        tiles.reduce((pixels, tile) => pixels + tile.width * tile.height, 0),
      ).toBeLessThan(20_000_000);
      for (const tile of tiles) {
        expect(tile.scale).toBeGreaterThanOrEqual(zoom * 3);
        expect(tile.width).toBeLessThanOrEqual(TILE_SIZE);
        expect(tile.height).toBeLessThanOrEqual(TILE_SIZE);
        expect(tile.width * tile.height * 4).toBeLessThanOrEqual(
          4 * 1024 * 1024,
        );
      }
    }
    expect(rasterScale(12, 3)).toBeGreaterThan(rasterScale(1, 3));
  });

  it("covers every visible pixel on a 4K viewport at DPR2", () => {
    const view = { x: -23000, y: -5000, scale: 4 };
    const screen = { x: 3840, y: 2160 };
    const tiles = visibleTilePlan(large, [0], [0], view, screen, 2);
    expect(tiles.length).toBeLessThanOrEqual(MAX_VISIBLE_TILES);
    for (let y = 0; y < screen.y; y += 127)
      for (let x = 0; x < screen.x; x += 127) {
        const px = ((x - view.x) / view.scale) * tiles[0].scale;
        const py = ((y - view.y) / view.scale) * tiles[0].scale;
        expect(
          tiles.some(
            (t) =>
              px >= t.x &&
              px < t.x + t.width &&
              py >= t.y &&
              py < t.y + t.height,
          ),
        ).toBe(true);
      }
  });

  it("caps live canvas pixels as well as the LRU on large HiDPI displays", () => {
    const view = { x: -23000, y: -5000, scale: 4 };
    const tiles = visibleTilePlan(
      large,
      [0],
      [0],
      view,
      { x: 3840, y: 2160 },
      4,
    );
    expect(
      tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0),
    ).toBeLessThanOrEqual(MAX_LIVE_RASTER_PIXELS);
    expect(tiles[0].scale).toBeLessThan(16);
    expect(tiles[0].scale).toBeGreaterThanOrEqual(view.scale);
    for (const [x, y] of [
      [0, 0],
      [3839, 0],
      [0, 2159],
      [3839, 2159],
    ]) {
      const px = ((x - view.x) / view.scale) * tiles[0].scale;
      const py = ((y - view.y) / view.scale) * tiles[0].scale;
      expect(
        tiles.some(
          (tile) =>
            px >= tile.x &&
            px < tile.x + tile.width &&
            py >= tile.y &&
            py < tile.y + tile.height,
        ),
      ).toBe(true);
    }
  });

  it("does not request extra neighboring tiles outside the viewport", () => {
    const tiles = visibleTilePlan(
      large,
      [0],
      [0],
      { x: 0, y: 0, scale: 1 },
      { x: 100, y: 100 },
      1,
    );
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 1022,
      height: 1022,
    });
  });

  it("overlaps adjacent rasters to avoid compositor seams without exceeding the buffer budget", () => {
    const tiles = visibleTilePlan(
      large,
      [0],
      [0],
      { x: 0, y: 0, scale: 1 },
      { x: 2200, y: 2200 },
      1,
    );
    const row = tiles.filter((t) => t.y === 0).sort((a, b) => a.x - b.x);
    expect(row).toHaveLength(3);
    expect(row[0].x).toBe(0);
    for (let i = 1; i < row.length; i++) {
      expect(row[i - 1].x + row[i - 1].width - row[i].x).toBe(4);
      expect(row[i].width).toBeLessThanOrEqual(1024);
    }
    const column = tiles.filter((t) => t.x === 0).sort((a, b) => a.y - b.y);
    for (let i = 1; i < column.length; i++)
      expect(column[i - 1].y + column[i - 1].height - column[i].y).toBe(4);
  });

  it("requests newly exposed regions after pan and reuses fixed grid keys in overlap", () => {
    const view = { x: -1500, y: -1000, scale: 2 };
    const before = visibleTilePlan(large, [0], [0], view, box, 2);
    const after = visibleTilePlan(
      large,
      [0],
      [0],
      { ...view, x: view.x - 300 },
      box,
      2,
    );
    const old = new Set(before.map((t) => t.key));
    expect(after.some((t) => old.has(t.key))).toBe(true);
    expect(after.some((t) => !old.has(t.key))).toBe(true);
  });

  it("clips page edges, skips offscreen pages and honors continuous-page offsets", () => {
    const height = TILE_SIZE + 76.1;
    const secondTop = height + 24;
    const pages = [
      { width: TILE_SIZE + 3.2, height },
      { width: 300, height: 400 },
    ];
    const tiles = visibleTilePlan(
      pages,
      [0, secondTop],
      [0, 1, 1],
      { x: -(TILE_SIZE - 32), y: -(height - 50), scale: 1 },
      { x: 300, y: 300 },
      1,
    );
    expect(tiles.some((t) => t.page === 0)).toBe(true);
    expect(tiles.some((t) => t.page === 1)).toBe(false); // Page 2 is horizontally offscreen.
    const edge = tiles.find((t) => t.x === 1018)!;
    expect(edge.width).toBe(10);
    expect(edge.y + edge.height).toBeLessThanOrEqual(Math.ceil(height));
    expect(new Set(tiles.map((t) => t.key)).size).toBe(tiles.length);
    const second = visibleTilePlan(
      pages,
      [0, secondTop],
      [0, 1],
      { x: 0, y: -secondTop, scale: 1 },
      { x: 300, y: 200 },
      1,
    );
    expect(second.every((t) => t.page === 1)).toBe(true);
    expect(second.some((t) => t.y === 0)).toBe(true);
    expect(
      visibleTilePlan(
        pages,
        [0, secondTop],
        [0],
        { x: 900, y: 900, scale: 1 },
        box,
        1,
      ),
    ).toEqual([]);
  });

  it("rejects invalid viewports and bounds work even for extreme viewport sizes", () => {
    expect(
      visibleTilePlan(large, [0], [0], { x: 0, y: 0, scale: 0 }, box, 3),
    ).toEqual([]);
    expect(
      visibleTilePlan(large, [0], [0], { x: NaN, y: 0, scale: 1 }, box, 3),
    ).toEqual([]);
    expect(
      visibleTilePlan(
        large,
        [0],
        [0],
        { x: 0, y: 0, scale: 1 },
        { x: 0, y: 720 },
        3,
      ),
    ).toEqual([]);
    const huge = visibleTilePlan(
      large,
      [0],
      [0],
      { x: 0, y: 0, scale: 1 },
      { x: 20000, y: 20000 },
      4,
    );
    expect(huge.length).toBeLessThanOrEqual(MAX_VISIBLE_TILES);
    expect(
      huge.reduce((sum, tile) => sum + tile.width * tile.height, 0),
    ).toBeLessThanOrEqual(MAX_LIVE_RASTER_PIXELS);
    // This view intersects millions of possible page cells; planning itself
    // must stay bounded before retaining the nearest 256 tiles.
    const extreme = visibleTilePlan(
      [{ width: 20000, height: 20000 }],
      [0],
      [0],
      { x: 0, y: 0, scale: 12 },
      { x: 1e9, y: 1e9 },
      4,
    );
    expect(extreme.length).toBeLessThanOrEqual(MAX_VISIBLE_TILES);
    expect(
      extreme.reduce((sum, tile) => sum + tile.width * tile.height, 0),
    ).toBeLessThanOrEqual(MAX_LIVE_RASTER_PIXELS);
    expect(
      extreme.every(
        (tile) =>
          tile.x + tile.width <= Math.ceil(20000 * tile.scale) &&
          tile.y + tile.height <= Math.ceil(20000 * tile.scale),
      ),
    ).toBe(true);
    expect(rasterScale(1, Infinity)).toBe(1);
  });
});

describe("raster cache byte budget", () => {
  const image = (bytes: number) => ({ data: new Uint8Array(bytes) });
  it("evicts by actual bytes and touches entries on cache hits", () => {
    const cache = new RasterCache(12);
    const a = image(4),
      b = image(4),
      c = image(8);
    cache.set("a", a);
    cache.set("b", b);
    expect(cache.get("a")).toBe(a);
    cache.set("c", c);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(a);
    expect(cache.get("c")).toBe(c);
    expect(cache.bytes).toBe(12);
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.bytes).toBe(0);
    expect(cache.size).toBe(0);
  });
  it("accounts for replacements and ignores oversized rasters without flushing the cache", () => {
    const cache = new RasterCache(12);
    cache.set("a", image(8));
    cache.set("b", image(4));
    cache.set("a", image(4));
    expect(cache.bytes).toBe(8);
    cache.set("oversized", image(13));
    expect(cache.size).toBe(2);
    expect(cache.bytes).toBe(8);
    expect(cache.get("oversized")).toBeUndefined();
    const disabled = new RasterCache(0);
    disabled.set("a", image(4));
    expect(disabled.bytes).toBe(0);
    expect(disabled.size).toBe(0);
  });
});
