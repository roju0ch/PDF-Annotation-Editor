import { menu, closeMenu, tool, viewAction, viewOption } from "./menus";
import { test, expect, type Page } from "@playwright/test";
import { zoomWithWheel } from "./viewerInput";
// Computed CSS matrices are serialized with limited precision; tolerate 0.01 CSS px.
const CSS_PIXEL_TOLERANCE = 0.01;
const open = async (page: Page) => {
  await page.goto("");
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles("artifacts/fixture.pdf");
  await expect(
    page.locator('canvas[data-rendered="true"]').first(),
  ).toBeVisible();
};
async function geometry(page: Page) {
  return page.getByTestId("world").evaluate((el) => {
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return { x: m.e, y: m.f, scale: m.a };
  });
}
test("real multipage PDF, pointer zoom, middle/space pan and no content upload", async ({
  page,
  browserName,
}) => {
  const outbound: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:4173/") &&
      !r.url().startsWith("data:")
    )
      outbound.push(r.url());
    expect(r.method()).toBe("GET");
  });
  await open(page);
  await expect(page.getByText("3 Seiten · Native Annotationen")).toBeVisible();
  const colors = await page
    .getByLabel("PDF-Seite 1", { exact: true })
    .evaluate((el: HTMLCanvasElement) => {
      const d = el
        .getContext("2d")!
        .getImageData(0, 0, el.width, el.height).data;
      let colored = 0;
      for (let i = 0; i < d.length; i += 4)
        if (d[i + 1] > d[i] * 1.5 && d[i + 3] > 200) colored++;
      return colored;
    });
  expect(colors).toBeGreaterThan(1000);
  const stage = (await page.getByTestId("viewport").boundingBox())!;
  const x = 300,
    y = 250;
  await page.mouse.move(stage.x + x, stage.y + y);
  const before = await geometry(page);
  const anchor = {
    x: (x - before.x) / before.scale,
    y: (y - before.y) / before.scale,
  };
  await zoomWithWheel(page, -120, -120, 80, -80);
  await expect
    .poll(async () => (await geometry(page)).scale)
    .toBeCloseTo(before.scale * Math.exp(0.48), 3);
  const after = await geometry(page);
  expect(Math.abs(anchor.x * after.scale + after.x - x)).toBeLessThan(
    CSS_PIXEL_TOLERANCE,
  );
  expect(Math.abs(anchor.y * after.scale + after.y - y)).toBeLessThan(
    CSS_PIXEL_TOLERANCE,
  );
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(stage.x + x + 90, stage.y + y + 60);
  await page.mouse.up({ button: "middle" });
  await expect
    .poll(async () => Math.abs((await geometry(page)).x - (after.x + 90)))
    .toBeLessThan(CSS_PIXEL_TOLERANCE);
  const pan = await geometry(page);
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(stage.x + x + 120, stage.y + y + 80);
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect
    .poll(async () => Math.abs((await geometry(page)).x - (pan.x + 30)))
    .toBeLessThan(CSS_PIXEL_TOLERANCE);
  await viewAction(page, "Nächste Seite");
  await expect(page.getByLabel("PDF-Seite 2")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await expect(page.getByTestId("page-1")).toHaveCSS("width", "400px");
  await expect(page.getByTestId("page-1")).toHaveCSS("height", "500px");
  await viewOption(page, "Ansicht", "continuous");
  await expect(page.getByTestId("page-0")).toBeAttached();
  await expect(page.getByTestId("page-2")).toBeAttached();
  await viewAction(page, "Nächste Seite");
  await expect(page.getByLabel("PDF-Seite 3")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.screenshot({
    path: `artifacts/viewer${browserName === "firefox" ? "-firefox" : ""}.png`,
  });
  expect(outbound).toEqual([]);
});
test("wheel scrolls on both axes regardless of the old profile, and replacement resets the view", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("input-profile", "mouse"),
  );
  await open(page);
  const viewport = page.getByTestId("viewport");
  const b = (await viewport.boundingBox())!;
  await expect(page.locator(".sheet")).toHaveCount(3);
  await page.mouse.move(b.x + 300, b.y + 200);
  const before = await geometry(page);
  await page.mouse.wheel(0, 60);
  await expect
    .poll(async () => Math.abs((await geometry(page)).y - (before.y - 60)))
    .toBeLessThan(CSS_PIXEL_TOLERANCE);
  expect(await geometry(page)).toMatchObject({
    x: before.x,
    scale: before.scale,
  });
  const vertical = await geometry(page);
  await page.mouse.wheel(30, 0);
  await expect
    .poll(async () => Math.abs((await geometry(page)).x - (before.x - 30)))
    .toBeLessThan(CSS_PIXEL_TOLERANCE);
  expect(await geometry(page)).toMatchObject({
    y: vertical.y,
    scale: before.scale,
  });
  await page.mouse.wheel(-30, 0);
  await expect
    .poll(async () => (await geometry(page)).x)
    .toBeCloseTo(before.x, 2);

  await viewOption(page, "Ansicht", "single");
  await viewAction(page, "Nächste Seite");
  await expect(page.locator(".sheet")).toHaveCount(1);
  await expect(page.getByLabel("PDF-Seite 2")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles("artifacts/fixture.pdf");
  await expect(page.getByTestId("viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByLabel("PDF-Seite 1")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await expect(page.locator(".sheet")).toHaveCount(3);
  await expect.poll(() => geometry(page)).toEqual(before);
  await page.getByLabel("PDF öffnen", { exact: true }).setInputFiles({
    name: "bad.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not a PDF"),
  });
  await expect(page.getByRole("alert")).toContainText("gültige PDF");
  await expect(page.getByLabel("PDF-Seite 1")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await expect(page.getByText("3 Seiten · Native Annotationen")).toBeVisible();
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles("artifacts/encrypted.pdf");
  await expect(page.getByRole("alert")).toContainText("Passwortgeschützte");
  await expect(page.getByLabel("PDF-Seite 1")).toHaveAttribute(
    "data-rendered",
    "true",
  );
});

test("touch pinch, fit controls and repeated page cache reuse", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Touch events use Chromium CDP");
  await open(page);
  const box = (await page.getByTestId("viewport").boundingBox())!;
  const session = await context.newCDPSession(page);
  const points = [
    { x: box.x + 250, y: box.y + 250, id: 1 },
    { x: box.x + 450, y: box.y + 250, id: 2 },
  ];
  const before = await geometry(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points,
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { ...points[0], x: points[0].x - 50 },
      { ...points[1], x: points[1].x + 50 },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(async () => (await geometry(page)).scale)
    .toBeCloseTo(before.scale * 1.5, 3);
  const after = await geometry(page);
  const world = {
    x: (350 - before.x) / before.scale,
    y: (250 - before.y) / before.scale,
  };
  expect(Math.abs(world.x * after.scale + after.x - 350)).toBeLessThan(
    CSS_PIXEL_TOLERANCE,
  );
  expect(Math.abs(world.y * after.scale + after.y - 250)).toBeLessThan(
    CSS_PIXEL_TOLERANCE,
  );
  await viewAction(page, "Seite einpassen");
  await expect
    .poll(async () => (await geometry(page)).scale)
    .toBeCloseTo(before.scale, 3);
  await viewAction(page, "Breite");
  await expect
    .poll(async () => (await geometry(page)).scale)
    .toBeCloseTo((box.width - 48) / 300, 3);
  for (let i = 0; i < 3; i++) {
    await viewAction(page, "Nächste Seite");
    await expect(page.getByLabel("PDF-Seite 2")).toHaveAttribute(
      "data-rendered",
      "true",
    );
    await viewAction(page, "Vorherige Seite");
    await expect(page.getByLabel("PDF-Seite 1")).toHaveAttribute(
      "data-rendered",
      "true",
    );
  }
  await page.screenshot({ path: "artifacts/viewer-first-page.png" });
});

test("WebKit-style trackpad pinch uses cumulative scales and avoids double zoom", async ({
  page,
}) => {
  await open(page);
  const viewport = page.getByTestId("viewport");
  const before = await geometry(page);
  const anchor = { x: 300, y: 250 };
  const defaultPrevented = await viewport.evaluate((el, anchor) => {
    const bounds = el.getBoundingClientRect();
    const point = {
      clientX: bounds.left + anchor.x,
      clientY: bounds.top + anchor.y,
    };
    const gesture = (type: string, scale: number) => {
      const event = Object.assign(
        new Event(type, { cancelable: true }),
        point,
        { scale },
      );
      el.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const start = gesture("gesturestart", 1);
    const first = gesture("gesturechange", 1.1);
    el.dispatchEvent(
      new WheelEvent("wheel", {
        ...point,
        ctrlKey: true,
        deltaY: -100,
        cancelable: true,
      }),
    );
    const second = gesture("gesturechange", 1.5);
    return [start, first, second, gesture("gestureend", 1.5)];
  }, anchor);
  expect(defaultPrevented).toEqual([true, true, true, true]);
  await expect
    .poll(async () => (await geometry(page)).scale)
    .toBeCloseTo(before.scale * 1.5, 3);
  const after = await geometry(page);
  expect((anchor.x - after.x) / after.scale).toBeCloseTo(
    (anchor.x - before.x) / before.scale,
    2,
  );
  expect((anchor.y - after.y) / after.scale).toBeCloseTo(
    (anchor.y - before.y) / before.scale,
    2,
  );
});

test("current page follows page bounds when a tall sheet is fitted to width", async ({
  page,
}) => {
  await open(page);
  await menu(page, "view");
  await page.getByLabel("Seite", { exact: true }).fill("3");
  await closeMenu(page);
  await viewAction(page, "Breite");
  await expect(page.getByLabel("Seite", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("PDF-Seite 3")).toHaveAttribute(
    "data-rendered",
    "true",
  );
});

test("keyboard scrolls the continuous document in CSS pixels and reaches both ends", async ({
  page,
}) => {
  await open(page);
  const viewport = page.getByTestId("viewport");
  const stage = (await viewport.boundingBox())!;
  const firstSheet = (await page.getByTestId("page-0").boundingBox())!;
  const count = page.getByRole("button", { name: "Ansicht und Navigation" });
  const initial = await geometry(page);
  expect(firstSheet.y - stage.y).toBeGreaterThanOrEqual(23.99);
  expect(firstSheet.y + firstSheet.height).toBeLessThan(stage.y + stage.height);
  await expect(viewport).toBeFocused();

  for (let i = 0; i < 3; i++) await page.keyboard.down("ArrowDown");
  await page.keyboard.up("ArrowDown");
  await expect
    .poll(async () => (await geometry(page)).y)
    .toBeCloseTo(initial.y - 120, 2);
  await page.keyboard.press("ArrowUp");
  await expect
    .poll(async () => (await geometry(page)).y)
    .toBeCloseTo(initial.y - 80, 2);
  await page.keyboard.press("PageDown");
  await expect
    .poll(async () => (await geometry(page)).y)
    .toBeCloseTo(initial.y - 80 - stage.height * 0.9, 2);
  await page.keyboard.press("PageUp");
  await expect
    .poll(async () => (await geometry(page)).y)
    .toBeCloseTo(initial.y - 80, 2);

  await page.keyboard.press("End");
  await expect(count).toContainText("3/3");
  await expect(page.getByLabel("PDF-Seite 3")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  const lastSheet = (await page.getByTestId("page-2").boundingBox())!;
  expect(lastSheet.y + lastSheet.height).toBeCloseTo(
    stage.y + stage.height - 24,
    2,
  );
  const end = await geometry(page);
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await geometry(page)).x)
    .toBeCloseTo(end.x - 40, 2);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await geometry(page)).x).toBeCloseTo(end.x, 2);
  await page.keyboard.press("PageDown");
  expect(await geometry(page)).toEqual(end);
  await page.keyboard.press("Home");
  await expect(count).toContainText("1/3");
  await expect.poll(() => geometry(page)).toEqual(initial);
});

