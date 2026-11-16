import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import * as mupdf from "mupdf";
import { menu, closeMenu, tool } from "./menus";
import { compositedRaster } from "./compositedRaster";

const fixture = "artifacts/text-workflow-fixture.pdf";
const dialogName = "Textkommentar erstellen";
const names = {
  select: "Auswählen / Verschieben",
  Ink: "Freihand",
  Text: "Notiz",
  FreeText: "Textfeld",
  erase: "Ink-Teilradierer (Klick)",
};
test.beforeAll(async () => {
  const doc = new mupdf.PDFDocument();
  try {
    doc.insertPage(
      -1,
      doc.addPage([0, 0, 320, 480], 0, {}, "0.1 0.2 0.6 rg 0 0 320 480 re f"),
    );
    const bytes = doc.saveToBuffer("compress=yes");
    try {
      await writeFile(fixture, bytes.asUint8Array());
    } finally {
      bytes.destroy();
    }
  } finally {
    doc.destroy();
  }
});
async function open(page: Page) {
  await page.goto("");
  await page.getByLabel("PDF öffnen", { exact: true }).setInputFiles(fixture);
  await expect(page.getByLabel("PDF-Seite 1", { exact: true })).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await expect(page.locator(".annotation-list button")).toHaveCount(0);
}
async function point(page: Page, x: number, y: number) {
  const box = (await page.getByTestId("page-0").boundingBox())!;
  return {
    x: box.x + (x / 320) * box.width,
    y: box.y + (y / 480) * box.height,
  };
}
async function place(page: Page, x = 40, y = 80) {
  const p = await point(page, x, y);
  await page.mouse.click(p.x, p.y);
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function exportPdf(page: Page, name: string) {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PDF herunterladen", exact: true })
    .click();
  const file = await pending;
  await file.saveAs(name);
  return new mupdf.PDFDocument(new Uint8Array(await readFile(name)));
}
async function selected(page: Page, value: keyof typeof names) {
  await expect(
    page.getByRole("button", { name: names[value], exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
}

test("Escape leaves every drawing tool, cancels an unfinished stroke and clears explicit selection", async ({
  page,
}) => {
  await open(page);
  for (const value of ["Ink", "Text", "FreeText", "erase"] as const) {
    await tool(page, value);
    await selected(page, value);
    await page.keyboard.press("Escape");
    await selected(page, "select");
  }
  await tool(page, "Ink");
  const from = await point(page, 40, 180),
    to = await point(page, 180, 188);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await selected(page, "select");
  await expect(page.locator(".annotation-list button")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Rückgängig", exact: true }),
  ).toBeDisabled();
  await tool(page, "Text", "Ausdrücklich auswählen");
  const p = await point(page, 120, 220);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator(".annotation-list button")).toHaveCount(1);
  await expect(page.getByTestId("selection-outline")).toHaveCount(0);
  await selected(page, "Text");
  await page.keyboard.press("Escape");
  await selected(page, "select");
  await page.mouse.click(p.x + 4, p.y + 4);
  await expect(page.getByTestId("selection-outline")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("selection-outline")).toHaveCount(0);
  await expect(page.locator(".annotation-list button")).toHaveCount(1);
});

test("two successive strokes stay unselected and export as two native Ink annotations", async ({
  page,
  browserName,
}) => {
  await open(page);
  await tool(page, "Ink");
  for (let i = 0; i < 2; i++) {
    const start = await point(page, 40, 140 + i * 55),
      end = await point(page, 230, 148 + i * 55);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator(".annotation-list button")).toHaveCount(i + 1);
    await expect(page.getByTestId("selection-outline")).toHaveCount(0);
    await expect(page.locator('[data-testid^="image-resize-"]')).toHaveCount(0);
    await expect(page.locator(".properties")).toHaveCount(0);
    await selected(page, "Ink");
  }
  const doc = await exportPdf(
      page,
      `artifacts/repeated-ink-${browserName}.pdf`,
    ),
    pdfPage = doc.loadPage(0);
  try {
    const annotations = pdfPage.getAnnotations();
    expect(annotations.map((a) => a.getType())).toEqual(["Ink", "Ink"]);
    for (const annotation of annotations) {
      expect(annotation.getInkList()[0].length).toBeGreaterThan(2);
      expect(annotation.getObject().get("AP", "N").isStream()).toBe(true);
    }
  } finally {
    pdfPage.destroy();
    doc.destroy();
  }
});

test("empty dialog, multiline appearance, persisted styles and native FreeText roundtrip", async ({
  page,
  browserName,
}) => {
  await open(page);
  await tool(page, "FreeText");
  const dialog = await place(page),
    input = dialog.getByLabel("Textkommentar", { exact: true });
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("maxlength", "10000");
  await expect(
    dialog.getByRole("button", { name: "OK", exact: true }),
  ).toBeDisabled();
  await input.fill("Erste Zeile");
  await input.press("Enter");
  await input.press("Enter");
  await input.pressSequentially("Dritte Zeile");
  await input.press("Enter");
  await input.pressSequentially("Vierte Zeile");
  const contents = "Erste Zeile\n\nDritte Zeile\nVierte Zeile";
  await expect(input).toHaveValue(contents);
  await expect(dialog).toBeVisible();
  await expect(page.locator(".annotation-list button")).toHaveCount(0);
  await dialog.getByLabel("Schriftgröße", { exact: true }).fill("18");
  await dialog.getByLabel("Textfarbe", { exact: true }).fill("#cc1133");
  await dialog.getByLabel("Hintergrundfarbe", { exact: true }).fill("#fff1a8");
  await dialog
    .getByLabel("Transparenter Hintergrund", { exact: true })
    .uncheck();
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".annotation-list button")).toHaveCount(1);
  await expect(page.getByTestId("selection-outline")).toHaveCount(0);
  await selected(page, "FreeText");
  await expect
    .poll(
      async () =>
        (await compositedRaster(page, 0, { region: [40, 80, 180, 120] })).red,
    )
    .toBeGreaterThan(40);
  const output = `artifacts/multiline-comment-${browserName}.pdf`;
  const doc = await exportPdf(page, output),
    pdfPage = doc.loadPage(0);
  try {
    expect(doc.wasRepaired()).toBe(false);
    const annotations = pdfPage.getAnnotations();
    expect(annotations).toHaveLength(1);
    const annotation = annotations[0];
    expect(annotation.getType()).toBe("FreeText");
    expect(annotation.getContents()).toBe(contents);
    expect(annotation.getDefaultAppearance().size).toBe(18);
    expect(
      annotation.getDefaultAppearance().color.map((c) => Math.round(c * 255)),
    ).toEqual([204, 17, 51]);
    expect(annotation.getObject().get("AP", "N").isStream()).toBe(true);
    const bounds = annotation.getBounds();
    expect(bounds[0]).toBeCloseTo(40, 0);
    expect(bounds[1]).toBeCloseTo(80, 0);
    expect(bounds[2] - bounds[0]).toBeGreaterThan(80);
    expect(bounds[3] - bounds[1]).toBeGreaterThan(72);
    const list = annotation.toDisplayList(),
      text = list.toStructuredText("");
    try {
      expect(text.asText()).toContain("Erste Zeile");
      expect(text.asText()).toContain("Dritte Zeile");
      expect(text.asText()).toContain("Vierte Zeile");
      const lines: mupdf.Rect[] = [];
      text.walk({ beginLine: (box) => lines.push(box) });
      expect(lines).toHaveLength(3);
      // All three visible lines fit in the actual exported appearance, and
      // the deliberately empty second line contributes real vertical space.
      for (const line of lines) {
        expect(line[0]).toBeGreaterThanOrEqual(bounds[0] - 0.5);
        expect(line[1]).toBeGreaterThanOrEqual(bounds[1] - 0.5);
        expect(line[2]).toBeLessThanOrEqual(bounds[2] + 0.5);
        expect(line[3]).toBeLessThanOrEqual(bounds[3] + 0.5);
      }
      expect(lines[1][1] - lines[0][1]).toBeGreaterThan(
        (lines[2][1] - lines[1][1]) * 1.5,
      );
    } finally {
      text.destroy();
      list.destroy();
    }
    const pixmap = annotation.toPixmap(
      [2, 0, 0, 2, 0, 0],
      mupdf.ColorSpace.DeviceRGB,
      true,
    );
    try {
      const pixels = pixmap.getPixels();
      let background = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (
          pixels[i] > 250 &&
          pixels[i + 1] > 235 &&
          pixels[i + 1] < 245 &&
          pixels[i + 2] > 160 &&
          pixels[i + 2] < 175
        )
          background++;
      expect(background).toBeGreaterThan(100);
    } finally {
      pixmap.destroy();
    }
  } finally {
    pdfPage.destroy();
    doc.destroy();
  }
  const next = await place(page, 40, 300);
  await expect(next.getByLabel("Textkommentar", { exact: true })).toHaveValue(
    "",
  );
  await expect(next.getByLabel("Textfarbe", { exact: true })).toHaveValue(
    "#cc1133",
  );
  await expect(
    next.getByLabel("Hintergrundfarbe", { exact: true }),
  ).toHaveValue("#fff1a8");
  await expect(next.getByLabel("Schriftgröße", { exact: true })).toHaveValue(
    "18",
  );
  await expect(
    next.getByLabel("Transparenter Hintergrund", { exact: true }),
  ).not.toBeChecked();
  await next.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await page.getByLabel("PDF öffnen", { exact: true }).setInputFiles(output);
  await expect(page.locator(".annotation-list button")).toHaveCount(1);
  await menu(page, "annotations");
  await page.locator(".annotation-list button").click();
  await expect(
    page.getByLabel("Annotationsinhalt", { exact: true }),
  ).toHaveValue(contents);
  await expect(
    page.getByLabel("Annotationsschriftgröße", { exact: true }),
  ).toHaveValue("18");
  await closeMenu(page);
  await page.reload();
  await page.getByLabel("PDF öffnen", { exact: true }).setInputFiles(output);
  await expect(page.getByLabel("PDF-Seite 1", { exact: true })).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await tool(page, "FreeText");
  const afterReload = await place(page, 40, 300);
  await expect(
    afterReload.getByLabel("Textkommentar", { exact: true }),
  ).toHaveValue("");
  await expect(
    afterReload.getByLabel("Textfarbe", { exact: true }),
  ).toHaveValue("#cc1133");
  await expect(
    afterReload.getByLabel("Hintergrundfarbe", { exact: true }),
  ).toHaveValue("#fff1a8");
  await expect(
    afterReload.getByLabel("Schriftgröße", { exact: true }),
  ).toHaveValue("18");
});

