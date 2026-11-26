import { zoomWithWheel } from "./viewerInput";
import { writeSelectionFixture } from "./fixtures";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as mupdf from "mupdf";
import { menu, closeMenu, viewAction } from "./menus";

test.beforeAll(() => writeSelectionFixture("artifacts/selection-fixture.pdf"));

async function point(page: Page, x: number, y: number, index = 0) {
  const box = (await page.getByTestId(`page-${index}`).boundingBox())!;
  const scale = box.width / (index === 0 ? 300 : 400);
  return { x: box.x + x * scale, y: box.y + y * scale };
}
async function drag(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
}
async function open(page: Page) {
  await page.goto("");
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles("artifacts/selection-fixture.pdf");
  await expect(page.getByLabel("PDF-Seite 1")).toHaveAttribute(
    "data-rendered",
    "true",
  );
}
async function exportPositions(page: Page, index: number, file: string) {
  const waiting = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PDF herunterladen", exact: true })
    .click();
  await (await waiting).saveAs(file);
  const doc = new mupdf.PDFDocument(new Uint8Array(await readFile(file)));
  const p = doc.loadPage(index);
  try {
    const origin = p.getBounds();
    return Object.fromEntries(
      p.getAnnotations().map((a) => {
        const rect = a.getType() === "Ink" ? a.getBounds() : a.getRect();
        return [a.getContents(), [rect[0] - origin[0], rect[1] - origin[1]]];
      }),
    );
  } finally {
    p.destroy();
    doc.destroy();
  }
}
for (const index of [0, 1]) {
  test(`marquee and native group move on ${index ? "rotated CropBox page at zoom" : "normal page"}`, async ({
    page,
    browserName,
  }) => {
    await open(page);
    if (index) {
      await viewAction(page, "Nächste Seite");
      const anchor = await point(page, 180, 210, index);
      await page.mouse.move(anchor.x, anchor.y);
      await zoomWithWheel(page, -80);
      await expect(page.getByLabel("PDF-Seite 2")).toHaveAttribute(
        "data-rendered",
        "true",
      );
    }
    const before = await exportPositions(
      page,
      index,
      `artifacts/selection-before-${index}-${browserName}.pdf`,
    );
    // Reverse drag on the rotated page; neither ink stroke is fully enclosed.
    const a = await point(page, 90, 130, index),
      b = await point(page, 220, 215, index);
    await drag(page, index ? b : a, index ? a : b);
    await expect(page.getByTestId("selection-marquee")).toBeVisible();
    await expect(page.getByTestId("selection-outline")).toHaveCount(3);
    await page.screenshot({
      path: `artifacts/marquee-${index}-${browserName}.png`,
    });
    await page.mouse.up();
    await expect(page.getByText("3 ausgewählt", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Rückgängig", exact: true }),
    ).toBeDisabled();
    await menu(page, "annotations");
    await expect(
      page.locator(".annotation-list button[aria-pressed=true]"),
    ).toHaveCount(3);
    await expect(
      page.getByText("3 Markierungen ausgewählt", { exact: true }),
    ).toBeVisible();
    await closeMenu(page);
    // Panning with a group selected must not move the annotations or lose selection.
    const panStart = await point(page, 110, 140, index);
    await page.mouse.move(panStart.x, panStart.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(panStart.x + 20, panStart.y + 10);
    await page.mouse.up({ button: "middle" });
    await expect(page.getByTestId("selection-outline")).toHaveCount(3);
    await expect(
      page.getByRole("button", { name: "Rückgängig", exact: true }),
    ).toBeDisabled();
    const start = await point(page, 110, 140, index),
      end = await point(page, 140, 165, index);
    await drag(page, start, end);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(
      page.getByRole("button", { name: "Rückgängig", exact: true }),
    ).toBeDisabled();
    await expect(page.getByTestId("selection-outline")).toHaveCount(0);
    // Escape cancels the draft and clears selection in the selection tool.
    // Re-select the same group explicitly before committing a real move.
    const selectA = await point(page, 90, 130, index),
      selectB = await point(page, 220, 215, index);
    await drag(page, selectA, selectB);
    await page.mouse.up();
    await expect(page.getByTestId("selection-outline")).toHaveCount(3);
    await drag(page, start, end);
    await expect(page.getByTestId("selection-outline")).toHaveCount(3);
    await page.mouse.up();
    await expect(
      page.getByRole("button", { name: "Rückgängig", exact: true }),
    ).toBeEnabled();
    await expect(page.getByTestId("selection-outline")).toHaveCount(3);
    const after = await exportPositions(
      page,
      index,
      `artifacts/selection-moved-${index}-${browserName}.pdf`,
    );
    for (const key of ["A", "B", "C"]) {
      expect(after[key][0]).toBeCloseTo(before[key][0] + 30, 0);
      expect(after[key][1]).toBeCloseTo(before[key][1] + 25, 0);
    }
    expect(after["Unverändert"]).toEqual(before["Unverändert"]);
    await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Wiederholen", exact: true }),
    ).toBeEnabled();
    expect(
      await exportPositions(
        page,
        index,
        `artifacts/selection-undo-${index}-${browserName}.pdf`,
      ),
    ).toEqual(before);
    await page
      .getByRole("button", { name: "Wiederholen", exact: true })
      .click();
    expect(
      await exportPositions(
        page,
        index,
        `artifacts/selection-redo-${index}-${browserName}.pdf`,
      ),
    ).toEqual(after);
    await page.screenshot({
      path: `artifacts/group-selection-${index}-${browserName}.png`,
    });
    // An empty click clears the selection and does not create an undo entry.
    await page.mouse.click(
      ...(Object.values(await point(page, 40, 350, index)) as [number, number]),
    );
    await expect(page.getByTestId("selection-outline")).toHaveCount(0);
    if (index === 0) {
      const bounds = (await page.getByTestId("page-0").boundingBox())!;
      await drag(
        page,
        { x: bounds.x - 8, y: bounds.y - 8 },
        { x: bounds.x + bounds.width + 8, y: bounds.y + bounds.height + 8 },
      );
      await page.mouse.up();
      await expect(page.getByTestId("selection-outline")).toHaveCount(5);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("selection-outline")).toHaveCount(0);
    }
  });
}

