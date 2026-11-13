import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import * as mupdf from "mupdf";
import { AnnotationEditor } from "../../src/adapters/pdf/annotations";
import { inverse, transform } from "../../src/core/viewport";
import { selectionRect } from "../../src/core/annotations/selection";
import { menu, closeMenu, viewAction } from "./menus";

test.beforeAll(async () => {
  const bytes = new Uint8Array(await readFile("artifacts/fixture.pdf"));
  const doc = new mupdf.PDFDocument(bytes);
  try {
    const editor = new AnnotationEditor(doc, bytes);
    for (const index of [0, 1]) {
      const p = doc.loadPage(index),
        matrix = inverse(p.getTransform()),
        bounds = p.getBounds();
      const pdf = (x: number, y: number) =>
        transform({ x: x + bounds[0], y: y + bounds[1] }, matrix);
      p.destroy();
      for (const [name, x0, y0, x1, y1] of [
        ["A", 50, 140, 140, 140],
        ["B", 100, 200, 210, 200],
      ] as const) {
        editor.apply({
          action: "create",
          page: index,
          kind: "Ink",
          rect: [0, 0, 1, 1],
          ink: [[pdf(x0, y0), pdf(x1, y1)]],
          contents: name,
          color: "#ff0000",
          width: 3,
          fontSize: 14,
        });
      }
      editor.apply({
        action: "create",
        page: index,
        kind: "Text",
        rect: selectionRect(pdf(210, 175), pdf(234, 199)),
        contents: "C",
        color: "#ff0000",
        width: 3,
        fontSize: 14,
      });
      editor.apply({
        action: "create",
        page: index,
        kind: "FreeText",
        rect: selectionRect(pdf(60, 280), pdf(240, 320)),
        contents: "Unverändert",
        color: "#ff0000",
        width: 3,
        fontSize: 14,
      });
    }
    await writeFile("artifacts/selection-fixture.pdf", editor.export());
  } finally {
    doc.destroy();
  }
});
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
      await page.mouse.wheel(0, -80);
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
  await touch("touchStart", [{ ...(await point(page, 90, 130)), id: 1 }]);
  await touch("touchMove", [{ ...(await point(page, 220, 215)), id: 1 }]);
  await page.screenshot({ path: "artifacts/marquee-mobile.png" });
  await touch("touchEnd", []);
  await expect(page.getByTestId("selection-outline")).toHaveCount(3);
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
