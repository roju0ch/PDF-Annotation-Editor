import type { Page } from "@playwright/test";

/** Inspect native PDF raster layers, excluding transient SVG selection/draft UI. */
export async function compositedRaster(
  page: Page,
  index: number,
  query: {
    points?: { x: number; y: number }[];
    space?: "page" | "screen" | "fraction";
    region?: [number, number, number, number];
  },
) {
  return page.getByTestId(`page-${index}`).evaluate((sheet, query) => {
    const base = sheet.querySelector<HTMLCanvasElement>(
      'canvas[aria-label^="PDF-Seite"]',
    )!;
    const rect = sheet.getBoundingClientRect();
    const canvas = document.createElement("canvas");
    canvas.width = base.width;
    canvas.height = base.height;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    // DOM order is the PDF scene order: overview/annotation, then each detail
    // surface and its native annotation composite. SVG editor UI is separate.
    for (const source of sheet.querySelectorAll<HTMLCanvasElement>("canvas")) {
      const style = getComputedStyle(source),
        bounds = source.getBoundingClientRect();
      if (
        !source.width ||
        !source.height ||
        source.dataset.rendered !== "true" ||
        style.display === "none" ||
        style.visibility === "hidden"
      )
        continue;
      context.drawImage(
        source,
        ((bounds.left - rect.left) * canvas.width) / rect.width,
        ((bounds.top - rect.top) * canvas.height) / rect.height,
        (bounds.width * canvas.width) / rect.width,
        (bounds.height * canvas.height) / rect.height,
      );
    }
    const width = parseFloat((sheet as HTMLElement).style.width);
    const height = parseFloat((sheet as HTMLElement).style.height);
    const colors = (query.points || []).map((point) => {
      const x =
        query.space === "screen"
          ? (point.x - rect.left) / rect.width
          : query.space === "fraction"
            ? point.x
            : point.x / width;
      const y =
        query.space === "screen"
          ? (point.y - rect.top) / rect.height
          : query.space === "fraction"
            ? point.y
            : point.y / height;
      return Array.from(
        context.getImageData(
          Math.max(0, Math.min(canvas.width - 1, Math.floor(x * canvas.width))),
          Math.max(
            0,
            Math.min(canvas.height - 1, Math.floor(y * canvas.height)),
          ),
          1,
          1,
        ).data,
      );
    });
    let red = 0,
      clear = 0,
      total = 0;
    if (query.region) {
      const [x, y, w, h] = query.region;
      const pixelsWide = Math.max(1, Math.floor((w * canvas.width) / width));
      const pixelsHigh = Math.max(1, Math.floor((h * canvas.height) / height));
      const pixels = context.getImageData(
        Math.floor((x * canvas.width) / width),
        Math.floor((y * canvas.height) / height),
        pixelsWide,
        pixelsHigh,
      ).data;
      total = pixelsWide * pixelsHigh;
      for (let i = 0; i < pixels.length; i += 4) {
        if (
          pixels[i] > pixels[i + 1] * 1.6 &&
          pixels[i] > 80 &&
          pixels[i + 3] > 128
        )
          red++;
        if (
          pixels[i + 3] < 20 ||
          (pixels[i] > 230 && pixels[i + 1] > 230 && pixels[i + 2] > 230)
        )
          clear++;
      }
    }
    return { colors, red, clear, total };
  }, query);
}
