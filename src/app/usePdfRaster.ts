import { useEffect, useRef, type RefObject } from "react";
import type { PdfClient } from "../adapters/pdf/client";
import type { PageInfo, Payload, Reply } from "../adapters/pdf/types";
import { RasterCache, type Tile } from "../core/render/tiles";
import {
  paintOpaque,
  releaseCanvas,
  releaseSurface,
  replaceSurfaceOverlay,
  type RasterSurface,
  type SurfaceMap,
} from "./rasterSurfaces";

const RENDER_DELAY = 100;

/** One outstanding raster request; superseded views never build a worker queue. */
export function usePdfRaster({
  client,
  canvases,
  layers,
  overviewLayers,
  surfaces,
  onSurfaceChange,
  pages,
  tiles,
  visible,
  eagerOverview,
  revision,
  onRendering,
  onError,
}: {
  client: RefObject<PdfClient | null>;
  canvases: RefObject<Map<number, HTMLCanvasElement>>;
  layers: RefObject<Map<number, HTMLDivElement>>;
  overviewLayers: RefObject<Map<number, HTMLDivElement>>;
  surfaces: RefObject<SurfaceMap>;
  onSurfaceChange: () => void;
  pages: PageInfo[];
  tiles: Tile[];
  visible: number[];
  eagerOverview: boolean;
  revision: number;
  onRendering: (value: boolean) => void;
  onError: (message: string) => void;
}) {
  const cache = useRef(new RasterCache<ImageData>());
  const details = useRef(new Map<string, RasterSurface>());
  const owner = useRef<PdfClient | null>(null);
  const version = useRef(-1);
  const previews = useRef(new WeakMap<HTMLCanvasElement, string>());
  const running = useRef<Promise<unknown>>(Promise.resolve());
  const spec = JSON.stringify({ tiles, visible });
  useEffect(() => {
    let cancelled = false;
    const c = client.current;
    const stale = () => cancelled || client.current !== c;
    if (owner.current !== c || version.current !== revision) {
      cache.current.clear();
      previews.current = new WeakMap();
      for (const surface of surfaces.current.values()) releaseSurface(surface);
      surfaces.current.clear();
      details.current.clear();
      onSurfaceChange();
      owner.current = c;
      version.current = revision;
    }
    const plan = JSON.parse(spec) as { tiles: Tile[]; visible: number[] };
    const keys = new Set(plan.tiles.map((tile) => tile.key));
    for (const layer of layers.current.values())
      layer.dataset.rendering = plan.tiles.length ? "true" : "false";
    // Retain nearby old-resolution details during zoom, with a 16 MiB budget.
    // Their CSS transform responds immediately while fresh details arrive.
    const bounds = new Map<
      number,
      { left: number; top: number; right: number; bottom: number }
    >();
    for (const tile of plan.tiles) {
      const next = {
        left: tile.x / tile.scale,
        top: tile.y / tile.scale,
        right: (tile.x + tile.width) / tile.scale,
        bottom: (tile.y + tile.height) / tile.scale,
      };
      const b = bounds.get(tile.page);
      bounds.set(
        tile.page,
        b
          ? {
              left: Math.min(b.left, next.left),
              top: Math.min(b.top, next.top),
              right: Math.max(b.right, next.right),
              bottom: Math.max(b.bottom, next.bottom),
            }
          : next,
      );
    }
    let oldBytes = 0;
    for (const [key, item] of details.current) {
      const b = bounds.get(item.page);
      const old = !keys.has(key);
      const outside =
        !b ||
        item.x / item.scale >= b.right ||
        (item.x + item.width) / item.scale <= b.left ||
        item.y / item.scale >= b.bottom ||
        (item.y + item.height) / item.scale <= b.top;
      if (
        !item.canvas.isConnected ||
        outside ||
        (old && (oldBytes += item.width * item.height * 4) > 16 * 1024 * 1024)
      ) {
        releaseSurface(item);
        details.current.delete(key);
        surfaces.current.delete(item.key);
        onSurfaceChange();
      }
    }
    for (const [key, surface] of surfaces.current) {
      if (surface.overview && !surface.canvas.isConnected) {
        releaseSurface(surface);
        surfaces.current.delete(key);
        onSurfaceChange();
      }
    }
    onRendering(false);
    const request = async (payload: Payload): Promise<Reply | undefined> => {
      const prior = running.current;
      const task = (async () => {
        await prior.catch(() => {});
        if (stale() || !c) return;
        return c.request(payload);
      })();
      running.current = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    };
    const raster = async (key: string, payload: Payload) => {
      const cached = cache.current.get(key);
      if (cached)
        return {
          image: cached,
          nativeRevision: -1,
          overlay: undefined,
          overlayBox: undefined,
        };
      const result = await request(payload);
      if (!result || stale()) return;
      const image = new ImageData(
        result.pixels!,
        result.width!,
        result.height!,
      );
      cache.current.set(key, image);
      return {
        image,
        nativeRevision: result.rasterRevision ?? -1,
        overlay: result.overlayPixels
          ? new ImageData(
              result.overlayPixels,
              result.overlayBox?.width ?? result.width!,
              result.overlayBox?.height ?? result.height!,
            )
          : undefined,
        overlayBox: result.overlayBox,
      };
    };
    // During inertia, pages can enter and leave between stable tile plans.
    // Start their bounded previews promptly and still debounce detail tiles.
    let enableDetails: (() => void) | undefined;
    const detailDelay = eagerOverview
      ? new Promise<void>((resolve) => {
          enableDetails = resolve;
        })
      : null;
    const detailTimer = eagerOverview
      ? setTimeout(() => enableDetails?.(), RENDER_DELAY)
      : undefined;
    const delay = eagerOverview ? 0 : RENDER_DELAY;
    const timer = setTimeout(() => {
      void (async () => {
        if (!c || stale()) return;
        if (!eagerOverview) onRendering(true);
        try {
          // A small whole-page overview is the fallback, never the zoom detail.
          for (const page of plan.visible) {
            if (stale()) return;
            const canvas = canvases.current.get(page),
              info = pages[page];
            if (!canvas || !info) continue;
            const scale = Math.min(
              2,
              Math.sqrt(1_000_000 / (info.width * info.height)),
              2048 / Math.max(info.width, info.height),
            );
            const key = `overview:${revision}:${page}:${scale}`;
            if (previews.current.get(canvas) === key) continue;
            if (eagerOverview) onRendering(true);
            delete canvas.dataset.rendered;
            const result = await raster(key, {
              type: "render",
              page,
              scale,
              split: true,
            });
            if (!result || stale()) return;
            const host = overviewLayers.current.get(page);
            if (!host) continue;
            if (
              !(await paintOpaque(canvas, result.image, stale, true)) ||
              stale()
            )
              return;
            const surface: RasterSurface = {
              key,
              page,
              info,
              owner: c,
              contentRevision: revision,
              scale,
              x: 0,
              y: 0,
              width: result.image.width,
              height: result.image.height,
              cssLeft: 0,
              cssTop: 0,
              cssWidth: info.width,
              cssHeight: info.height,
              canvas,
              host,
              overview: true,
              overlay: null,
              nativeRevision: -1,
            };
            const previous = surfaces.current.get(key);
            if (previous?.overlay) releaseCanvas(previous.overlay);
            if (
              !(await replaceSurfaceOverlay(
                surface,
                result.overlay,
                result.overlayBox ?? surface,
                result.nativeRevision,
                stale,
              )) ||
              stale()
            )
              return;
            surfaces.current.set(key, surface);
            canvas.dataset.rendered = "true";
            previews.current.set(canvas, key);
            onSurfaceChange();
          }
          if (detailDelay) {
            await detailDelay;
            if (stale()) return;
            onRendering(true);
          }
          for (const tile of plan.tiles) {
            if (stale()) return;
            const existing = details.current.get(tile.key);
            if (existing?.canvas.isConnected) {
              existing.canvas.parentElement?.appendChild(existing.canvas);
              if (existing.overlay) existing.canvas.after(existing.overlay);
              continue;
            }
            const result = await raster(`tile:${tile.key}`, {
              type: "render-tile",
              ...tile,
              split: true,
            });
            if (!result || stale()) return;
            const image = result.image;
            const layer = layers.current.get(tile.page);
            if (!layer) continue;
            const canvas = document.createElement("canvas");
            canvas.className = "raster-tile";
            canvas.setAttribute("aria-hidden", "true");
            canvas.width = image.width;
            canvas.height = image.height;
            Object.assign(canvas.style, {
              left: `${tile.x / tile.scale}px`,
              top: `${tile.y / tile.scale}px`,
              width: `${tile.width / tile.scale}px`,
              height: `${tile.height / tile.scale}px`,
            });
            Object.assign(canvas.dataset, {
              page: String(tile.page),
              scale: String(tile.scale),
              x: String(tile.x),
              y: String(tile.y),
            });
            if (!(await paintOpaque(canvas, image, stale, true)) || stale()) {
              releaseCanvas(canvas);
              return;
            }
            const surface: RasterSurface = {
              ...tile,
              info: pages[tile.page],
              owner: c,
              contentRevision: revision,
              cssLeft: tile.x / tile.scale,
              cssTop: tile.y / tile.scale,
              cssWidth: tile.width / tile.scale,
              cssHeight: tile.height / tile.scale,
              canvas,
              host: layer,
              overview: false,
              overlay: null,
              nativeRevision: -1,
            };
            if (
              !(await replaceSurfaceOverlay(
                surface,
                result.overlay,
                result.overlayBox ?? surface,
                result.nativeRevision,
                stale,
              )) ||
              stale()
            ) {
              releaseSurface(surface);
              return;
            }
            // Expose the clean tile and its initial native appearance together.
            const pair = document.createDocumentFragment();
            pair.appendChild(canvas);
            if (surface.overlay) pair.appendChild(surface.overlay);
            layer.appendChild(pair);
            canvas.dataset.rendered = "true";
            details.current.set(tile.key, surface);
            surfaces.current.set(surface.key, surface);
            onSurfaceChange();
          }
          if (!stale())
            for (const [key, item] of details.current) {
              if (!keys.has(key)) {
                releaseSurface(item);
                details.current.delete(key);
                surfaces.current.delete(item.key);
                onSurfaceChange();
              }
            }
        } catch (error) {
          if (!stale())
            onError(
              error instanceof Error
                ? error.message
                : "Darstellung fehlgeschlagen.",
            );
        } finally {
          if (!stale()) {
            for (const layer of layers.current.values())
              layer.dataset.rendering = "false";
            onRendering(false);
          }
        }
      })();
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(detailTimer);
      enableDetails?.();
    };
  }, [
    spec,
    pages,
    revision,
    eagerOverview,
    client,
    canvases,
    layers,
    overviewLayers,
    surfaces,
    onSurfaceChange,
    onRendering,
    onError,
  ]);
  useEffect(
    () => () => {
      cache.current.clear();
      for (const surface of surfaces.current.values()) releaseSurface(surface);
      surfaces.current.clear();
      details.current.clear();
    },
    [surfaces],
  );
}
