import { useEffect, useRef, type RefObject } from "react";
import type { PdfClient } from "../adapters/pdf/client";
import type { Payload, Reply } from "../adapters/pdf/types";
import {
  clearSurfaceOverlay,
  replaceSurfaceOverlay,
  type RasterSurface,
  type SurfaceMap,
} from "./rasterSurfaces";

type Bounds = [number, number, number, number];
/** Union annotation appearances within a clean surface, including AA margins. */
function patchBox(surface: RasterSurface, bounds: Bounds[]) {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const rect of bounds) {
    if (rect.some(Number.isNaN)) continue;
    const x0 = Math.max(surface.x, Math.floor(rect[0] * surface.scale) - 3);
    const y0 = Math.max(surface.y, Math.floor(rect[1] * surface.scale) - 3);
    const x1 = Math.min(
      surface.x + surface.width,
      Math.ceil(rect[2] * surface.scale) + 3,
    );
    const y1 = Math.min(
      surface.y + surface.height,
      Math.ceil(rect[3] * surface.scale) + 3,
    );
    if (x1 <= x0 || y1 <= y0) continue;
    left = Math.min(left, x0);
    top = Math.min(top, y0);
    right = Math.max(right, x1);
    bottom = Math.max(bottom, y1);
  }
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}

/** Refresh native annotation appearances against cached pixels, never page content. */
export function useAnnotationRaster({
  client,
  surfaces,
  surfaceVersion,
  revision,
  onError,
  onRendered,
}: {
  client: RefObject<PdfClient | null>;
  surfaces: RefObject<SurfaceMap>;
  surfaceVersion: number;
  revision: number;
  onError: (message: string) => void;
  onRendered: (revision: number) => void;
}) {
  const running = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    let cancelled = false;
    const c = client.current;
    const stale = () => cancelled || client.current !== c;
    const current = (surface: RasterSurface) =>
      !stale() &&
      surface.owner === c &&
      surface.canvas.isConnected &&
      surfaces.current.get(surface.key) === surface;
    if (!c) return;
    const active = [...surfaces.current.values()].filter(current);
    const hosts = new Set(active.map((surface) => surface.host));
    const pending = active.filter(
      (surface) => surface.nativeRevision !== revision,
    );
    for (const host of hosts)
      host.dataset.annotationRendering = pending.length ? "true" : "false";
    const request = async (payload: Payload): Promise<Reply | undefined> => {
      const prior = running.current;
      const task = (async () => {
        await prior.catch(() => {});
        if (stale()) return;
        return c.request(payload);
      })();
      running.current = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    };
    void (async () => {
      let complete = false;
      try {
        if (pending.length) {
          const result = await request({
            type: "annotation-bounds",
            pages: [...new Set(pending.map((surface) => surface.page))],
            revision,
          });
          if (
            !result ||
            result.stale ||
            result.rasterRevision !== revision ||
            stale()
          )
            return;
          const bounds = new Map(
            result.annotationBounds!.map(({ page, bounds }) => [page, bounds]),
          );
          for (const surface of pending) {
            if (stale()) return;
            if (!current(surface) || surface.nativeRevision === revision)
              continue;
            const box = patchBox(surface, bounds.get(surface.page) ?? []);
            if (!box) {
              clearSurfaceOverlay(surface);
              surface.nativeRevision = revision;
              continue;
            }
            const background = surface.canvas
              .getContext("2d")!
              .getImageData(
                box.x - surface.x,
                box.y - surface.y,
                box.width,
                box.height,
              ).data;
            const patch = await request({
              type: "render-annotation-patch",
              page: surface.page,
              scale: surface.scale,
              ...box,
              background,
              revision,
            });
            if (
              !patch ||
              patch.stale ||
              patch.rasterRevision !== revision ||
              stale()
            )
              return;
            if (!current(surface)) continue;
            const image = new ImageData(
              patch.pixels!,
              patch.width!,
              patch.height!,
            );
            if (
              !(await replaceSurfaceOverlay(
                surface,
                image,
                box,
                revision,
                () => !current(surface),
              ))
            )
              return;
          }
        }
        complete =
          !stale() &&
          [...surfaces.current.values()]
            .filter(current)
            .every((surface) => surface.nativeRevision === revision);
      } catch (error) {
        if (!stale())
          onError(
            error instanceof Error
              ? error.message
              : "Annotationen konnten nicht dargestellt werden.",
          );
      } finally {
        if (!stale()) {
          for (const host of hosts) {
            host.dataset.annotationRendering = "false";
            if (complete) host.dataset.annotationRevision = String(revision);
          }
          // No raster notification during the moment before the first clean
          // surface exists; a pending stroke must stay visible until it does.
          if (complete && active.length) onRendered(revision);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, surfaces, surfaceVersion, revision, onError, onRendered]);
}
