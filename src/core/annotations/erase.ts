import type { Point } from "../viewport";
/** Cut each polyline segment against a circular eraser; retain exact intersections. */
export function eraseInk(
  paths: Point[][],
  center: Point,
  radius: number,
): Point[][] {
  if (!Number.isFinite(radius) || radius <= 0)
    throw new Error("Ungültiger Radierer-Radius.");
  const result: Point[][] = [];
  for (const path of paths) {
    let current: Point[] = [];
    const flush = () => {
      if (current.length >= 2) result.push(current);
      current = [];
    };
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1],
        b = path[i],
        dx = b.x - a.x,
        dy = b.y - a.y,
        ox = a.x - center.x,
        oy = a.y - center.y;
      const aa = dx * dx + dy * dy;
      if (aa < 1e-16) continue;
      const bb = 2 * (ox * dx + oy * dy),
        cc = ox * ox + oy * oy - radius * radius,
        disc = bb * bb - 4 * aa * cc;
      const cuts = [0, 1];
      if (disc > 0) {
        for (const t of [
          (-bb - Math.sqrt(disc)) / (2 * aa),
          (-bb + Math.sqrt(disc)) / (2 * aa),
        ])
          if (t > 0 && t < 1) cuts.push(t);
      }
      cuts.sort((x, y) => x - y);
      const at = (t: number) => ({ x: a.x + t * dx, y: a.y + t * dy });
      for (let k = 1; k < cuts.length; k++) {
        const mid = at((cuts[k - 1] + cuts[k]) / 2);
        if (
          (mid.x - center.x) ** 2 + (mid.y - center.y) ** 2 <
          radius * radius - 1e-10
        ) {
          flush();
          continue;
        }
        const start = at(cuts[k - 1]),
          end = at(cuts[k]);
        const last = current.at(-1);
        if (last && Math.hypot(last.x - start.x, last.y - start.y) > 1e-7)
          flush();
        if (!current.length) current.push(start);
        current.push(end);
      }
    }
    flush();
  }
  return result;
}
