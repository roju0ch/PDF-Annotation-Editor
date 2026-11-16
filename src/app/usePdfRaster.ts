import { useEffect, useRef, type RefObject } from "react";
import type { PdfClient } from "../adapters/pdf/client";
import type { PageInfo, Payload, Reply } from "../adapters/pdf/types";
import { RasterCache, type Tile } from "../core/render/tiles";

type Detail = Tile & { canvas: HTMLCanvasElement; revision: number };
const release = (canvas: HTMLCanvasElement) => {
  canvas.remove();
  canvas.width = canvas.height = 0;
};

/** One outstanding raster request; superseded views never build a worker queue. */
export function usePdfRaster({
  client,
  canvases,
  layers,
  pages,
  tiles,
  visible,
  revision,
  onRendering,
  onError,
}: {
  client: RefObject<PdfClient | null>;
  canvases: RefObject<Map<number, HTMLCanvasElement>>;
  layers: RefObject<Map<number, HTMLDivElement>>;
  pages: PageInfo[];
  tiles: Tile[];
  visible: number[];
  revision: number;
  onRendering: (value: boolean) => void;
  onError: (message: string) => void;
}) {
  const cache = useRef(new RasterCache<ImageData>());
  const details = useRef(new Map<string, Detail>());
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
      for (const item of details.current.values()) release(item.canvas);
      details.current.clear();
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
        release(item.canvas);
        details.current.delete(key);
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
      let image = cache.current.get(key);
      if (!image) {
        const result = await request(payload);
        if (!result || stale()) return;
        image = new ImageData(result.pixels!, result.width!, result.height!);
        cache.current.set(key, image);
      }
      return image;
    };
    const timer = setTimeout(() => {
      void (async () => {
        if (!c || stale()) return;
        onRendering(true);
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
            delete canvas.dataset.rendered;
            const image = await raster(key, { type: "render", page, scale });
            if (!image || stale()) return;
            canvas.width = image.width;
            canvas.height = image.height;
            canvas.getContext("2d")!.putImageData(image, 0, 0);
            canvas.dataset.rendered = "true";
            previews.current.set(canvas, key);
          }
          for (const tile of plan.tiles) {
            if (stale()) return;
            const existing = details.current.get(tile.key);
            if (existing?.canvas.isConnected) {
              existing.canvas.parentElement?.appendChild(existing.canvas);
              continue;
            }
            const image = await raster(`tile:${tile.key}`, {
              type: "render-tile",
              ...tile,
            });
            if (!image || stale()) return;
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
            // Opaque pixels prevent CSS background blending at fractional tile
            // edges; the overlap also keeps the compositor's filter inside data.
            const bitmap = await createImageBitmap(image);
            try {
              if (stale()) {
                release(canvas);
                return;
              }
              const context = canvas.getContext("2d", { alpha: false })!;
              context.fillStyle = "white";
              context.fillRect(0, 0, canvas.width, canvas.height);
              context.drawImage(bitmap, 0, 0);
            } finally {
              bitmap.close();
            }
            canvas.dataset.rendered = "true";
            layer.appendChild(canvas);
            details.current.set(tile.key, { ...tile, canvas, revision });
          }
          if (!stale())
            for (const [key, item] of details.current) {
              if (!keys.has(key)) {
                release(item.canvas);
                details.current.delete(key);
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
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [spec, pages, revision, client, canvases, layers, onRendering, onError]);
  useEffect(
    () => () => {
      cache.current.clear();
      for (const item of details.current.values()) release(item.canvas);
      details.current.clear();
    },
    [],
  );
}
