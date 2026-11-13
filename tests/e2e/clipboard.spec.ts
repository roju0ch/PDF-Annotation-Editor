import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as mupdf from "mupdf";
import { writeSelectionFixture } from "./fixtures";
import { menu, closeMenu, viewAction } from "./menus";
test.beforeAll(() => writeSelectionFixture("artifacts/clipboard-fixture.pdf"));
async function open(page: Page) {
  await page.goto("");
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles("artifacts/clipboard-fixture.pdf");
  await expect(page.getByLabel("PDF-Seite 1")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await expect(page.locator(".annotation-list button")).toHaveCount(5);
}
async function point(page: Page, x: number, y: number, index = 0) {
  const b = (await page.getByTestId(`page-${index}`).boundingBox())!;
  const scale = b.width / (index === 0 ? 300 : 400);
  return { x: b.x + x * scale, y: b.y + y * scale };
}
async function right(page: Page, x: number, y: number, index = 0) {
  const p = await point(page, x, y, index);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect(
    page.getByRole("menu", { name: "Annotationsaktionen" }),
  ).toBeVisible();
}
async function download(page: Page, path: string) {
  const promise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PDF herunterladen", exact: true })
    .click();
  await (await promise).saveAs(path);
  await expect(
    page.getByRole("button", { name: "PDF herunterladen", exact: true }),
  ).toBeEnabled();
  return new mupdf.PDFDocument(new Uint8Array(await readFile(path)));
}
test("right-click menus copy and cut the full selection with native paste and atomic undo", async ({
  page,
  browserName,
}) => {
  await open(page);
  await right(page, 30, 30);
  await expect(
    page.getByRole("menuitem", { name: /^Einfügen/ }),
  ).toBeDisabled();
  await page.getByRole("menuitem", { name: /^Alle Kommentare/ }).click();
  await expect(page.getByTestId("selection-outline")).toHaveCount(5);
  await right(page, 80, 140);
  await page.getByRole("menuitem", { name: /^Kopieren/ }).click();
  await expect(
    page.getByRole("button", { name: "Rückgängig", exact: true }),
  ).toBeDisabled();
  await right(page, 30, 30);
  await page.getByRole("menuitem", { name: /^Einfügen/ }).click();
  await expect(page.locator(".annotation-list button")).toHaveCount(10);
  await expect(page.getByTestId("selection-outline")).toHaveCount(5);
  const saved = await download(
    page,
    `artifacts/clipboard-context-${browserName}.pdf`,
  );
  const baseline = new mupdf.PDFDocument(
    new Uint8Array(await readFile("artifacts/clipboard-fixture.pdf")),
  );
  const beforePage = baseline.loadPage(0),
    afterPage = saved.loadPage(0);
  try {
    const before = beforePage.getAnnotations(),
      after = afterPage.getAnnotations();
    expect(after).toHaveLength(10);
    const copiedInk = after
      .slice(5)
      .find((a) => a.getType() === "Ink")!
      .getInkList()[0];
    const pixelPoint = [
      (copiedInk[0][0] + copiedInk[1][0]) / 2,
      (copiedInk[0][1] + copiedInk[1][1]) / 2,
    ];
    await expect
      .poll(() =>
        page
          .getByLabel("PDF-Seite 1")
          .evaluate((canvas: HTMLCanvasElement, p: number[]) => {
            const pixel = canvas
              .getContext("2d")!
              .getImageData(
                Math.floor((p[0] * canvas.width) / 300),
                Math.floor((p[1] * canvas.height) / 400),
                1,
                1,
              ).data;
            return (
              pixel[0] > 150 &&
              pixel[1] < 100 &&
              pixel[2] < 100 &&
              pixel[3] > 200
            );
          }, pixelPoint),
      )
      .toBe(true);
    const rect = (a: mupdf.PDFAnnotation) =>
      a.getType() === "Ink" ? a.getBounds() : a.getRect();
    const minX = Math.min(...before.map((a) => rect(a)[0])),
      minY = Math.min(...before.map((a) => rect(a)[1]));
    for (let i = 0; i < 5; i++) {
      expect(after[i].getObject().toString()).toBe(
        before[i].getObject().toString(),
      );
      expect(after[i + 5].getType()).toBe(before[i].getType());
      expect(after[i + 5].getContents()).toBe(before[i].getContents());
      expect(rect(after[i + 5])[0]).toBeCloseTo(
        rect(before[i])[0] - minX + 30,
        0,
      );
      expect(rect(after[i + 5])[1]).toBeCloseTo(
        rect(before[i])[1] - minY + 30,
        0,
      );
      expect(after[i + 5].getObject().get("AP", "N").isStream()).toBe(true);
    }
  } finally {
    beforePage.destroy();
    afterPage.destroy();
    baseline.destroy();
    saved.destroy();
  }
  // Right-click an already selected copy: preserve all five selected objects.
  const box = (await page
    .getByTestId("selection-outline")
    .first()
    .boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: "right",
  });
  await page.getByRole("menuitem", { name: /^Ausschneiden/ }).click();
  await expect(page.locator(".annotation-list button")).toHaveCount(5);
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await expect(page.locator(".annotation-list button")).toHaveCount(10);
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await expect(page.locator(".annotation-list button")).toHaveCount(5);
  await page.getByRole("button", { name: "Wiederholen", exact: true }).click();
  await expect(page.locator(".annotation-list button")).toHaveCount(10);
});
test("Ctrl+A/C/X/V, rotated target page and text-field shortcuts", async ({
  page,
  browserName,
}) => {
  await open(page);
  await page.getByLabel("PDF öffnen", { exact: true }).focus();
  await page.keyboard.press("Control+a");
  await expect(page.getByTestId("selection-outline")).toHaveCount(5);
  await page.getByTestId("viewport").focus();
  await page.keyboard.press("Control+c");
  await expect(
    page.getByRole("status").filter({ hasText: "5 Markierungen kopiert." }),
  ).toBeVisible();
  await viewAction(page, "Nächste Seite");
  await expect(page.locator(".annotation-list button")).toHaveCount(4);
  const p = await point(page, 20, 20, 1);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.press("Control+v");
  await expect(page.locator(".annotation-list button")).toHaveCount(9);
  await expect(page.getByTestId("selection-outline")).toHaveCount(5);
  await page.keyboard.press("Control+x");
  await expect(page.locator(".annotation-list button")).toHaveCount(4);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".annotation-list button")).toHaveCount(9);
  await page.keyboard.press("Control+y");
  await expect(page.locator(".annotation-list button")).toHaveCount(4);
  await page.keyboard.press("Control+v");
  await expect(page.locator(".annotation-list button")).toHaveCount(9);
  await menu(page, "annotations");
  await page.locator(".annotation-list button").first().click();
  const text = page.getByLabel("Annotationsinhalt", { exact: true });
  await text.focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("Nur Text ersetzen");
  await expect(text).toHaveValue("Nur Text ersetzen");
  await expect(page.getByTestId("selection-outline")).toHaveCount(1);
  await page.keyboard.press("Control+c");
  await expect(page.locator(".annotation-list button")).toHaveCount(9);
  await page.getByRole("button", { name: "Verwerfen", exact: true }).click();
  await closeMenu(page);
  const exported = await download(
    page,
    `artifacts/clipboard-keyboard-${browserName}.pdf`,
  );
  try {
    const p1 = exported.loadPage(1);
    expect(p1.getAnnotations()).toHaveLength(9);
    p1.destroy();
    expect(exported.wasRepaired()).toBe(false);
  } finally {
    exported.destroy();
  }
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles(`artifacts/clipboard-keyboard-${browserName}.pdf`);
  await expect(page.getByLabel("PDF-Seite 1")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await right(page, 30, 30);
  await expect(page.getByRole("menuitem", { name: /^Einfügen/ })).toBeEnabled();
  await page.getByRole("menuitem", { name: /^Einfügen/ }).click();
  await expect(page.locator(".annotation-list button")).toHaveCount(10);
});
test("touch long-press opens menus without moving selection and cancels on drag or second finger", async ({
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
  await page.getByTestId("viewport").focus();
  await page.keyboard.press("Control+a");
  const session = await context.newCDPSession(page);
  const touch = (
    type: "touchStart" | "touchMove" | "touchEnd",
    points: { x: number; y: number; id: number }[],
  ) => session.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  const a = await point(page, 80, 140);
  await touch("touchStart", [{ ...a, id: 1 }]);
  await expect(page.getByRole("menuitem", { name: /^Kopieren/ })).toBeVisible();
  await touch("touchEnd", []);
  await expect(page.getByTestId("selection-outline")).toHaveCount(5);
  await expect(
    page.getByRole("button", { name: "Rückgängig", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: "artifacts/context-touch-selection.png" });
  await page.getByRole("menuitem", { name: /^Kopieren/ }).click();
  const blank = await point(page, 280, 350);
  await touch("touchStart", [{ ...blank, id: 1 }]);
  await expect(page.getByRole("menuitem", { name: /^Einfügen/ })).toBeEnabled();
  await touch("touchEnd", []);
  const bounds = (await page
    .getByRole("menu", { name: "Annotationsaktionen" })
    .boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(8);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(382);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(836);
  await page.screenshot({ path: "artifacts/context-touch-blank.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("selection-outline")).toHaveCount(5);
  await touch("touchStart", [{ ...blank, id: 1 }]);
  await touch("touchMove", [{ x: blank.x - 40, y: blank.y + 5, id: 1 }]);
  await page.waitForTimeout(700);
  await expect(
    page.getByRole("menu", { name: "Annotationsaktionen" }),
  ).toHaveCount(0);
  await touch("touchEnd", []);
  await touch("touchStart", [{ ...a, id: 1 }]);
  await touch("touchStart", [
    { ...a, id: 1 },
    { x: a.x + 50, y: a.y, id: 2 },
  ]);
  await page.waitForTimeout(700);
  await expect(
    page.getByRole("menu", { name: "Annotationsaktionen" }),
  ).toHaveCount(0);
  await touch("touchEnd", []);
  await expect(
    page.getByRole("button", { name: "Rückgängig", exact: true }),
  ).toBeDisabled();
});
