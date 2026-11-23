import { zoomWithWheel } from "./viewerInput";
import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import * as mupdf from "mupdf";
import { menu, closeMenu, tool } from "./menus";
import { compositedRaster } from "./compositedRaster";

const fixture = "artifacts/annotation-large-plan.pdf";

test.beforeAll(async () => {
  // A large, independent vector plan; no private reference PDF enters CI.
  const doc = new mupdf.PDFDocument();
  const lines = Array.from({ length: 1400 }, (_, i) => {
    const x = (i * 97) % 6000;
    const y = (i * 53) % 4000;
    return `${x} ${y} m ${Math.min(6000, x + 300)} ${Math.min(4000, y + 180)} l S`;
  }).join("\n");
  try {
    doc.insertPage(
      -1,
      doc.addPage([0, 0, 6000, 4000], 0, {}, `0.72 G 0.4 w\n${lines}\n`),
    );
    const bytes = doc.saveToBuffer("compress=yes");
    try {
      await mkdir("artifacts", { recursive: true });
      await writeFile(fixture, bytes.asUint8Array());
    } finally {
      bytes.destroy();
    }
  } finally {
    doc.destroy();
  }
});

type RenderProbe = {
  messages: {
    type: string;
    page?: number;
    split?: boolean;
    revision?: number;
  }[];
  holdPatches: boolean;
  patches: (() => void)[];
  base: HTMLCanvasElement[];
  release: () => void;
};

async function settled(page: Page) {
  await expect
    .poll(
      () =>
        page.locator(".detail-layer").evaluateAll(
          (layers) =>
            layers.length > 0 &&
            layers.every((layer) => {
              const data = (layer as HTMLElement).dataset;
              return (
                data.rendering === "false" &&
                data.annotationRendering === "false"
              );
            }),
        ),
      { timeout: 20000 },
    )
    .toBe(true);
}

async function baseSnapshot(page: Page, remember = false) {
  return page.evaluate((remember) => {
    const probe = (globalThis as unknown as { renderProbe: RenderProbe })
      .renderProbe;
    const base = [
      ...document.querySelectorAll<HTMLCanvasElement>(
        'canvas[aria-label^="PDF-Seite"], .raster-tile',
      ),
    ];
    if (remember) probe.base = base;
    const hashes = base.map((canvas) => {
      const pixels = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
      return { width: canvas.width, height: canvas.height, hash };
    });
    return {
      sameNodes:
        base.length === probe.base.length &&
        base.every((node, i) => node === probe.base[i]),
      hashes,
      requests: probe.messages.filter(
        (message) =>
          message.type === "render" || message.type === "render-tile",
      ).length,
    };
  }, remember);
}

async function screenRegion(
  page: Page,
  region: [number, number, number, number],
) {
  const sheet = (await page.getByTestId("page-0").boundingBox())!;
  return [
    ((region[0] - sheet.x) * 6000) / sheet.width,
    ((region[1] - sheet.y) * 4000) / sheet.height,
    (region[2] * 6000) / sheet.width,
    (region[3] * 4000) / sheet.height,
  ] as [number, number, number, number];
}

