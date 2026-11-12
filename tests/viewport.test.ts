import { describe, it, expect } from "vitest";
import {
  zoomAt,
  toWorld,
  toScreen,
  transform,
  inverse,
  fit,
  wheelPixels,
  type Matrix,
} from "../src/core/viewport";
describe("viewport geometry", () => {
  it("keeps the pointer anchored through repeated zoom and clamps", () => {
    let v = { x: -20, y: 70, scale: 1.2 };
    const p = { x: 187, y: 230 },
      world = toWorld(p, v);
    for (const f of [1.2, 1.2, 0.8, 1000, 0.001, 1.1]) {
      v = zoomAt(v, p, f);
      expect(toScreen(world, v).x).toBeCloseTo(p.x, 9);
      expect(toScreen(world, v).y).toBeCloseTo(p.y, 9);
    }
  });
  it.each<Matrix>([
    [1, 0, 0, -1, -20, 430],
    [0, 1, 1, 0, -30, -20],
    [-1, 0, 0, 1, 520, -30],
    [0, -1, -1, 0, 430, 520],
  ])("round-trips cropped and rotated PDF coordinates (%j)", (...m) => {
    const p = { x: 123, y: 234 };
    const result = transform(transform(p, m), inverse(m));
    expect(result.x).toBeCloseTo(p.x);
    expect(result.y).toBeCloseTo(p.y);
  });
  it("maps the independent 90-degree CropBox corners", () => {
    const m: Matrix = [0, 1, 1, 0, -30, -20];
    expect(transform({ x: 20, y: 30 }, m)).toEqual({ x: 0, y: 0 });
    expect(transform({ x: 520, y: 430 }, m)).toEqual({ x: 400, y: 500 });
  });
  it("fits A0 and respects width mode", () => {
    const v = fit(2384, 3370, { x: 1000, y: 800 });
    expect(3370 * v.scale).toBeLessThanOrEqual(752);
    expect(fit(300, 400, { x: 1000, y: 800 }, true).scale).toBeCloseTo(
      952 / 300,
    );
  });
  it("normalizes line and page wheel deltas", () => {
    expect(wheelPixels(2, 1, 800)).toBe(32);
    expect(wheelPixels(1, 2, 800)).toBe(800);
  });
});
