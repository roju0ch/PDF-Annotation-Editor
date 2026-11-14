import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import * as mupdf from "mupdf";
import { menu, closeMenu, viewAction } from "./menus";
const png = "artifacts/image-fixture.png";
test.beforeAll(async () => {
  const pix = new mupdf.Pixmap(
    mupdf.ColorSpace.DeviceRGB,
    [0, 0, 200, 100],
    true,
  );
  try {
    const data = pix.getPixels();
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 200; x++) {
        const i = (y * 200 + x) * 4;
        data[i] = x < 100 ? 255 : 0;
        data[i + 1] = x >= 100 ? 255 : 0;
        data[i + 2] = 0;
        data[i + 3] = y < 50 ? 255 : 128;
      }
    await writeFile(png, pix.asPNG());
  } finally {
    pix.destroy();
  }
});
async function open(page: Page) {
  await page.goto("");
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles("artifacts/fixture.pdf");
  await expect(page.getByLabel("PDF-Seite 1")).toHaveAttribute(
    "data-rendered",
    "true",
  );
}
async function insertFile(
  page: Page,
  file: Parameters<import("@playwright/test").FileChooser["setFiles"]>[0] = png,
) {
  await menu(page, "tools");
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Bild einfügen …", exact: true })
    .click();
  await (await chooser).setFiles(file);
  await expect(page.getByTestId("image-resize-0")).toBeVisible();
}
async function save(page: Page, name: string) {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PDF herunterladen", exact: true })
    .click();
  await (await pending).saveAs(name);
  return new mupdf.PDFDocument(new Uint8Array(await readFile(name)));
}
async function resize(page: Page, factor: number) {
  const box = (await page.getByTestId("selection-outline").boundingBox())!;
  const handles = await page.locator('[data-testid^="image-resize-"]').all();
  const points = await Promise.all(
    handles.map(async (h) => (await h.boundingBox())!),
  );
  const corner = points.reduce((a, b) => (a.x + a.y > b.x + b.y ? a : b));
  const x = corner.x + corner.width / 2,
    y = corner.y + corner.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(
    x + box.width * (factor - 1),
    y + box.height * (factor - 1),
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await page.getByTestId("selection-outline").boundingBox())!.width,
    )
    .toBeCloseTo(box.width * factor, 0);
}
test("PNG on rotated page: rendered orientation, resize, move, comments and native export", async ({
  page,
  browserName,
}) => {
  await open(page);
  await viewAction(page, "Nächste Seite");
  await insertFile(page);
  let box = (await page.getByTestId("selection-outline").boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(2, 1);
  await expect
    .poll(() =>
      page
        .getByLabel("PDF-Seite 2")
        .evaluate((canvas: HTMLCanvasElement, b) => {
          const r = canvas.getBoundingClientRect(),
            ctx = canvas.getContext("2d")!;
          return [0.25, 0.75].map((u) => {
            const p = ctx.getImageData(
              Math.floor(((b.x + b.width * u - r.x) * canvas.width) / r.width),
              Math.floor(
                ((b.y + b.height * 0.25 - r.y) * canvas.height) / r.height,
              ),
              1,
              1,
            ).data;
            return [...p.slice(0, 3)];
          });
        }, box),
    )
    .toEqual([
      [255, 0, 0],
      [0, 255, 0],
    ]);
  await resize(page, 1.5);
  box = (await page.getByTestId("selection-outline").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 - 25,
    box.y + box.height / 2 - 20,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await page.getByTestId("selection-outline").boundingBox())!.x,
    )
    .toBeCloseTo(box.x - 25, 0);
  await menu(page, "annotations");
  await expect(
    page.getByLabel("Annotationsfarbe", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Annotationsinhalt", { exact: true })
    .fill("Screenshot-Kommentar");
  await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Übernehmen", exact: true }),
  ).toBeDisabled();
  await closeMenu(page);
  await page.getByTestId("viewport").focus();
  await page.keyboard.press("Control+c");
  await expect(
    page.getByRole("status").filter({ hasText: "1 Markierung kopiert." }),
  ).toBeVisible();
  await page.keyboard.press("Control+v");
  await expect(page.locator(".annotation-list button")).toHaveCount(2);
  const doc = await save(page, `artifacts/images-${browserName}.pdf`);
  try {
    const p = doc.loadPage(1),
      annotations = p.getAnnotations();
    expect(annotations).toHaveLength(2);
    for (const a of annotations) {
      expect(a.getType()).toBe("Stamp");
      expect(a.getContents()).toBe("Screenshot-Kommentar");
      expect(a.getObject().get("AP", "N").isStream()).toBe(true);
      const r = a.getRect();
      expect((r[2] - r[0]) / (r[3] - r[1])).toBeCloseTo(2);
      expect(Math.abs(r[2] - r[0] - 225)).toBeLessThan(1);
    }
    p.destroy();
    expect(doc.wasRepaired()).toBe(false);
  } finally {
    doc.destroy();
  }
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await expect(page.locator(".annotation-list button")).toHaveCount(1);
  await page.getByRole("button", { name: "Wiederholen", exact: true }).click();
  await expect(page.locator(".annotation-list button")).toHaveCount(2);
});
test("real PNG system clipboard via Ctrl+V and context menu, followed by annotation copy", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Clipboard permission automation requires Chromium.",
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  const encoded = (await readFile(png)).toString("base64");
  await page.evaluate(async (base64) => {
    const blob = new Blob(
      [Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))],
      { type: "image/png" },
    );
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  }, encoded);
  await page.getByTestId("viewport").focus();
  await page.keyboard.press("Control+v");
  await expect(page.locator(".annotation-list button")).toHaveCount(2);
  await resize(page, 0.6);
  await page.keyboard.press("Control+c");
  await expect(
    page.getByRole("status").filter({ hasText: "1 Markierung kopiert." }),
  ).toBeVisible();
  await page.keyboard.press("Control+v");
  await expect(page.locator(".annotation-list button")).toHaveCount(3);
  const doc = await save(page, "artifacts/images-system-clipboard.pdf");
  try {
    const p = doc.loadPage(0);
    const stamps = p.getAnnotations().filter((a) => a.getType() === "Stamp");
    expect(stamps).toHaveLength(2);
    const widths = stamps.map((a) => a.getRect()[2] - a.getRect()[0]);
    expect(widths[0]).toBeCloseTo(90, 0);
    expect(widths[1]).toBeCloseTo(widths[0], 3);
    p.destroy();
  } finally {
    doc.destroy();
  }
  await page.evaluate(async (base64) => {
    const blob = new Blob(
      [Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))],
      { type: "image/png" },
    );
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  }, encoded);
  const b = (await page.getByTestId("page-0").boundingBox())!;
  await page.mouse.click(b.x + 20, b.y + 20, { button: "right" });
  await page
    .getByRole("menuitem", { name: "Bild aus Zwischenablage", exact: true })
    .click();
  await expect(page.locator(".annotation-list button")).toHaveCount(4);
  await page.evaluate(() => navigator.clipboard.writeText("Text im Kommentar"));
  await page.getByTestId("viewport").focus();
  await page.keyboard.press("Control+v");
  await expect(page.getByRole("alert")).toContainText(
    "Text oder formatierte Inhalte",
  );
  await expect(page.locator(".annotation-list button")).toHaveCount(4);
  await page.getByRole("button", { name: "Meldung schließen" }).click();
  await menu(page, "annotations");
  await page.getByLabel("Annotationsinhalt", { exact: true }).focus();
  await page.keyboard.press("Control+v");
  await expect(
    page.getByLabel("Annotationsinhalt", { exact: true }),
  ).toHaveValue("Text im Kommentar");
});
test("mobile JPEG picker, touch resize and clipboard-denied fallback", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Touch injection requires Chromium CDP.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, "read", {
      value: async () => {
        throw new DOMException("Denied", "NotAllowedError");
      },
    });
  });
  await open(page);
  const sheet = (await page.getByTestId("page-0").boundingBox())!;
  await page.mouse.click(sheet.x + 20, sheet.y + 20, { button: "right" });
  await page
    .getByRole("menuitem", { name: "Bild aus Zwischenablage", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Kein Zugriff");
  await page.getByRole("button", { name: "Meldung schließen" }).click();
  const jpeg = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 200;
    c.height = 100;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#126dcc";
    ctx.fillRect(0, 0, 200, 100);
    return c.toDataURL("image/jpeg").split(",")[1];
  });
  await page.mouse.click(
    sheet.x + sheet.width * 0.1,
    sheet.y + sheet.height * 0.25,
    { button: "right" },
  );
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("menuitem", { name: "Bild einfügen …", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "screenshot.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(jpeg, "base64"),
  });
  await expect(page.getByTestId("image-resize-0")).toBeVisible();
  const box = (await page.getByTestId("selection-outline").boundingBox())!;
  const handle = (await page.getByTestId("image-resize-1").boundingBox())!;
  const x = handle.x + handle.width / 2,
    y = handle.y + handle.height / 2;
  const session = await context.newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: x + box.width * 0.25, y: y + box.height * 0.25, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(
      async () =>
        (await page.getByTestId("selection-outline").boundingBox())!.width,
    )
    .toBeCloseTo(box.width * 1.25, 0);
  const resized = (await page.getByTestId("selection-outline").boundingBox())!;
  await expect
    .poll(() =>
      page
        .getByLabel("PDF-Seite 1")
        .evaluate((canvas: HTMLCanvasElement, b) => {
          const r = canvas.getBoundingClientRect();
          const pixel = canvas
            .getContext("2d")!
            .getImageData(
              Math.floor(((b.x + b.width / 2 - r.x) * canvas.width) / r.width),
              Math.floor(
                ((b.y + b.height / 2 - r.y) * canvas.height) / r.height,
              ),
              1,
              1,
            ).data;
          return (
            Math.abs(pixel[0] - 18) < 4 &&
            Math.abs(pixel[1] - 109) < 4 &&
            Math.abs(pixel[2] - 204) < 4
          );
        }, resized),
    )
    .toBe(true);
  await page.screenshot({ path: "artifacts/image-mobile.png" });
  const saved = await save(page, "artifacts/image-mobile-jpeg.pdf");
  try {
    const p = saved.loadPage(0);
    expect(
      p.getAnnotations().filter((a) => a.getType() === "Stamp"),
    ).toHaveLength(1);
    p.destroy();
  } finally {
    saved.destroy();
  }
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.getByTestId("selection-outline").boundingBox())!.width,
    )
    .toBeCloseTo(box.width, 0);
});
