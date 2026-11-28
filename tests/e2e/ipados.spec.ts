import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as mupdf from "mupdf";
import { menu, closeMenu, tool, viewAction } from "./menus";
import {
  errorText,
  nativeSaveBridge,
  state,
  type NativeSaveState,
  type TestWindow,
} from "./nativeSaveHarness";

const iosOrigin = "00000000-0000-4000-8000-000000000042";
const sourceName = "Bauplan EG – Ä.pdf";
const save = (page: Page) =>
  page.getByRole("button", { name: "PDF speichern …", exact: true });
const viewport = (page: Page) => page.getByTestId("viewport");

async function open(page: Page, mode: NativeSaveState["mode"] = "saved") {
  const bytes = await readFile("artifacts/fixture.pdf");
  await nativeSaveBridge(page, mode, "ios", [
    { id: iosOrigin, fileName: sourceName, base64: bytes.toString("base64") },
  ]);
  await page.setViewportSize({ width: 744, height: 1133 });
  await page.goto("");
  await expect(page.getByLabel("PDF-Seite 1", { exact: true })).toHaveAttribute(
    "data-rendered",
    "true",
  );
}

async function exportPdf(page: Page, index: number) {
  const { transactions } = await state(page);
  const upload = transactions.at(-1)!;
  const bytes = Buffer.concat(
    upload.chunks.map((value) => Buffer.from(value, "base64")),
  );
  expect(bytes.length).toBe(upload.expected);
  const document = new mupdf.PDFDocument(new Uint8Array(bytes));
  const pdfPage = document.loadPage(index);
  try {
    expect(document.wasRepaired()).toBe(false);
    return pdfPage.getAnnotations().map((annotation) => ({
      type: annotation.getType(),
      text: annotation.getContents(),
      ink: annotation.getType() === "Ink" ? annotation.getInkList() : [],
    }));
  } finally {
    pdfPage.destroy();
    document.destroy();
  }
}

async function copy(page: Page, name?: string) {
  await save(page).click();
  if (name !== undefined)
    await page.getByLabel("Dateiname für die Kopie").fill(name);
  await page
    .getByRole("button", { name: "Speichern unter …", exact: true })
    .click();
}

async function point(page: Page, index: number, x: number, y: number) {
  const box = (await page.getByTestId(`page-${index}`).boundingBox())!;
  return { x: box.x + box.width * x, y: box.y + box.height * y };
}

test("iPad pencil draws at rotated zoom coordinates, rejects palm edits and supports move, delete and undo", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Pen and touch are simulated through Chromium CDP.",
  );
  await open(page);
  await viewAction(page, "Nächste Seite");
  await expect(page.getByLabel("PDF-Seite 2")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await viewAction(page, "Breite");
  const before = await point(page, 1, 0.24, 0.14);
  const after = await point(page, 1, 0.62, 0.28);
  await tool(page, "Ink");
  const cdp = await context.newCDPSession(page);
  const pen = (
    type: "mousePressed" | "mouseMoved" | "mouseReleased",
    p: { x: number; y: number },
  ) =>
    cdp.send("Input.dispatchMouseEvent", {
      type,
      ...p,
      button: type === "mouseMoved" ? "none" : "left",
      buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: 1,
      pointerType: "pen",
    });
  const touchAt = await point(page, 1, 0.72, 0.25);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", dx = 0) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        type === "touchEnd" ? [] : [{ ...touchAt, x: touchAt.x + dx, id: 1 }],
    });
  await page.evaluate(() => {
    document.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "pen")
        document.body.dataset.pen = String(e.pointerId);
    });
  });
  const world = page.getByTestId("world");
  const position = await world.getAttribute("style");
  await pen("mousePressed", before);
  await touch("touchStart");
  await touch("touchMove", 12);
  await pen("mouseMoved", after);
  await touch("touchEnd");
  await pen("mouseReleased", after);
  await expect.poll(async () => (await state(page)).workerDirty).toBe(true);
  await expect(world).toHaveAttribute("style", position!);

  const undo = page.getByRole("button", { name: "Rückgängig", exact: true });
  await undo.click();
  await page.getByRole("button", { name: "Wiederholen", exact: true }).click();
  await expect.poll(async () => (await state(page)).workerDirty).toBe(true);
  await copy(page, "Pencil auf gedrehter Seite.pdf");
  await expect(page.locator(".edit-status[role=status]")).toContainText(
    "PDF gespeichert: Pencil auf gedrehter Seite.pdf",
  );
  const strokes = (await exportPdf(page, 1)).filter(
    (entry) => entry.type === "Ink",
  );
  expect(strokes).toHaveLength(1);
  const ink = strokes[0].ink[0];
  expect(ink[0][0]).toBeCloseTo(400 * 0.24, 0);
  expect(ink[0][1]).toBeCloseTo(500 * 0.14, 0);
  expect(ink.at(-1)![0]).toBeCloseTo(400 * 0.62, 0);
  expect(ink.at(-1)![1]).toBeCloseTo(500 * 0.28, 0);

  // Cancel an active pen stroke without committing or disturbing the saved one.
  await pen("mousePressed", touchAt);
  const pointer = Number(await page.locator("body").getAttribute("data-pen"));
  expect(pointer).toBeGreaterThan(0);
  await pen("mouseMoved", { ...touchAt, y: touchAt.y + 30 });
  await viewport(page).dispatchEvent("pointercancel", {
    pointerType: "pen",
    pointerId: pointer,
  });
  await pen("mouseReleased", { ...touchAt, y: touchAt.y + 30 });
  expect((await state(page)).workerDirty).toBe(false);

  await tool(page, "select");
  await pen("mousePressed", before);
  await pen("mouseMoved", { ...before, x: before.x + 35 });
  await pen("mouseReleased", { ...before, x: before.x + 35 });
  await expect.poll(async () => (await state(page)).workerDirty).toBe(true);
  await copy(page, "Verschoben.pdf");
  await expect(page.locator(".edit-status[role=status]")).toContainText(
    "PDF gespeichert: Verschoben.pdf",
  );
  const moved = (await exportPdf(page, 1)).find(
    (entry) => entry.type === "Ink",
  );
  expect(moved!.ink[0][0][0]).toBeGreaterThan(ink[0][0] + 10);
  await viewport(page).focus();
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await state(page)).workerDirty).toBe(true);
  await copy(page, "Gelöscht.pdf");
  await expect(page.locator(".edit-status[role=status]")).toContainText(
    "PDF gespeichert: Gelöscht.pdf",
  );
  expect((await exportPdf(page, 1)).some((entry) => entry.type === "Ink")).toBe(
    false,
  );
});

