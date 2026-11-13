import type { Point } from "../viewport";
import type { Annotation, PdfRect } from "./model";

export function selectionRect(a: Point, b: Point): PdfRect {
  return [
    Math.min(a.x, b.x),
    Math.min(a.y, b.y),
    Math.max(a.x, b.x),
    Math.max(a.y, b.y),
  ];
}
function overlaps(a: PdfRect, b: PdfRect) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
function pointDistance(p: Point, r: PdfRect) {
  return Math.hypot(
    Math.max(r[0] - p.x, 0, p.x - r[2]),
    Math.max(r[1] - p.y, 0, p.y - r[3]),
  );
}
function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t =
    dx || dy
      ? Math.max(
          0,
          Math.min(
            1,
            ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy),
          ),
        )
      : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function segmentTouches(a: Point, b: Point, r: PdfRect, radius: number) {
  // Slab intersection includes exact edge/corner contact, in either drag direction.
  let enter = 0,
    leave = 1;
  for (const [start, end, min, max] of [
    [a.x, b.x, r[0], r[2]],
    [a.y, b.y, r[1], r[3]],
  ]) {
    const delta = end - start;
    if (delta === 0) {
      if (start < min || start > max) {
        enter = 2;
        break;
      }
    } else {
      const t0 = (min - start) / delta,
        t1 = (max - start) / delta;
      enter = Math.max(enter, Math.min(t0, t1));
      leave = Math.min(leave, Math.max(t0, t1));
    }
  }
  if (enter <= leave) return true;
  // Distance to the rectangle accounts for round stroke caps and thick lines,
  // without falsely selecting the empty corners of an expanded bounding box.
  return (
    Math.min(
      pointDistance(a, r),
      pointDistance(b, r),
      ...[
        [r[0], r[1]],
        [r[0], r[3]],
        [r[2], r[1]],
        [r[2], r[3]],
      ].map(([x, y]) => segmentDistance({ x, y }, a, b)),
    ) <= radius
  );
}
export function touchesAnnotation(a: Annotation, rect: PdfRect): boolean {
  if (a.type !== "Ink" || !a.ink) return overlaps(a.rect, rect);
  return a.ink.some((path) =>
    path.some((p, i) =>
      segmentTouches(path[Math.max(0, i - 1)], p, rect, a.width / 2),
    ),
  );
}
export function intersectingAnnotations(
  items: Annotation[],
  page: number,
  rect: PdfRect,
) {
  return items
    .filter((a) => a.page === page && a.editable && touchesAnnotation(a, rect))
    .map((a) => a.id);
}
