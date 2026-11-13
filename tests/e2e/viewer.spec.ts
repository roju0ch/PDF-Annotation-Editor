import { menu, closeMenu, viewAction, viewOption } from "./menus";
import { test, expect, type Page } from "@playwright/test";
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
    .locator("canvas")
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
  for (const delta of [-120, -120, 80, -80]) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(40);
  }
  const after = await geometry(page);
  expect(Math.abs(anchor.x * after.scale + after.x - x)).toBeLessThan(
    CSS_PIXEL_TOLERANCE,
  );
  expect(Math.abs(anchor.y * after.scale + after.y - y)).toBeLessThan(
    CSS_PIXEL_TOLERANCE,
  );
  expect(after.scale).toBeGreaterThan(before.scale);
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
  await page.screenshot({ path: "artifacts/viewer.png" });
  expect(outbound).toEqual([]);
});
test("trackpad profile pans, ctrl-wheel pinches, file replacement and rejection", async ({
  page,
}) => {
  await open(page);
  await viewOption(page, "Eingabeprofil", "trackpad");
  const b = (await page.getByTestId("viewport").boundingBox())!;
  await page.mouse.move(b.x + 300, b.y + 200);
  const before = await geometry(page);
  await page.mouse.wheel(30, 60);
  await expect
    .poll(async () => Math.abs((await geometry(page)).y - (before.y - 60)))
    .toBeLessThan(CSS_PIXEL_TOLERANCE);
  expect((await geometry(page)).scale).toBe(before.scale);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect
    .poll(async () => (await geometry(page)).scale)
    .toBeGreaterThan(before.scale);
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles("artifacts/fixture.pdf");
  await expect(page.getByLabel("PDF-Seite 1")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.getByLabel("PDF öffnen", { exact: true }).setInputFiles({
    name: "bad.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not a PDF"),
  });
  await expect(page.getByRole("alert")).toContainText("gültige PDF");
  await expect(page.locator("canvas")).toHaveCount(0);
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles("artifacts/encrypted.pdf");
  await expect(page.getByRole("alert")).toContainText("Passwortgeschützte");
});

test("touch pinch, fit controls and repeated page cache reuse", async ({
  page,
  context,
}) => {
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

test("current page follows page bounds when a tall sheet is fitted to width", async ({
  page,
}) => {
  await open(page);
  await viewOption(page, "Ansicht", "continuous");
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