test("Cancel and Escape create no PDF object or undo entry and whitespace cannot be submitted", async ({
  page,
  browserName,
}) => {
  await open(page);
  await tool(page, "FreeText");
  let dialog = await place(page);
  await dialog.getByLabel("Textkommentar", { exact: true }).fill("  \n\n  ");
  await expect(
    dialog.getByRole("button", { name: "OK", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Textkommentar", { exact: true })
    .fill("Abbrechen darf nichts anlegen");
  await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await tool(page, "FreeText");
  dialog = await place(page, 80, 260);
  await expect(dialog.getByLabel("Textkommentar", { exact: true })).toHaveValue(
    "",
  );
  await dialog
    .getByLabel("Textkommentar", { exact: true })
    .fill("Escape darf nichts anlegen");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await selected(page, "select");
  await expect(page.locator(".annotation-list button")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Rückgängig", exact: true }),
  ).toBeDisabled();
  const doc = await exportPdf(
      page,
      `artifacts/cancelled-comments-${browserName}.pdf`,
    ),
    pdfPage = doc.loadPage(0);
  try {
    expect(pdfPage.getAnnotations()).toHaveLength(0);
  } finally {
    pdfPage.destroy();
    doc.destroy();
  }
});

test("editing text properties updates native colors, transparency and automatic size without losing selection", async ({
  page,
  browserName,
}) => {
  await open(page);
  await tool(page, "FreeText");
  const dialog = await place(page);
  await dialog
    .getByLabel("Textkommentar", { exact: true })
    .fill("Erste lange Zeile\nZweite lange Zeile\nDritte lange Zeile");
  await dialog.getByLabel("Schriftgröße", { exact: true }).fill("20");
  await dialog
    .getByLabel("Transparenter Hintergrund", { exact: true })
    .uncheck();
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".annotation-list button")).toHaveCount(1);
  const before = await exportPdf(
      page,
      `artifacts/text-properties-before-${browserName}.pdf`,
    ),
    originalPage = before.loadPage(0);
  let originalHeight: number;
  try {
    const bounds = originalPage.getAnnotations()[0].getBounds();
    originalHeight = bounds[3] - bounds[1];
  } finally {
    originalPage.destroy();
    before.destroy();
  }
  await tool(page, "select");
  await menu(page, "annotations");
  await page.locator(".annotation-list button").click();
  await page.getByLabel("Annotationsinhalt", { exact: true }).fill("Kurz");
  await page.getByLabel("Annotationsschriftgröße", { exact: true }).fill("12");
  await page.getByLabel("Annotationsfarbe", { exact: true }).fill("#0055aa");
  await page
    .getByLabel("Annotationshintergrundfarbe", { exact: true })
    .fill("#baf0c0");
  await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Übernehmen", exact: true }),
  ).toBeDisabled();
  await expect(page.getByTestId("selection-outline")).toHaveCount(1);
  await closeMenu(page);
  const edited = await exportPdf(
      page,
      `artifacts/text-properties-edited-${browserName}.pdf`,
    ),
    editedPage = edited.loadPage(0);
  try {
    const annotation = editedPage.getAnnotations()[0],
      bounds = annotation.getBounds();
    expect(annotation.getContents()).toBe("Kurz");
    expect(annotation.getDefaultAppearance().size).toBe(12);
    expect(
      annotation.getDefaultAppearance().color.map((c) => Math.round(c * 255)),
    ).toEqual([0, 85, 170]);
    expect(annotation.getColor().map((c) => Math.round(c * 255))).toEqual([
      186, 240, 192,
    ]);
    expect(bounds[3] - bounds[1]).toBeLessThan(originalHeight);
    const list = annotation.toDisplayList(),
      text = list.toStructuredText("");
    try {
      expect(text.asText()).toContain("Kurz");
    } finally {
      text.destroy();
      list.destroy();
    }
  } finally {
    editedPage.destroy();
    edited.destroy();
  }
  await menu(page, "annotations");
  await page
    .getByLabel("Annotationshintergrund transparent", { exact: true })
    .check();
  await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Übernehmen", exact: true }),
  ).toBeDisabled();
  await expect(page.getByTestId("selection-outline")).toHaveCount(1);
  await closeMenu(page);
  const transparent = await exportPdf(
      page,
      `artifacts/text-properties-transparent-${browserName}.pdf`,
    ),
    transparentPage = transparent.loadPage(0);
  try {
    const annotation = transparentPage.getAnnotations()[0];
    expect(annotation.getType()).toBe("FreeText");
    expect(annotation.getContents()).toBe("Kurz");
    expect(annotation.getColor()).toHaveLength(0);
    expect(annotation.getObject().get("AP", "N").isStream()).toBe(true);
    const pixmap = annotation.toPixmap(
      [2, 0, 0, 2, 0, 0],
      mupdf.ColorSpace.DeviceRGB,
      true,
    );
    try {
      let clear = 0;
      const pixels = pixmap.getPixels();
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 10) clear++;
      expect(clear).toBeGreaterThan(100);
    } finally {
      pixmap.destroy();
    }
  } finally {
    transparentPage.destroy();
    transparent.destroy();
  }
});

