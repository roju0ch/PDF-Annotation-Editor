import { menu, closeMenu, tool, viewAction } from "./menus";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as mupdf from "mupdf";
async function open(page: Page) {
  await page.goto("");
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles("artifacts/fixture.pdf");
  await expect(page.getByLabel("PDF-Seite 1")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await expect(page.locator(".annotation-list button")).toHaveCount(1);
}
async function sheetPoint(page: Page, x: number, y: number, index = 0) {
  const b = (await page.getByTestId(`page-${index}`).boundingBox())!;
  const width = index === 1 ? 400 : 300;
  return { x: b.x + (x * b.width) / width, y: b.y + (y * b.width) / width };
}
async function clickAt(page: Page, x: number, y: number, index = 0) {
  const p = await sheetPoint(page, x, y, index);
  await page.mouse.click(p.x, p.y);
}
async function redPixels(page: Page, index: number, rect: number[]) {
  return page
    .getByLabel(`PDF-Seite ${index + 1}`)
    .evaluate((canvas: HTMLCanvasElement, r: number[]) => {
      const w = indexWidth(canvas),
        sx = canvas.width / w,
        sy = canvas.height / (w === 300 ? 400 : 500);
      function indexWidth(c: HTMLCanvasElement) {
        return parseFloat(c.style.width);
      }
      const x = Math.floor(r[0] * sx),
        y = Math.floor(r[1] * sy),
        width = Math.max(1, Math.floor(r[2] * sx)),
        height = Math.max(1, Math.floor(r[3] * sy));
      const pixels = canvas
        .getContext("2d")!
        .getImageData(x, y, width, height).data;
      let red = 0,
        clear = 0;
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
      return { red, clear, total: width * height };
    }, rect);
}
async function download(page: Page, file: string) {
  const waiting = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PDF herunterladen", exact: true })
    .click();
  const d = await waiting;
  await d.saveAs(file);
  await expect(
    page.getByRole("status").filter({ hasText: "PDF-Download gestartet" }),
  ).toBeVisible();
  return new mupdf.PDFDocument(new Uint8Array(await readFile(file)));
}
test("create native ink, pan with active tool, erase, undo/redo and roundtrip", async ({
  page,
}) => {
  await open(page);
  await tool(page, "Ink");
  const start = await sheetPoint(page, 40, 180),
    end = await sheetPoint(page, 220, 180);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".annotation-list button")).toHaveCount(2);
  await expect
    .poll(async () => (await redPixels(page, 0, [60, 177, 100, 6])).red)
    .toBeGreaterThan(50);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(end.x + 40, end.y + 20);
  await page.mouse.up({ button: "middle" });
  await expect(page.locator(".annotation-list button")).toHaveCount(2);
  await tool(page, "erase");
  await clickAt(page, 120, 180);
  await expect(
    page.getByRole("button", { name: "Rückgängig", exact: true }),
  ).toBeEnabled();
  const cut = await download(page, "artifacts/browser-ink-split.pdf");
  const cp = cut.loadPage(0);
  try {
    expect(
      cp
        .getAnnotations()
        .find((a) => a.getType() === "Ink")!
        .getInkList(),
    ).toHaveLength(2);
  } finally {
    cp.destroy();
    cut.destroy();
  }
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Wiederholen", exact: true }),
  ).toBeEnabled();
  const whole = await download(page, "artifacts/browser-ink-undo.pdf");
  const wp = whole.loadPage(0);
  try {
    expect(
      wp
        .getAnnotations()
        .find((a) => a.getType() === "Ink")!
        .getInkList(),
    ).toHaveLength(1);
  } finally {
    wp.destroy();
    whole.destroy();
  }
  await page.getByRole("button", { name: "Wiederholen", exact: true }).click();
  await tool(page, "select");
  await menu(page, "annotations");
  await page
    .locator(".annotation-list button")
    .filter({ hasText: "Freihand" })
    .click();
  await page.getByRole("button", { name: "Annotation löschen" }).click();
  await expect(page.locator(".annotation-list button")).toHaveCount(1);
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await expect(page.locator(".annotation-list button")).toHaveCount(2);
  await expect
    .poll(async () => (await redPixels(page, 0, [60, 177, 30, 6])).red)
    .toBeGreaterThan(20);
  await expect
    .poll(async () => (await redPixels(page, 0, [115, 177, 10, 6])).red)
    .toBe(0);
  await closeMenu(page);
  await page.screenshot({ path: "artifacts/annotation-editor.png" });
});
test("edit existing note, create Text and rotated FreeText, preserve originals and reopen download", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" || !r.url().startsWith("http://127.0.0.1:4173/"))
      requests.push(r.url());
  });
  await open(page);
  await menu(page, "annotations");
  await page.locator(".annotation-list button").first().click();
  await page
    .getByLabel("Annotationsinhalt", { exact: true })
    .fill("Fremdnotiz geändert");
  await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
  await expect(
    page.getByLabel("Annotationsinhalt", { exact: true }),
  ).toHaveValue("Fremdnotiz geändert");
  await tool(page, "Text", "Neue Notiz");
  await clickAt(page, 60, 100);
  await expect(page.locator(".annotation-list button")).toHaveCount(2);
  await viewAction(page, "Nächste Seite");
  await expect(page.getByLabel("PDF-Seite 2")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await expect(page.locator(".annotation-list button")).toHaveCount(0);
  await tool(page, "FreeText", "Planprüfung äöü");
  await clickAt(page, 100, 150, 1);
  await expect(page.locator(".annotation-list button")).toHaveCount(1);
  await tool(page, "select");
  const a = await sheetPoint(page, 140, 170, 1),
    b = await sheetPoint(page, 160, 200, 1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await menu(page, "annotations");
  await page
    .getByLabel("Annotationsinhalt", { exact: true })
    .fill("Verschobenes Textfeld");
  await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
  await expect(
    page.getByLabel("Annotationsinhalt", { exact: true }),
  ).toHaveValue("Verschobenes Textfeld");
  await expect
    .poll(async () => (await redPixels(page, 1, [120, 180, 180, 60])).red)
    .toBeGreaterThan(20);
  const textRaster = await redPixels(page, 1, [120, 180, 180, 60]);
  expect(textRaster.clear / textRaster.total).toBeGreaterThan(0.5);
  const doc = await download(page, "artifacts/browser-annotations.pdf");
  const p0 = doc.loadPage(0),
    p1 = doc.loadPage(1);
  try {
    expect(p0.getAnnotations().map((a) => a.getContents())).toEqual(
      expect.arrayContaining(["Fremdnotiz geändert", "Neue Notiz"]),
    );
    expect(p0.getObject().get("Annots", 1, "A", "URI").asString()).toBe(
      "https://example.invalid/never-followed",
    );
    const ft = p1.getAnnotations()[0];
    expect(ft.getType()).toBe("FreeText");
    expect(ft.getContents()).toBe("Verschobenes Textfeld");
    expect(ft.getObject().get("AP", "N").isStream()).toBe(true);
    const rect = ft.getObject().get("Rect");
    expect(rect.get(0).asNumber()).toBeCloseTo(200, 0);
    expect(rect.get(1).asNumber()).toBeCloseTo(150, 0);
  } finally {
    p0.destroy();
    p1.destroy();
    doc.destroy();
  }
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles("artifacts/browser-annotations.pdf");
  await expect(page.getByLabel("PDF-Seite 1")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await expect(
    page
      .locator(".annotation-list button")
      .filter({ hasText: "Fremdnotiz geändert" }),
  ).toHaveCount(1);
  expect(requests).toEqual([]);
});
test("warns before discarding document edits and protects pending property changes", async ({
  page,
}) => {
  await open(page);
  await menu(page, "annotations");
  await page.locator(".annotation-list button").first().click();
  await page
    .getByLabel("Annotationsinhalt", { exact: true })
    .fill("Noch nicht übernommen");
  await expect(
    page.getByRole("button", { name: "PDF herunterladen", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Nächste Seite",
      exact: true,
      includeHidden: true,
    }),
  ).toBeDisabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles("artifacts/fixture.pdf");
  await menu(page, "annotations");
  await expect(
    page.getByLabel("Annotationsinhalt", { exact: true }),
  ).toHaveValue("Noch nicht übernommen");
  await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
  await expect(
    page.getByText("Ungesicherte Änderungen", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles("artifacts/fixture.pdf");
  await menu(page, "annotations");
  await expect(
    page.getByLabel("Annotationsinhalt", { exact: true }),
  ).toHaveValue("Noch nicht übernommen");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles("artifacts/fixture.pdf");
  await expect(
    page
      .locator(".annotation-list button")
      .filter({ hasText: "Independent fixture note" }),
  ).toHaveCount(1);
});

test("mobile touch placement and pinch cancellation do not create phantom notes", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await tool(page, "Text", "Touch-Notiz");
  const session = await context.newCDPSession(page);
  const p = await sheetPoint(page, 100, 150);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...p, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".annotation-list button")).toHaveCount(2);
  const q = await sheetPoint(page, 150, 220);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...q, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { ...q, id: 1 },
      { x: q.x + 40, y: q.y, id: 2 },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: q.x - 10, y: q.y, id: 1 },
      { x: q.x + 60, y: q.y, id: 2 },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".annotation-list button")).toHaveCount(2);
  await page.screenshot({ path: "artifacts/annotation-editor-mobile.png" });
});