test("single-sheet keyboard scrolls a tall page before moving to the adjoining page edge", async ({
  page,
}) => {
  await open(page);
  await viewOption(page, "Ansicht", "single");
  const viewport = page.getByTestId("viewport");
  const stage = (await viewport.boundingBox())!;
  const count = page.getByRole("button", { name: "Ansicht und Navigation" });
  await viewport.focus();
  const initial = await geometry(page);
  await expect(page.locator(".sheet")).toHaveCount(1);
  await page.keyboard.press("PageDown");
  await expect(count).toContainText("2/3");
  await expect(page.getByTestId("page-1")).toBeAttached();
  await page.keyboard.press("PageDown");
  expect(await geometry(page)).toMatchObject({ scale: initial.scale });
  const second = (await page.getByTestId("page-1").boundingBox())!;
  expect(second.y + second.height).toBeCloseTo(stage.y + stage.height - 24, 2);
  await page.keyboard.press("PageDown");
  await expect(count).toContainText("3/3");
  await expect.poll(async () => (await geometry(page)).y).toBeCloseTo(24, 2);
  await page.mouse.move(stage.x + 300, stage.y + 220);
  const third = await geometry(page);
  await page.mouse.wheel(60, 70);
  await expect
    .poll(async () => (await geometry(page)).x)
    .toBeCloseTo(third.x - 60, 2);
  await expect
    .poll(async () => (await geometry(page)).y)
    .toBeCloseTo(third.y - 70, 2);
  expect((await geometry(page)).scale).toBe(third.scale);
  await page.mouse.wheel(-60, -70);
  await expect.poll(() => geometry(page)).toEqual(third);
  await page.keyboard.press("PageDown");
  await expect
    .poll(async () => (await geometry(page)).y)
    .toBeCloseTo(24 - stage.height * 0.9, 2);
  await page.keyboard.press("ArrowDown");
  await expect
    .poll(async () => (await geometry(page)).y)
    .toBeCloseTo(24 - stage.height * 0.9 - 40, 2);
  await page.keyboard.press("End");
  const last = (await page.getByTestId("page-2").boundingBox())!;
  expect(last.y + last.height).toBeCloseTo(stage.y + stage.height - 24, 2);
  await page.keyboard.press("Home");
  await expect(count).toContainText("1/3");
  await expect.poll(() => geometry(page)).toEqual(initial);

  // Existing annotation shortcuts still work from the same focus target.
  await expect(page.locator(".annotation-list button")).toHaveCount(1);
  await page.keyboard.press("Control+a");
  await expect(page.getByTestId("selection-outline")).toHaveCount(1);
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageDown");
  await expect(count).toContainText("3/3");
  await page.keyboard.press("PageUp");
  await expect(count).toContainText("2/3");
  const previous = (await page.getByTestId("page-1").boundingBox())!;
  expect(previous.y + previous.height).toBeCloseTo(
    stage.y + stage.height - 24,
    2,
  );
  await zoomWithWheel(page, -100);
  await expect
    .poll(async () => (await geometry(page)).scale)
    .toBeGreaterThan(initial.scale);
  await expect(count).toContainText("2/3");
});

