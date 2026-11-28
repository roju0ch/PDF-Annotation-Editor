import { expect, test, type Page } from "@playwright/test";
import * as mupdf from "mupdf";
import { zoomWithWheel } from "./viewerInput";

const WIDTH = 600;
const HEIGHT = 440;
const PAGE_COUNT = 40;
const viewport = (page: Page) => page.getByTestId("viewport");

function pdf(fileName: string, count: number) {
  const document = new mupdf.PDFDocument();
  try {
    for (let i = 0; i < count; i++) {
      document.insertPage(
        -1,
        document.addPage(
          [0, 0, WIDTH, HEIGHT],
          0,
          {},
          `0.1 0.5 0.4 rg 30 30 ${100 + i} 100 re f`,
        ),
      );
    }
    const result = document.saveToBuffer("");
    try {
      return {
        name: fileName,
        mimeType: "application/pdf",
        buffer: Buffer.from(result.asUint8Array()),
      };
    } finally {
      result.destroy();
    }
  } finally {
    document.destroy();
  }
}

async function load(page: Page, fileName: string, count: number) {
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles(pdf(fileName, count));
  await expect(page.getByTestId("viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByRole("button", { name: "Ansicht und Navigation" }),
  ).toContainText(`/${count}`);
}

async function firstPageRendered(page: Page) {
  await expect(page.getByLabel("PDF-Seite 1", { exact: true })).toHaveAttribute(
    "data-rendered",
    "true",
  );
}

async function open(page: Page) {
  await page.setViewportSize({ width: 480, height: 860 });
  await page.goto("");
  await load(page, "40 pages.pdf", PAGE_COUNT);
  await firstPageRendered(page);
}

async function position(page: Page) {
  return page.getByTestId("world").evaluate((el) => {
    const matrix = new DOMMatrix(getComputedStyle(el).transform);
    return { x: matrix.e, y: matrix.f, scale: matrix.a };
  });
}

async function simulatePointerAndFrames(page: Page) {
  // Untrusted pointer events can exercise the same gesture path on all engines.
  // Real capture and OS-style cancellation are also exercised with Chromium CDP.
  await viewport(page).evaluate((el) => {
    el.setPointerCapture = () => {};
  });
  const start = new Date("2026-01-01T00:00:00Z");
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 1000));

  return (
    type:
      | "pointerdown"
      | "pointermove"
      | "pointerup"
      | "pointercancel"
      | "lostpointercapture",
    x: number,
    y: number,
    time: number,
    id = 1,
  ) =>
    viewport(page).evaluate(
      (el, { type, x, y, time, id }) => {
        const bounds = el.getBoundingClientRect();
        const event = new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerType: "touch",
          pointerId: id,
          clientX: bounds.x + x,
          clientY: bounds.y + y,
        });
        Object.defineProperty(event, "timeStamp", { value: time });
        el.dispatchEvent(event);
      },
      { type, x, y, time, id },
    );
}

test("the finger controls the view directly and a fast swipe coasts several pages", async ({
  page,
}) => {
  await open(page);
  const pointer = await simulatePointerAndFrames(page);
  const start = await position(page);
  await pointer("pointerdown", 150, 600, 0);
  await pointer("pointermove", 150, 596, 40);
  expect(await position(page)).toEqual(start);
  await pointer("pointermove", 150, 580, 200);
  await expect
    .poll(async () => (await position(page)).y)
    .toBeCloseTo(start.y - 20, 1);
  await pointer("pointerup", 150, 580, 200);
  await page.clock.runFor(1200);
  expect(await position(page)).toMatchObject({ y: start.y - 20 });

  await pointer("pointerdown", 150, 600, 300);
  await pointer("pointermove", 150, 530, 315);
  await pointer("pointermove", 150, 440, 332);
  await expect
    .poll(async () => (await position(page)).y)
    .toBeCloseTo(start.y - 180, 1);
  await pointer("pointerup", 150, 440, 332);
  // Normal loss of capture after pointerup must leave the glide running.
  await pointer("lostpointercapture", 150, 440, 333);
  await page.clock.runFor(100);
  const early = (await position(page)).y;
  await page.clock.runFor(8);
  await expect(page.getByLabel("PDF-Seite 4", { exact: true })).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.clock.runFor(92);
  const later = (await position(page)).y;
  expect(start.y - 180 - early).toBeGreaterThan(250);
  expect(early - later).toBeGreaterThan(100);
  expect(early - later).toBeLessThan(start.y - 180 - early);
  await page.clock.runFor(1100);
  const stopped = await position(page);
  expect(stopped.y).toBeLessThan(start.y - 1050);
  await expect
    .poll(async () =>
      Number(await page.getByLabel("Seite", { exact: true }).inputValue()),
    )
    .toBeGreaterThanOrEqual(4);
  await page.clock.runFor(300);
  expect(await position(page)).toEqual(stopped);
});