test("touch marquee, group movement and second-finger cancellation", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Real touch event injection uses Chromium CDP.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const session = await context.newCDPSession(page);
  const touch = async (
    type: "touchStart" | "touchMove" | "touchEnd",
    points: { x: number; y: number; id: number }[],
  ) => session.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  const area = page.getByRole("button", {
    name: "Bereich auswählen",
    exact: true,
  });
  await area.click();
  await expect(area).toHaveAttribute("aria-pressed", "true");
  const corner = { ...(await point(page, 90, 130)), id: 1 };
  const opposite = { ...(await point(page, 220, 215)), id: 1 };
  await touch("touchStart", [corner]);
  await touch("touchEnd", []);
  await expect(area).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("selection-outline")).toHaveCount(0);
  await touch("touchStart", [corner]);
  await touch("touchMove", [opposite]);
  await expect(page.getByTestId("selection-marquee")).toBeVisible();
  await touch("touchStart", [
    opposite,
    { ...opposite, x: opposite.x + 30, id: 2 },
  ]);
  await expect(page.getByTestId("selection-marquee")).toHaveCount(0);
  await touch("touchEnd", []);
  await expect(page.getByTestId("selection-outline")).toHaveCount(0);

  await touch("touchStart", [corner]);
  await touch("touchMove", [opposite]);
  await page.screenshot({ path: "artifacts/marquee-mobile.png" });
  await touch("touchEnd", []);
  await expect(page.getByTestId("selection-outline")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Auswählen / Verschieben", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const start = await point(page, 110, 140),
    end = await point(page, 140, 165);
  await touch("touchStart", [{ ...start, id: 1 }]);
  await touch("touchMove", [{ ...end, id: 1 }]);
  await touch("touchEnd", []);
  await expect(
    page.getByRole("button", { name: "Rückgängig", exact: true }),
  ).toBeEnabled();
  const moved = await exportPositions(page, 0, "artifacts/selection-touch.pdf");
  const a = await point(page, 140, 165);
  await touch("touchStart", [{ ...a, id: 1 }]);
  await touch("touchMove", [{ x: a.x + 15, y: a.y + 10, id: 1 }]);
  await touch("touchStart", [
    { x: a.x + 15, y: a.y + 10, id: 1 },
    { x: a.x + 80, y: a.y, id: 2 },
  ]);
  await touch("touchMove", [
    { x: a.x + 5, y: a.y + 10, id: 1 },
    { x: a.x + 100, y: a.y, id: 2 },
  ]);
  await touch("touchEnd", []);
  expect(
    await exportPositions(page, 0, "artifacts/selection-pinch-cancel.pdf"),
  ).toEqual(moved);
  await expect(page.getByTestId("selection-outline")).toHaveCount(3);
  await page.screenshot({ path: "artifacts/group-selection-mobile.png" });
});