test("navigation keys leave open menus, form fields, text dialogs and modified shortcuts alone", async ({
  page,
}) => {
  await open(page);
  const viewport = page.getByTestId("viewport");
  const initial = await geometry(page);
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Control+End");
  expect(await geometry(page)).toEqual(initial);

  await menu(page, "view");
  const pageNumber = page.getByLabel("Seite", { exact: true });
  await pageNumber.focus();
  await page.keyboard.press("ArrowUp");
  await expect(pageNumber).toHaveValue("2");
  const second = await geometry(page);
  await viewport.focus();
  await page.keyboard.press("End");
  expect(await geometry(page)).toEqual(second);
  await expect(pageNumber).toHaveValue("2");
  await closeMenu(page);
  await viewport.focus();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("button", { name: "Ansicht und Navigation" }),
  ).toContainText("1/3");

  await tool(page, "FreeText");
  const sheet = (await page.getByTestId("page-0").boundingBox())!;
  await page.mouse.click(sheet.x + 100, sheet.y + 100);
  const dialog = page.getByRole("dialog", { name: "Textkommentar erstellen" });
  const input = dialog.getByLabel("Textkommentar", { exact: true });
  await input.fill("abcd");
  const beforeEditing = await geometry(page);
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("!");
  await expect(input).toHaveValue("a!bcd");
  expect(await geometry(page)).toEqual(beforeEditing);

  await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await page.mouse.click(sheet.x + 100, sheet.y + 100, { button: "right" });
  const context = page.getByRole("menu", { name: "Annotationsaktionen" });
  await expect(context).toBeVisible();
  await page.keyboard.press("End");
  await expect(context.getByRole("menuitem").last()).toBeFocused();
  expect(await geometry(page)).toEqual(beforeEditing);
});
