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
  const a = e.items.find((a) => a.page === page && a.id === e.selected);
  const d = e.draft?.page === page ? e.draft : null;
  const offset =
    d?.kind === "select"
      ? {
          x: d.points.at(-1)!.x - d.points[0].x,
          y: d.points.at(-1)!.y - d.points[0].y,
        }
      : { x: 0, y: 0 };
  const corners = a
    ? [
        [a.rect[0], a.rect[1]],
        [a.rect[2], a.rect[3]],
      ].map(([x, y]) => display({ x: x + offset.x, y: y + offset.y }))
    : [];
  return (
    <svg
      className="annotation-overlay"
      width={info.width}
      height={info.height}
      aria-hidden="true"
    >
      {a && (
        <rect
          x={Math.min(...corners.map((p) => p.x))}
          y={Math.min(...corners.map((p) => p.y))}
          width={Math.abs(corners[1].x - corners[0].x)}
          height={Math.abs(corners[1].y - corners[0].y)}
          fill="none"
          stroke="#138579"
          strokeWidth={1.5 / scale}
          strokeDasharray={`${5 / scale} ${3 / scale}`}
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
