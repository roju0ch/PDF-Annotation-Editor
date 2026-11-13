export type Point = { x: number; y: number };
export type View = Point & { scale: number };
export type Matrix = [number, number, number, number, number, number];
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 12;
export const toScreen = (p: Point, v: View): Point => ({
  x: p.x * v.scale + v.x,
  y: p.y * v.scale + v.y,
});
export const toWorld = (p: Point, v: View): Point => ({
  x: (p.x - v.x) / v.scale,
  y: (p.y - v.y) / v.scale,
});
export function zoomAt(v: View, anchor: Point, factor: number): View {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
  const p = toWorld(anchor, v);
  return { scale, x: anchor.x - p.x * scale, y: anchor.y - p.y * scale };
}
export function transform(p: Point, m: Matrix): Point {
  return {
    x: p.x * m[0] + p.y * m[2] + m[4],
    y: p.x * m[1] + p.y * m[3] + m[5],
  };
}
export function inverse(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m,
    det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error("Singuläre Transformation");
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
}
export function fit(
  width: number,
  height: number,
  box: Point,
  onlyWidth = false,
): View {
  const scale = Math.max(
    MIN_SCALE,
    Math.min(
      MAX_SCALE,
      (box.x - 48) / width,
      onlyWidth ? MAX_SCALE : (box.y - 48) / height,
    ),
  );
  return {
    scale,
    x: (box.x - width * scale) / 2,
    y: onlyWidth ? 24 : (box.y - height * scale) / 2,
  };
}
export function wheelPixels(delta: number, mode: number, height: number) {
  return delta * (mode === 1 ? 16 : mode === 2 ? height : 1);
}