test("touch area selection starts on a visible following page and waits for its annotations", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Touch events use Chromium CDP");
  await page.addInitScript(() => {
    const held: (() => void)[] = [];
    let defer = true;
    Worker.prototype.postMessage = new Proxy(Worker.prototype.postMessage, {
      apply(post, worker, args) {
        const [message] = args;
        if (defer && message.type === "list" && message.page === 1) {
          held.push(() => Reflect.apply(post, worker, args));
          return;
        }
        Reflect.apply(post, worker, args);
      },
    });
    Object.defineProperty(window, "releasePageAnnotations", {
      value: () => {
        defer = false;
        held.splice(0).forEach((send) => send());
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const stage = (await page.getByTestId("viewport").boundingBox())!;
  await page.mouse.move(stage.x + 120, stage.y + 250);
  const beforeScroll = await point(page, 90, 130, 1);
  await page.mouse.wheel(0, 180);
  await expect
    .poll(async () => (await point(page, 90, 130, 1)).y)
    .toBeCloseTo(beforeScroll.y - 180, 0);
  const pageNumber = page.getByLabel("Seite", { exact: true });
  await expect(pageNumber).toHaveValue("1");

  const session = await context.newCDPSession(page);
  const touch = (
    type: "touchStart" | "touchMove" | "touchEnd",
    touchPoints: { x: number; y: number; id: number }[],
  ) => session.send("Input.dispatchTouchEvent", { type, touchPoints });
  const area = page.getByRole("button", {
    name: "Bereich auswählen",
    exact: true,
  });
  const button = (await area.boundingBox())!;
  await touch("touchStart", [
    { x: button.x + button.width / 2, y: button.y + button.height / 2, id: 1 },
  ]);
  await touch("touchEnd", []);
  await expect(area).toHaveAttribute("aria-pressed", "true");
  const corner = { ...(await point(page, 90, 130, 1)), id: 1 };
  const opposite = { ...(await point(page, 220, 215, 1)), id: 1 };
  expect(opposite.y).toBeLessThan(stage.y + stage.height);
  await touch("touchStart", [corner]);
  await touch("touchMove", [opposite]);
  const second = page.getByTestId("page-1");
  await expect(second.getByTestId("selection-marquee")).toBeVisible();
  await touch("touchEnd", []);
  await expect(pageNumber).toHaveValue("2");
  await expect(area).toHaveAttribute("aria-pressed", "false");
  expect(await point(page, 90, 130, 1)).toEqual({ x: corner.x, y: corner.y });
  await expect(page.getByTestId("selection-outline")).toHaveCount(0);
  await page.evaluate(() => Reflect.get(window, "releasePageAnnotations")());
  await expect(second.getByTestId("selection-outline")).toHaveCount(3);
  await expect(page.getByText("3 ausgewählt", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Rückgängig", exact: true }),
  ).toBeDisabled();
});

for (const platform of ["Linux x86_64", "Win32", "MacIntel"]) {
  test(`delete shortcut removes a group in one edit on ${platform}`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => Object.defineProperty(navigator, "platform", { value }),
      platform,
    );
    await open(page);
    const undo = page.getByRole("button", { name: "Rückgängig", exact: true });
    await page.keyboard.press("Delete");
    await expect(undo).toBeDisabled();
    await drag(page, await point(page, 90, 130), await point(page, 220, 215));
    await page.mouse.up();
    await expect(page.getByTestId("selection-outline")).toHaveCount(3);
    await menu(page, "annotations");
    await page.keyboard.press("Delete");
    await page.keyboard.press("Backspace");
    await expect(undo).toBeDisabled();
    await closeMenu(page);
    if (platform !== "MacIntel") {
      await page.keyboard.press("Backspace");
      await expect(undo).toBeDisabled();
    }
    await page.keyboard.press(platform === "MacIntel" ? "Backspace" : "Delete");
    await expect(
      page.getByText("3 Markierungen gelöscht.", { exact: true }),
    ).toHaveCount(1);
    await undo.click();
    await expect(undo).toBeDisabled();
    await menu(page, "annotations");
    const items = page.locator(".annotation-list button");
    const restored = await items.count();
    expect(restored).toBeGreaterThanOrEqual(3);
    await closeMenu(page);
    await page
      .getByRole("button", { name: "Wiederholen", exact: true })
      .click();
    await menu(page, "annotations");
    await expect(items).toHaveCount(restored - 3);
  });
}

test("Mac delete keys edit the property text and leave the selected annotation intact", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "platform", { value: "MacIntel" }),
  );
  await open(page);
  await menu(page, "annotations");
  await page
    .locator(".annotation-list button")
    .filter({ hasText: "Unverändert" })
    .click();
  const field = page.getByLabel("Annotationsinhalt");
  await field.focus();
  await field.press("Home");
  await field.press("Delete");
  await expect(field).toHaveValue("nverändert");
  await field.press("End");
  await field.press("Backspace");
  await expect(field).toHaveValue("nveränder");
  await expect(
    page.locator(".annotation-list button[aria-pressed=true]"),
  ).toContainText("Unverändert");
  await expect(
    page.getByRole("button", { name: "Rückgängig", exact: true }),
  ).toBeDisabled();
});