test("failed native creation preserves entered text for a successful retry", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    let failed = false;
    Worker.prototype.postMessage = function (message, options) {
      if (
        !failed &&
        message?.type === "edit" &&
        message.command?.action === "create" &&
        message.command.kind === "FreeText"
      ) {
        failed = true;
        queueMicrotask(() =>
          this.dispatchEvent(
            new MessageEvent("message", {
              data: {
                id: message.id,
                error:
                  "Synthetischer PDF-Schreibfehler; bitte erneut versuchen.",
              },
            }),
          ),
        );
        return;
      }
      return Reflect.apply(
        send,
        this,
        options === undefined ? [message] : [message, options],
      );
    };
  });
  await open(page);
  await tool(page, "FreeText");
  const dialog = await place(page),
    input = dialog.getByLabel("Textkommentar", { exact: true });
  await input.fill("Dieser Text muss nach dem Fehler bleiben.");
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Synthetischer PDF-Schreibfehler");
  await expect(input).toHaveValue("Dieser Text muss nach dem Fehler bleiben.");
  await expect(page.locator(".annotation-list button")).toHaveCount(0);
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".annotation-list button")).toHaveCount(1);
  await expect(page.getByTestId("selection-outline")).toHaveCount(0);
});

test("Escape from pending object properties neither saves nor discards the text", async ({
  page,
  browserName,
}) => {
  await open(page);
  await tool(page, "Text", "Ursprünglicher Kommentar");
  const p = await point(page, 120, 220);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator(".annotation-list button")).toHaveCount(1);
  await tool(page, "select");
  await menu(page, "annotations");
  await page.locator(".annotation-list button").click();
  await page
    .getByLabel("Annotationsinhalt", { exact: true })
    .fill("Unbestätigter Entwurf");
  await page.keyboard.press("Escape");
  await expect(page.locator("#annotations-menu")).not.toBeVisible();
  await menu(page, "annotations");
  await expect(
    page.getByLabel("Annotationsinhalt", { exact: true }),
  ).toHaveValue("Unbestätigter Entwurf");
  await expect(
    page.getByRole("button", { name: "PDF herunterladen", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Verwerfen", exact: true }).click();
  await expect(
    page.getByLabel("Annotationsinhalt", { exact: true }),
  ).toHaveValue("Ursprünglicher Kommentar");
  await closeMenu(page);
  const doc = await exportPdf(
      page,
      `artifacts/escape-pending-properties-${browserName}.pdf`,
    ),
    pdfPage = doc.loadPage(0);
  try {
    expect(pdfPage.getAnnotations().map((a) => a.getContents())).toEqual([
      "Ursprünglicher Kommentar",
    ]);
  } finally {
    pdfPage.destroy();
    doc.destroy();
  }
});

test("mobile touch dialog fits the viewport, traps focus and blocks editor shortcuts", async ({
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
  await tool(page, "FreeText");
  const p = await point(page, 60, 150),
    session = await context.newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...p, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const dialog = page.getByRole("dialog", { name: dialogName }),
    input = dialog.getByLabel("Textkommentar", { exact: true });
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill("Touch-Kommentar\nZweite Zeile");
  await page.screenshot({ path: "artifacts/text-comment-dialog-mobile.png" });
  await page.keyboard.press("Control+s");
  await expect(dialog).toBeVisible();
  await expect(page.locator(".annotation-list button")).toHaveCount(0);
  const rect = (await dialog.boundingBox())!;
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(391);
  expect(rect.y + rect.height).toBeLessThanOrEqual(845);
  // A smaller available viewport exercises the layout used when a phone's
  // on-screen keyboard consumes the lower part of the screen.
  await page.setViewportSize({ width: 390, height: 450 });
  const reduced = (await dialog.boundingBox())!;
  expect(reduced.y).toBeGreaterThanOrEqual(0);
  expect(reduced.y + reduced.height).toBeLessThanOrEqual(451);
  await page.screenshot({ path: "artifacts/text-comment-dialog-keyboard.png" });
  await input.press("Shift+Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("dialog")),
  ).toBe(true);
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest("dialog")),
    ).toBe(true);
  }
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".annotation-list button")).toHaveCount(1);
  await selected(page, "FreeText");
  await expect(page.getByTestId("selection-outline")).toHaveCount(0);
  await page.screenshot({ path: "artifacts/text-comment-mobile.png" });
});