test("touch interrupts immediately, a new swipe reverses direction and pinch leaves no inertia", async ({
  page,
}) => {
  await open(page);
  const pointer = await simulatePointerAndFrames(page);
  await pointer("pointerdown", 170, 600, 0);
  await pointer("pointermove", 170, 390, 36);
  await pointer("pointerup", 170, 390, 37);
  await page.clock.runFor(160);
  await pointer("pointerdown", 170, 400, 200);
  const caught = await position(page);
  await page.clock.runFor(80);
  expect(await position(page)).toEqual(caught);

  await pointer("pointermove", 170, 520, 230);
  await expect
    .poll(async () => (await position(page)).y)
    .toBeCloseTo(caught.y + 120, 1);
  await pointer("pointerup", 170, 520, 230);
  await page.clock.runFor(80);
  expect((await position(page)).y).toBeGreaterThan(caught.y + 220);

  await pointer("pointerdown", 150, 410, 320);
  const beforePinch = await position(page);
  await pointer("pointerdown", 280, 410, 321, 2);
  await pointer("pointermove", 350, 410, 340, 2);
  await expect
    .poll(async () => (await position(page)).scale)
    .toBeGreaterThan(beforePinch.scale * 1.4);
  await pointer("pointerup", 350, 410, 341, 2);
  await pointer("pointermove", 150, 340, 354);
  await expect
    .poll(async () => (await position(page)).y)
    .not.toBe(beforePinch.y);
  await pointer("pointerup", 150, 340, 355);
  const afterPinch = await position(page);
  await page.clock.runFor(1200);
  expect(await position(page)).toEqual(afterPinch);
});

test("a held finger, cancelled capture and reduced motion leave the view at the drag position", async ({
  page,
}) => {
  await open(page);
  const pointer = await simulatePointerAndFrames(page);
  for (const [index, end] of (
    ["pointerup", "pointercancel", "lostpointercapture", "pointerup"] as const
  ).entries()) {
    if (index === 3) await page.emulateMedia({ reducedMotion: "reduce" });
    const start = await position(page);
    await pointer("pointerdown", 165, 620, 0);
    await pointer("pointermove", 165, 550, 15);
    await pointer("pointermove", 165, 470, 32);
    await expect
      .poll(async () => (await position(page)).y)
      .toBeCloseTo(start.y - 150, 1);
    if (index === 0) await page.clock.runFor(170);
    await pointer(end, 165, 470, index === 0 ? 202 : 33);
    const dragged = await position(page);
    await page.clock.runFor(1200);
    expect(await position(page)).toEqual(dragged);
  }
});