test("editing native annotations preserves the large-plan raster and does not wait for annotation painting", async ({
  page,
  browserName,
}) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    const probe: RenderProbe = {
      messages: [],
      holdPatches: false,
      patches: [],
      base: [],
      release: () => {},
    };
    probe.release = () => {
      probe.holdPatches = false;
      for (const send of probe.patches.splice(0)) send();
    };
    Object.defineProperty(globalThis, "renderProbe", { value: probe });
    Worker.prototype.postMessage = function (
      message: unknown,
      options?: Transferable[] | StructuredSerializeOptions,
    ) {
      const request = message as {
        type?: unknown;
        page?: number;
        split?: boolean;
        revision?: number;
      };
      if (typeof request?.type === "string")
        probe.messages.push({
          type: request.type,
          page: request.page,
          split: request.split,
          revision: request.revision,
        });
      const send = () =>
        Reflect.apply(
          post,
          this,
          options === undefined ? [message] : [message, options],
        );
      if (request?.type === "render-annotation-patch" && probe.holdPatches)
        probe.patches.push(send);
      else send();
    };
  });
  await page.goto("");
  await page.getByLabel("PDF öffnen", { exact: true }).setInputFiles(fixture);
  await expect(page.getByLabel("PDF-Seite 1", { exact: true })).toHaveAttribute(
    "data-rendered",
    "true",
  );
  const stage = (await page.getByTestId("viewport").boundingBox())!;
  await page.mouse.move(
    Math.floor(stage.x + stage.width / 2),
    Math.floor(stage.y + stage.height / 2),
  );
  await zoomWithWheel(page, -200, -200);
  await settled(page);
  const baseline = await baseSnapshot(page, true);
  expect(baseline.hashes.length).toBeGreaterThan(1);
  expect(baseline.requests).toBeGreaterThan(0);
  const assertBase = async () =>
    expect(await baseSnapshot(page)).toEqual(baseline);
  const x = Math.floor(stage.x + stage.width * 0.4);
  const y = Math.floor(stage.y + stage.height * 0.38);
  const length = Math.floor(stage.width * 0.2);
  await tool(page, "Ink");
  await page.evaluate(() => {
    (
      globalThis as unknown as { renderProbe: RenderProbe }
    ).renderProbe.holdPatches = true;
  });
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(x, y + i * 50);
    await page.mouse.down();
    await page.mouse.move(x + length, y + i * 50 + 8, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator(".annotation-list button")).toHaveCount(i + 1);
    // A held native overlay reply must not block another genuine PDF edit.
    await expect(
      page.getByRole("button", { name: "Freihand", exact: true }),
    ).toBeEnabled();
    if (i === 0) {
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (globalThis as unknown as { renderProbe: RenderProbe })
                .renderProbe.patches.length,
          ),
        )
        .toBeGreaterThan(0);
      await expect(page.getByTestId("pending-ink")).toBeVisible();
    }
    await assertBase();
  }
  await tool(page, "Text", "Native note without background redraw");
  await page.mouse.click(
    stage.x + stage.width * 0.72,
    stage.y + stage.height * 0.7,
  );
  await expect(page.locator(".annotation-list button")).toHaveCount(4);
  await assertBase();
  await page.evaluate(() =>
    (
      globalThis as unknown as { renderProbe: RenderProbe }
    ).renderProbe.release(),
  );
  await settled(page);
  await expect(page.getByTestId("pending-ink")).toHaveCount(0);
  const strokes = await screenRegion(page, [x + 20, y - 5, length - 40, 115]);
  await expect
    .poll(
      async () => (await compositedRaster(page, 0, { region: strokes })).red,
    )
    .toBeGreaterThan(20);
  await assertBase();

  await tool(page, "select");
  await menu(page, "annotations");
  await page
    .locator(".annotation-list button")
    .filter({ hasText: "Freihand" })
    .first()
    .click();
  await closeMenu(page);
  const outline = (await page.getByTestId("selection-outline").boundingBox())!;
  await page.mouse.move(x + length / 2, y + 4);
  await page.mouse.down();
  await page.mouse.move(x + length / 2 + 40, y + 34, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await page.getByTestId("selection-outline").boundingBox())!.x,
    )
    .toBeCloseTo(outline.x + 40, 0);
  await settled(page);
  await assertBase();
  const moved = await screenRegion(page, [x + 60, y + 28, length - 80, 12]);
  await expect
    .poll(async () => (await compositedRaster(page, 0, { region: moved })).red)
    .toBeGreaterThan(5);
  await menu(page, "annotations");
  await page
    .getByRole("button", { name: "Annotation löschen", exact: true })
    .click();
  await expect(page.locator(".annotation-list button")).toHaveCount(3);
  await closeMenu(page);
  await settled(page);
  await expect
    .poll(async () => (await compositedRaster(page, 0, { region: moved })).red)
    .toBe(0);
  await assertBase();
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await expect(page.locator(".annotation-list button")).toHaveCount(4);
  await settled(page);
  await expect
    .poll(async () => (await compositedRaster(page, 0, { region: moved })).red)
    .toBeGreaterThan(5);
  await assertBase();
  await page.getByRole("button", { name: "Wiederholen", exact: true }).click();
  await expect(page.locator(".annotation-list button")).toHaveCount(3);
  await settled(page);
  await expect
    .poll(async () => (await compositedRaster(page, 0, { region: moved })).red)
    .toBe(0);
  await assertBase();
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await expect(page.locator(".annotation-list button")).toHaveCount(4);
  await settled(page);
  await assertBase();
  expect(await page.getByRole("alert").allTextContents()).toEqual([]);

  const waiting = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PDF herunterladen", exact: true })
    .click();
  const file = `artifacts/annotation-background-stable-${browserName}.pdf`;
  await (await waiting).saveAs(file);
  const doc = new mupdf.PDFDocument(new Uint8Array(await readFile(file)));
  const p = doc.loadPage(0);
  try {
    expect(doc.wasRepaired()).toBe(false);
    expect(
      p.getAnnotations().filter((a) => a.getType() === "Ink"),
    ).toHaveLength(3);
    expect(
      p
        .getAnnotations()
        .filter(
          (a) => a.getContents() === "Native note without background redraw",
        ),
    ).toHaveLength(1);
    for (const annotation of p.getAnnotations())
      expect(annotation.getObject().get("AP", "N").isStream()).toBe(true);
  } finally {
    p.destroy();
    doc.destroy();
  }
});