test("iPad fingers navigate with Ink selected and can opt into drawing in landscape", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Touch is simulated through Chromium CDP.",
  );
  await page.addInitScript(() => {
    const read = Storage.prototype.getItem;
    const write = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === "ios-finger-ink")
        throw new DOMException("Storage unavailable", "SecurityError");
      return read.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "ios-finger-ink")
        throw new DOMException("Storage unavailable", "SecurityError");
      write.call(this, key, value);
    };
  });
  await open(page);
  const cdp = await context.newCDPSession(page);
  const penButton = page.getByRole("button", { name: "Freihand", exact: true });
  expect(await penButton.boundingBox()).toMatchObject({
    width: 44,
    height: 44,
  });
  const touch = (
    type: "touchStart" | "touchMove" | "touchEnd",
    touchPoints: { x: number; y: number; id: number }[],
  ) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  const transform = () =>
    page.getByTestId("world").evaluate((el) => {
      const { a, f } = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return { scale: a, y: f };
    });
  await tool(page, "Ink");
  const origin = { ...(await point(page, 0, 0.4, 0.5)), id: 1 };
  const original = await transform();
  await touch("touchStart", [origin]);
  await touch("touchMove", [{ ...origin, y: origin.y - 150 }]);
  await touch("touchEnd", []);
  await expect
    .poll(async () => (await transform()).y)
    .toBeCloseTo(original.y - 150, 0);
  await touch("touchStart", [origin, { ...origin, x: origin.x + 100, id: 2 }]);
  await touch("touchMove", [
    { ...origin, x: origin.x - 20 },
    { ...origin, x: origin.x + 120, id: 2 },
  ]);
  await touch("touchEnd", []);
  await expect
    .poll(async () => (await transform()).scale)
    .toBeCloseTo(original.scale * 1.4, 3);
  expect((await state(page)).workerDirty).toBe(false);

  await page.setViewportSize({ width: 1133, height: 744 });
  expect(await penButton.boundingBox()).toMatchObject({
    width: 44,
    height: 44,
  });
  await viewAction(page, "Seite einpassen");
  await menu(page, "view");
  await page.getByRole("checkbox", { name: "Mit Finger zeichnen" }).check();
  await closeMenu(page);
  const finger = { ...(await point(page, 0, 0.45, 0.35)), id: 1 };
  await touch("touchStart", [finger]);
  await touch("touchMove", [{ ...finger, x: finger.x + 60, y: finger.y + 40 }]);
  await touch("touchEnd", []);
  await expect.poll(async () => (await state(page)).workerDirty).toBe(true);
});

test("iPad save preserves dirty state across cancellation and denied writes, then verifies a named copy", async ({
  page,
}) => {
  await open(page, "cancelled");
  await tool(page, "Text", "iPad Files test");
  const { x, y } = await point(page, 0, 0.48, 0.4);
  await page.mouse.click(x, y);
  await expect.poll(async () => (await state(page)).workerDirty).toBe(true);

  await menu(page, "view");
  await page.getByRole("button", { name: "Dokument schließen" }).click();
  await expect(
    page.getByRole("dialog", { name: "Ungesicherte Änderungen" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();

  await copy(page);
  await expect(page.locator(".edit-status[role=status]")).toContainText(
    "Speichern abgebrochen. Änderungen bleiben ungesichert.",
  );
  expect(await state(page)).toMatchObject({
    workerDirty: true,
    acknowledgements: 0,
    browserDownloads: 0,
  });

  await page.evaluate(() => {
    (window as unknown as TestWindow).nativeSaveTest.mode = "failure";
  });
  await save(page).click();
  await page
    .getByRole("button", { name: "Original ersetzen …", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(errorText);
  const failure = await state(page);
  expect(failure.transactions.at(-1)).toMatchObject({
    fileName: sourceName,
    sourceId: iosOrigin,
    replaceOriginal: true,
  });
  expect(failure).toMatchObject({
    workerDirty: true,
    acknowledgements: 0,
    browserDownloads: 0,
  });
  expect(failure.calls.at(-1)).toBe("plugin:ios-bridge|abort_pdf_save");

  await page.evaluate(() => {
    (window as unknown as TestWindow).nativeSaveTest.mode = "saved";
  });
  await copy(page, "Kopie #2 + Ä.pdf");
  await expect(page.locator(".edit-status[role=status]")).toContainText(
    "PDF gespeichert: Kopie #2 + Ä.pdf",
  );
  expect(await state(page)).toMatchObject({
    workerDirty: false,
    acknowledgements: 1,
    browserDownloads: 0,
  });
  expect(await exportPdf(page, 0)).toContainEqual({
    type: "Text",
    text: "iPad Files test",
    ink: [],
  });
});