test("momentum stops at both document ends and reaches the horizontal bound after zoom", async ({
  page,
}) => {
  await open(page);
  const pointer = await simulatePointerAndFrames(page);
  const view = viewport(page);
  await view.press("Home");
  const first = await position(page);
  await view.press("ArrowDown");
  await view.press("ArrowDown");
  await expect
    .poll(async () => (await position(page)).y)
    .toBeCloseTo(first.y - 80, 1);
  await pointer("pointerdown", 150, 500, 0);
  await pointer("pointermove", 150, 530, 16);
  await pointer("pointerup", 150, 530, 17);
  await page.clock.runFor(150);
  expect(await position(page)).toEqual(first);
  await page.clock.runFor(1000);
  expect(await position(page)).toEqual(first);

  await view.press("End");
  await expect(page.getByLabel("Seite", { exact: true })).toHaveValue(
    String(PAGE_COUNT),
  );
  const last = await position(page);
  await view.press("ArrowUp");
  await view.press("ArrowUp");
  await expect
    .poll(async () => (await position(page)).y)
    .toBeCloseTo(last.y + 80, 1);
  await pointer("pointerdown", 150, 530, 0);
  await pointer("pointermove", 150, 500, 16);
  await pointer("pointerup", 150, 500, 17);
  await page.clock.runFor(150);
  expect(await position(page)).toEqual(last);
  await page.clock.runFor(1000);
  expect(await position(page)).toEqual(last);

  await view.press("Home");
  const bounds = (await view.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 220);
  await zoomWithWheel(page, -200, -200);
  await expect
    .poll(async () => (await position(page)).scale)
    .toBeGreaterThan(first.scale * 2);
  const zoomed = await position(page);
  const right = bounds.width - WIDTH * zoomed.scale - 24;
  await pointer("pointerdown", 375, 600, 0);
  await pointer("pointermove", 215, 560, 28);
  await expect
    .poll(async () => (await position(page)).x)
    .toBeCloseTo(zoomed.x - 160, 1);
  await pointer("pointerup", 215, 560, 29);
  await page.clock.runFor(130);
  expect((await position(page)).x).toBeCloseTo(right, 1);
  const yAtEdge = (await position(page)).y;
  await page.clock.runFor(250);
  expect((await position(page)).x).toBeCloseTo(right, 1);
  expect((await position(page)).y).toBeLessThan(yAtEdge - 20);
});

test("replacing the PDF during momentum leaves the new document fitted", async ({
  page,
}) => {
  await open(page);
  const pointer = await simulatePointerAndFrames(page);
  const fitted = await position(page);
  await pointer("pointerdown", 180, 600, 0);
  await pointer("pointermove", 180, 390, 32);
  await pointer("pointerup", 180, 390, 32);
  await page.clock.runFor(120);
  expect((await position(page)).y).toBeLessThan(fitted.y - 400);
  await load(page, "replacement.pdf", 6);
  await page.clock.runFor(1200);
  expect(await position(page)).toEqual(fitted);
  await page.clock.resume();
  await firstPageRendered(page);
});

test("Chromium touch input releases into momentum and touchCancel prevents it", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Native touch injection uses Chromium CDP.",
  );
  await open(page);
  const session = await context.newCDPSession(page);
  const bounds = (await viewport(page).boundingBox())!;
  const start = { x: bounds.x + 170, y: bounds.y + 600, id: 1 };
  const before = await position(page);
  const swipe = async (end: "touchEnd" | "touchCancel") => {
    const timestamp = Date.now() / 1000;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [start],
      timestamp,
    });
    for (const [index, distance] of [90, 180].entries()) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ ...start, y: start.y - distance }],
        timestamp: timestamp + (index + 1) * 0.018,
      });
    }
    await session.send("Input.dispatchTouchEvent", {
      type: end,
      touchPoints: [],
      timestamp: timestamp + 0.038,
    });
  };
  await swipe("touchCancel");
  await expect
    .poll(async () => (await position(page)).y)
    .toBeCloseTo(before.y - 180, 1);
  // Give the browser enough frames to detect any erroneous motion after cancel.
  await page.waitForTimeout(120);
  expect((await position(page)).y).toBeCloseTo(before.y - 180, 1);
  await swipe("touchEnd");
  await expect
    .poll(async () => (await position(page)).y)
    .toBeLessThan(before.y - 540);
});
