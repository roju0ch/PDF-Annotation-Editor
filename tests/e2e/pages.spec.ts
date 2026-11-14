import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import * as m from "mupdf";
import { menu, closeMenu } from "./menus";
async function fixture(path: string, labels: string[], form = false) {
  const doc = new m.PDFDocument(),
    font = doc.addSimpleFont(new m.Font("Helvetica"));
  for (const [i, label] of labels.entries()) {
    const content = `${i % 3 === 0 ? "1 0 0" : i % 3 === 1 ? "0 0.7 0" : "0 0 1"} rg 20 20 260 80 re f 0 0 0 rg BT /F 24 Tf 40 320 Td (${label}) Tj ET`;
    doc.insertPage(
      -1,
      doc.addPage([0, 0, 300, 400], 0, { Font: { F: font } }, content),
    );
    const page = doc.loadPage(i),
      note = page.createAnnotation("Text");
    note.setRect([120, 120, 144, 144]);
    note.setContents(`Note ${label}`);
    note.update();
    page.destroy();
  }
  if (form) doc.getTrailer().get("Root").put("AcroForm", { Fields: [] });
  const b = doc.saveToBuffer("compress=yes");
  try {
    await writeFile(path, b.asUint8Array());
  } finally {
    b.destroy();
    doc.destroy();
  }
}
test.beforeAll(async () => {
  await fixture("artifacts/pages-main.pdf", ["A", "B", "C"]);
  await fixture("artifacts/pages-add.pdf", ["D", "E"]);
  await fixture("artifacts/pages-form.pdf", ["Form"], true);
  await fixture(
    "artifacts/pages-many.pdf",
    Array.from({ length: 50 }, (_, i) => `Page ${i + 1}`),
  );
});
async function open(page: Page, file = "artifacts/pages-main.pdf") {
  await page.goto("");
  await page.getByLabel("PDF öffnen", { exact: true }).setInputFiles(file);
  await expect(page.getByLabel("PDF-Seite 1")).toHaveAttribute(
    "data-rendered",
    "true",
  );
}
async function overview(page: Page) {
  if (!(await page.locator("#pages-menu").isVisible()))
    await page
      .getByRole("button", { name: "Seitenübersicht", exact: true })
      .click();
}
async function ids(page: Page) {
  return page
    .locator(".page-card")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-page-id")));
}
async function download(page: Page, file: string) {
  await closeMenu(page);
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PDF herunterladen", exact: true })
    .click();
  await (await pending).saveAs(file);
  const doc = new m.PDFDocument(new Uint8Array(await readFile(file)));
  try {
    expect(doc.wasRepaired()).toBe(false);
    return Array.from({ length: doc.countPages() }, (_, i) => {
      const p = doc.loadPage(i),
        text = p.toStructuredText("");
      try {
        return {
          text: text.asText().trim(),
          comments: p.getAnnotations().map((a) => a.getContents()),
        };
      } finally {
        text.destroy();
        p.destroy();
      }
    });
  } finally {
    doc.destroy();
  }
}
async function add(page: Page, file: string, where = "end") {
  await overview(page);
  await page.getByLabel("PDF einfügen", { exact: true }).selectOption(where);
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "PDF hinzufügen …", exact: true })
    .click();
  await (await chooser).setFiles(file);
}
test("drag page order, insert PDF after current page, undo/redo and export preserve comments and contents", async ({
  page,
  browserName,
}) => {
  await open(page);
  const viewport = await page.getByTestId("viewport").boundingBox();
  await overview(page);
  await expect(page.getByLabel("Miniatur Seite 1")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  expect(await page.getByTestId("viewport").boundingBox()).toEqual(viewport);
  const original = await ids(page),
    first = (await page
      .locator('.page-card[data-page-index="0"]')
      .boundingBox())!,
    last = (await page
      .locator('.page-card[data-page-index="2"]')
      .boundingBox())!;
  await page.mouse.move(first.x + 50, first.y + 30);
  await page.mouse.down();
  await page.mouse.move(last.x + 50, last.y + last.height - 5, { steps: 12 });
  await expect(page.getByTestId("page-insertion")).toBeVisible();
  await page.mouse.up();
  await expect
    .poll(() => ids(page))
    .toEqual([original[1], original[2], original[0]]);
  await expect(
    page.getByRole("button", { name: "Seite 3 anzeigen", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await closeMenu(page);
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await overview(page);
  await expect.poll(() => ids(page)).toEqual(original);
  await closeMenu(page);
  await page.getByRole("button", { name: "Wiederholen", exact: true }).click();
  await overview(page);
  await expect
    .poll(() => ids(page))
    .toEqual([original[1], original[2], original[0]]);
  await page
    .getByRole("button", { name: "Seite 1 anzeigen", exact: true })
    .click();
  await add(page, "artifacts/pages-add.pdf", "after");
  await expect(page.locator("#pages-menu h2")).toHaveText("Seiten · 5");
  await expect(page.getByLabel("Miniatur Seite 2")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await expect(page.getByLabel("PDF-Seite 2", { exact: true })).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.screenshot({ path: `artifacts/pages-desktop-${browserName}.png` });
  await closeMenu(page);
  await menu(page, "annotations");
  await expect(page.locator(".annotation-list button")).toContainText("Note D");
  await page.locator(".annotation-list button").click();
  await page.getByLabel("Annotationsinhalt", { exact: true }).fill("Edited D");
  await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Übernehmen", exact: true }),
  ).toBeDisabled();
  const saved = await download(
    page,
    `artifacts/pages-export-${browserName}.pdf`,
  );
  expect(saved.map((p) => p.text)).toEqual(["B", "D", "E", "C", "A"]);
  expect(saved.map((p) => p.comments)).toEqual([
    ["Note B"],
    ["Edited D"],
    ["Note E"],
    ["Note C"],
    ["Note A"],
  ]);
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await overview(page);
  await expect(page.locator("#pages-menu h2")).toHaveText("Seiten · 3");
  await closeMenu(page);
  await page.getByRole("button", { name: "Wiederholen", exact: true }).click();
  await overview(page);
  await expect(page.locator("#pages-menu h2")).toHaveText("Seiten · 5");
});
test("append, keyboard move, invalid PDF rejection, and bounded thumbnails for long documents", async ({
  page,
  browserName,
}) => {
  await open(page);
  await add(page, "artifacts/pages-add.pdf");
  await expect(page.locator("#pages-menu h2")).toHaveText("Seiten · 5");
  await page
    .getByRole("button", { name: "Seite nach vorne verschieben", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Seite 3 anzeigen", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const saved = await download(
    page,
    `artifacts/pages-append-${browserName}.pdf`,
  );
  expect(saved.map((p) => p.text)).toEqual(["A", "B", "D", "C", "E"]);
  await add(page, "artifacts/pages-form.pdf");
  await expect(page.getByRole("alert")).toContainText("Formular");
  await overview(page);
  await expect(page.locator("#pages-menu h2")).toHaveText("Seiten · 5");
  await closeMenu(page);
  await page.getByRole("button", { name: "Meldung schließen" }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles("artifacts/pages-many.pdf");
  await overview(page);
  await expect(page.locator("#pages-menu h2")).toHaveText("Seiten · 50");
  expect(await page.locator(".page-thumbnail canvas").count()).toBeLessThan(12);
  await page.getByTestId("page-list").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(
    page.getByRole("button", { name: "Seite 50 anzeigen", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Miniatur Seite 50", { exact: true }),
  ).toHaveAttribute("data-rendered", "true");
  expect(await page.locator(".page-thumbnail canvas").count()).toBeLessThan(12);
});
test("mobile long-press drag, scrolling and cancellation", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Touch injection requires Chromium CDP.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await overview(page);
  const original = await ids(page),
    session = await context.newCDPSession(page);
  const touch = (
    type: "touchStart" | "touchMove" | "touchEnd",
    points: { x: number; y: number; id: number }[],
  ) => session.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  const first = (await page
      .locator('.page-card[data-page-index="0"]')
      .boundingBox())!,
    second = (await page
      .locator('.page-card[data-page-index="1"]')
      .boundingBox())!;
  await touch("touchStart", [{ x: first.x + 50, y: first.y + 30, id: 1 }]);
  await expect(page.getByTestId("page-insertion")).toBeVisible();
  await touch("touchMove", [
    { x: second.x + 50, y: second.y + second.height - 5, id: 1 },
  ]);
  await touch("touchEnd", []);
  await expect
    .poll(() => ids(page))
    .toEqual([original[1], original[0], original[2]]);
  await expect(page.getByLabel("Miniatur Seite 2")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.screenshot({ path: "artifacts/pages-mobile.png" });
  const moved = (await page
    .locator('.page-card[data-page-index="1"]')
    .boundingBox())!;
  await touch("touchStart", [{ x: moved.x + 50, y: moved.y + 30, id: 1 }]);
  await expect(page.getByTestId("page-insertion")).toBeVisible();
  await page.keyboard.press("Escape");
  await touch("touchEnd", []);
  await overview(page);
  await expect
    .poll(() => ids(page))
    .toEqual([original[1], original[0], original[2]]);
  await closeMenu(page);
  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles("artifacts/pages-many.pdf");
  await overview(page);
  await expect(page.locator("#pages-menu h2")).toHaveText("Seiten · 50");
  const row = (await page
    .getByRole("button", { name: "Seite 2 anzeigen", exact: true })
    .boundingBox())!;
  await touch("touchStart", [{ x: row.x + 50, y: row.y + 70, id: 1 }]);
  await touch("touchMove", [{ x: row.x + 50, y: row.y - 50, id: 1 }]);
  await touch("touchEnd", []);
  await expect
    .poll(() => page.getByTestId("page-list").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(80);
  await expect(page.getByTestId("page-insertion")).toHaveCount(0);
  await closeMenu(page);
  await expect(
    page.getByRole("button", { name: "Rückgängig", exact: true }),
  ).toBeDisabled();
});

test("drag autoscroll retains capture through virtual rows and reopening restores visible thumbnails", async ({
  page,
  browserName,
}) => {
  await open(page, "artifacts/pages-many.pdf");
  await overview(page);
  const first = (await page
    .getByRole("button", { name: "Seite 1 anzeigen", exact: true })
    .boundingBox())!;
  const list = page.getByTestId("page-list"),
    box = (await list.boundingBox())!;
  await page.mouse.move(first.x + 50, first.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + box.height - 3, { steps: 6 });
  await expect
    .poll(
      () =>
        list.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
      { timeout: 20000 },
    )
    .toBeLessThan(2);
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "Seite 50 anzeigen", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await closeMenu(page);
  await overview(page);
  await expect(
    page.getByLabel("Miniatur Seite 50", { exact: true }),
  ).toHaveAttribute("data-rendered", "true");
  const saved = await download(
    page,
    `artifacts/pages-autoscroll-${browserName}.pdf`,
  );
  expect(saved.map((p) => p.text)).toEqual([
    ...Array.from({ length: 49 }, (_, i) => `Page ${i + 2}`),
    "Page 1",
  ]);
});
