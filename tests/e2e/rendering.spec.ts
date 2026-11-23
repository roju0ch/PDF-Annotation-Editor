import { zoomWithWheel } from "./viewerInput";
import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const WIDTH = 6000,
  HEIGHT = 4000;
const fixture = "artifacts/large-vector-plan.pdf";

test.beforeAll(async () => {
  // Independent synthetic PDF: no customer plans or screenshots in CI evidence.
  // One-point bars are below the old whole-page raster's resolution at every zoom.
  const bars = Array.from(
    { length: 700 },
    (_, i) => `${2300 + i * 2} 1600 1 800 re f`,
  ).join("\n");
  const content = `0 0 0 rg\n${bars}\nBT /F1 9 Tf 2950 2450 Td (Synthetic large plan - fine detail) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${WIDTH} ${HEIGHT}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await mkdir("artifacts", { recursive: true });
  await writeFile(fixture, pdf);
});

async function geometry(page: Page) {
  return page.getByTestId("world").evaluate((el) => {
    const transform = new DOMMatrix(getComputedStyle(el).transform);
    return { x: transform.e, y: transform.f, scale: transform.a };
  });
}

async function finishedTiles(
  page: Page,
  minScale: number,
  previousKeys: string[] = [],
) {
  await expect
    .poll(
      () =>
        page.locator(".detail-layer").evaluateAll(
          (layers, expected) => {
            const tiles = layers.flatMap((layer) => [
              ...layer.querySelectorAll<HTMLCanvasElement>(".raster-tile"),
            ]);
            const keys = tiles.map(
              (tile) =>
                `${tile.dataset.scale}:${tile.dataset.x}:${tile.dataset.y}`,
            );
            return (
              layers.length > 0 &&
              layers.every(
                (layer) => (layer as HTMLElement).dataset.rendering === "false",
              ) &&
              tiles.length > 0 &&
              tiles.every(
                (tile) =>
                  tile.dataset.rendered === "true" &&
                  Number(tile.dataset.scale) >= expected.minScale - 0.001,
              ) &&
              (!expected.previousKeys.length ||
                keys.some((key) => !expected.previousKeys.includes(key)))
            );
          },
          { minScale, previousKeys },
        ),
      { timeout: 20000 },
    )
    .toBe(true);
}

async function profile(page: Page) {
  return page.evaluate(
    ({ width, height }) => {
      const preview = document.querySelector<HTMLCanvasElement>(
        'canvas[aria-label="PDF-Seite 1"]',
      )!;
      const tiles = [
        ...document.querySelectorAll<HTMLCanvasElement>(
          '.raster-tile[data-rendered="true"]',
        ),
      ];
      const luminance = (canvas: HTMLCanvasElement, x: number, y: number) => {
        const p = canvas
          .getContext("2d")!
          .getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        return 255 + ((p[0] + p[1] + p[2] - 765) * p[3]) / 765;
      };
      const detail = (x: number, y: number): number | null => {
        for (const tile of tiles) {
          const scale = Number(tile.dataset.scale),
            px = x * scale - Number(tile.dataset.x),
            py = y * scale - Number(tile.dataset.y);
          if (px >= 0 && py >= 0 && px < tile.width && py < tile.height)
            return luminance(tile, px, py);
        }
        return null;
      };
      const pairs = Array.from({ length: 64 }, (_, i) => {
        const blackX = 2936.5 + i * 2,
          whiteX = blackX + 1,
          y = 2000.5;
        return {
          black: detail(blackX, y),
          white: detail(whiteX, y),
          previewContrast: Math.abs(
            luminance(
              preview,
              (blackX / width) * preview.width,
              (y / height) * preview.height,
            ) -
              luminance(
                preview,
                (whiteX / width) * preview.width,
                (y / height) * preview.height,
              ),
          ),
        };
      });
      return {
        pairs,
        previewScale: preview.width / width,
        pixels: tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0),
        maxSide: Math.max(
          ...tiles.flatMap((tile) => [tile.width, tile.height]),
        ),
        scales: tiles.map((tile) => Number(tile.dataset.scale)),
        keys: tiles.map(
          (tile) => `${tile.dataset.scale}:${tile.dataset.x}:${tile.dataset.y}`,
        ),
      };
    },
    { width: WIDTH, height: HEIGHT },
  );
}

test("large vector plan gains true detail at DPR3 zoom and refreshes only visible tiles after pan", async ({
  browser,
  baseURL,
  browserName,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
  });
  try {
    const page = await context.newPage();
    await page.goto(baseURL!);
    await page
      .getByLabel("PDF öffnen", { exact: true })
      .setInputFiles(resolve(fixture));
    await expect(page.getByLabel("PDF-Seite 1")).toHaveAttribute(
      "data-rendered",
      "true",
    );
    const stage = (await page.getByTestId("viewport").boundingBox())!;
    // CDP reports integer wheel client coordinates; avoid a half-pixel anchor.
    const anchor = {
      x: Math.floor(stage.x + stage.width / 2) - stage.x,
      y: Math.floor(stage.y + stage.height / 2) - stage.y,
    };
    const before = await geometry(page);
    const world = {
      x: (anchor.x - before.x) / before.scale,
      y: (anchor.y - before.y) / before.scale,
    };
    expect(Math.abs(world.x - WIDTH / 2)).toBeLessThan(1 / before.scale);
    expect(Math.abs(world.y - HEIGHT / 2)).toBeLessThan(1 / before.scale);
    await page.mouse.move(stage.x + anchor.x, stage.y + anchor.y);
    // Chromium CDP scales wheel deltas by deviceScaleFactor. Drive toward an
    // observed zoom level rather than assuming eight physical events are enough.
    for (let i = 0; i < 32 && (await geometry(page)).scale < 1.2; i++) {
      await zoomWithWheel(page, -600);
      await page.waitForTimeout(35);
    }
    const zoomed = await geometry(page);
    expect(zoomed.scale).toBeGreaterThan(before.scale * 20);
    expect(Math.abs(world.x * zoomed.scale + zoomed.x - anchor.x)).toBeLessThan(
      0.05,
    );
    expect(Math.abs(world.y * zoomed.scale + zoomed.y - anchor.y)).toBeLessThan(
      0.05,
    );
    await finishedTiles(page, zoomed.scale * 3);
    const detail = await profile(page);
    // Actual decoded pixels must distinguish one-point white gaps from black bars.
    // Checking a canvas size alone would also pass an upscaled blurry preview.
    expect(
      detail.pairs.every((p) => p.black !== null && p.white !== null),
    ).toBe(true);
    const contrast =
      detail.pairs.reduce((sum, p) => sum + p.white! - p.black!, 0) /
      detail.pairs.length;
    const previewContrast =
      detail.pairs.reduce((sum, p) => sum + p.previewContrast, 0) /
      detail.pairs.length;
    expect(contrast).toBeGreaterThan(220);
    expect(contrast - previewContrast).toBeGreaterThan(140);
    expect(Math.min(...detail.scales)).toBeGreaterThanOrEqual(
      zoomed.scale * 3 - 0.001,
    );
    expect(detail.maxSide).toBeLessThanOrEqual(1024);
    expect(detail.pixels).toBeLessThan(20_000_000);
    expect(detail.pixels).toBeLessThan(
      (WIDTH * HEIGHT * Math.min(...detail.scales) ** 2) / 20,
    );

    expect(await page.getByRole("alert").allTextContents()).toEqual([]);
    // Middle-button pan must not also paste an OS primary text selection.
    await page.evaluate(() => {
      const input = document.createElement("textarea");
      input.id = "pan-clipboard-source";
      input.value = "Synthetic clipboard text before middle-button pan";
      input.style.cssText =
        "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
      document.body.appendChild(input);
      input.focus({ preventScroll: true });
      input.select();
    });
    await page.keyboard.press("Control+c");
    await page.evaluate(() =>
      document.getElementById("pan-clipboard-source")?.remove(),
    );
    await page.getByTestId("viewport").focus();
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(stage.x + anchor.x - 180, stage.y + anchor.y - 80, {
      steps: 4,
    });
    await page.mouse.up({ button: "middle" });
    await expect
      .poll(async () => Math.abs((await geometry(page)).x - (zoomed.x - 180)))
      .toBeLessThan(0.05);
    await expect
      .poll(async () => Math.abs((await geometry(page)).y - (zoomed.y - 80)))
      .toBeLessThan(0.05);
    const panned = await geometry(page);
    await finishedTiles(page, panned.scale * 3, detail.keys);
    const after = await profile(page);
    expect(after.keys.some((key) => !detail.keys.includes(key))).toBe(true);
    expect(after.pixels).toBeLessThan(20_000_000);
    expect(await page.getByRole("alert").allTextContents()).toEqual([]);
    const screenshot = await page.screenshot({
      path: `artifacts/large-plan-detail-${browserName}.png`,
    });
    // Inspect the composited screen too: correct source pixels alone cannot
    // detect bright seams introduced by fractional CSS canvas boundaries.
    const seamDeviation = await page.evaluate(
      async ({ png, stage }) => {
        const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(
          new Blob([bytes], { type: "image/png" }),
        );
        try {
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext("2d")!;
          context.drawImage(bitmap, 0, 0);
          const dpr = window.devicePixelRatio;
          const x = Math.ceil((stage.x + stage.width * 0.2) * dpr);
          const y = Math.ceil((stage.y + stage.height * 0.2) * dpr);
          const width = Math.floor(stage.width * 0.6 * dpr);
          const height = Math.floor(stage.height * 0.6 * dpr);
          const data = context.getImageData(x, y, width, height).data;
          const means = Array.from({ length: height }, (_, row) => {
            let sum = 0;
            for (let column = 0; column < width; column++) {
              const index = (row * width + column) * 4;
              sum += data[index] + data[index + 1] + data[index + 2];
            }
            return sum / (width * 3);
          });
          const sorted = [...means].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          return Math.max(...means.map((value) => Math.abs(value - median)));
        } finally {
          bitmap.close();
        }
      },
      { png: screenshot.toString("base64"), stage },
    );
    expect(seamDeviation).toBeLessThan(3);
  } finally {
    await context.close();
  }
});
