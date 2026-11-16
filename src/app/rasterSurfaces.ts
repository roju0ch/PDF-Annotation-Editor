import type { PdfClient } from "../adapters/pdf/client";
import type { PageInfo } from "../adapters/pdf/types";

/** Clean page contents and their separately replaceable native annotation patch. */
export type RasterSurface = {
  key: string;
  page: number;
  info: PageInfo;
  owner: PdfClient;
  contentRevision: number;
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
  cssLeft: number;
  cssTop: number;
  cssWidth: number;
  cssHeight: number;
  canvas: HTMLCanvasElement;
  host: HTMLDivElement;
  overview: boolean;
  overlay: HTMLCanvasElement | null;
  nativeRevision: number;
};
export type SurfaceMap = Map<string, RasterSurface>;

export function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.remove();
  canvas.width = canvas.height = 0;
}
export function clearSurfaceOverlay(surface: RasterSurface) {
  if (surface.overlay) releaseCanvas(surface.overlay);
  surface.overlay = null;
}
export function releaseSurface(surface: RasterSurface) {
  clearSurfaceOverlay(surface);
  if (surface.overview) {
    // React owns the overview element; only release its backing pixels.
    surface.canvas.width = surface.canvas.height = 0;
    delete surface.canvas.dataset.rendered;
  } else releaseCanvas(surface.canvas);
}

/** Decode before touching the destination, so annotations never flash blank. */
export async function paintOpaque(
  canvas: HTMLCanvasElement,
  image: ImageData,
  stale: () => boolean,
  readback = false,
) {
  const bitmap = await createImageBitmap(image);
  try {
    if (stale()) return false;
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: readback,
    })!;
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    return true;
  } finally {
    bitmap.close();
  }
}

/** Install an opaque, native composite over exactly its original clean backdrop. */
export async function replaceSurfaceOverlay(
  surface: RasterSurface,
  image: ImageData | undefined,
  box: { x: number; y: number; width: number; height: number },
  revision: number,
  stale: () => boolean,
) {
  if (!image) {
    if (stale()) return false;
    clearSurfaceOverlay(surface);
    surface.nativeRevision = revision;
    return true;
  }
  const canvas = document.createElement("canvas");
  canvas.className = "annotation-raster";
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "absolute",
    pointerEvents: "none",
    left: `${surface.cssLeft + ((box.x - surface.x) / surface.width) * surface.cssWidth}px`,
    top: `${surface.cssTop + ((box.y - surface.y) / surface.height) * surface.cssHeight}px`,
    width: `${(box.width / surface.width) * surface.cssWidth}px`,
    height: `${(box.height / surface.height) * surface.cssHeight}px`,
  });
  Object.assign(canvas.dataset, {
    page: String(surface.page),
    scale: String(surface.scale),
    x: String(box.x),
    y: String(box.y),
    nativeRevision: String(revision),
  });
  try {
    if (!(await paintOpaque(canvas, image, stale)) || stale()) {
      releaseCanvas(canvas);
      return false;
    }
    const previous = surface.overlay;
    if (surface.overview) surface.host.appendChild(canvas);
    else surface.canvas.after(canvas);
    canvas.dataset.rendered = "true";
    surface.overlay = canvas;
    surface.nativeRevision = revision;
    if (previous) releaseCanvas(previous);
    return true;
  } catch (error) {
    releaseCanvas(canvas);
    throw error;
  }
}
