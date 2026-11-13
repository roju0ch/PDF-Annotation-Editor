import {
  intersectingAnnotations,
  selectionRect,
} from "../core/annotations/selection";
import type { PdfRect } from "../core/annotations/model";
import { transform, type Point } from "../core/viewport";
import type { PageInfo } from "../adapters/pdf/types";
import type { AnnotationControls } from "./useAnnotations";
export function AnnotationOverlay({
  editor: e,
  info,
  page,
  scale,
}: {
  editor: AnnotationControls;
  info: PageInfo;
  page: number;
  scale: number;
}) {
  const display = (p: Point) => {
    const pt = transform(p, info.pdfToPage);
    return { x: pt.x - info.origin[0], y: pt.y - info.origin[1] };
  };
  const d = e.draft?.page === page ? e.draft : null;
  const offset =
    d?.kind === "select"
      ? {
          x: d.points.at(-1)!.x - d.points[0].x,
          y: d.points.at(-1)!.y - d.points[0].y,
        }
      : { x: 0, y: 0 };
  const box = (rect: PdfRect, offset = { x: 0, y: 0 }) => {
    const corners = [
      [rect[0], rect[1]],
      [rect[2], rect[1]],
      [rect[2], rect[3]],
      [rect[0], rect[3]],
    ].map(([x, y]) => display({ x: x + offset.x, y: y + offset.y }));
    return {
      x: Math.min(...corners.map((p) => p.x)),
      y: Math.min(...corners.map((p) => p.y)),
      width:
        Math.max(...corners.map((p) => p.x)) -
        Math.min(...corners.map((p) => p.x)),
      height:
        Math.max(...corners.map((p) => p.y)) -
        Math.min(...corners.map((p) => p.y)),
    };
  };
  const marquee =
    d?.kind === "marquee" ? selectionRect(d.points[0], d.points.at(-1)!) : null;
  const selected = marquee
    ? intersectingAnnotations(e.items, page, marquee)
    : e.selection;
  const selectedItems = e.items.filter(
    (a) => a.page === page && selected.includes(a.id),
  );
  return (
    <svg
      className="annotation-overlay"
      width={info.width}
      height={info.height}
      aria-hidden="true"
    >
      {selectedItems.map((a) => (
        <rect
          key={a.id}
          data-testid="selection-outline"
          data-annotation-id={a.id}
          {...box(
            a.rect,
            d?.kind === "select" && d.ids?.includes(a.id) ? offset : undefined,
          )}
          fill="#13857912"
          stroke="#138579"
          strokeWidth={1.5 / scale}
          strokeDasharray={`${5 / scale} ${3 / scale}`}
        />
      ))}
      {marquee && (
        <rect
          data-testid="selection-marquee"
          {...box(marquee)}
          fill="#13857920"
          stroke="#138579"
          strokeWidth={1 / scale}
        />
      )}
      {d?.kind === "Ink" && (
        <polyline
          points={d.points
            .map((p) => {
              const q = display(p);
              return `${q.x},${q.y}`;
            })
            .join(" ")}
          fill="none"
          stroke={e.color}
          strokeWidth={e.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {d?.kind === "erase" && (
        <circle
          cx={display(d.points.at(-1)!).x}
          cy={display(d.points.at(-1)!).y}
          r={e.radius}
          fill="#ffffff80"
          stroke="#d22f32"
          strokeWidth={1 / scale}
        />
      )}
    </svg>
  );
}
