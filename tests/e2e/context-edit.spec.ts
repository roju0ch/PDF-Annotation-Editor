import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import * as mupdf from "mupdf";
import { AnnotationEditor } from "../../src/adapters/pdf/annotations";
import { inverse, transform } from "../../src/core/viewport";
import { selectionRect } from "../../src/core/annotations/selection";
import { tool, viewAction } from "./menus";

const fixture = "artifacts/context-edit-fixture.pdf";
const ownText = "Eigener Kommentar\nZweite Zeile";
const foreignText = "Fremdes Textfeld";
const noteText = "Vorhandene Haftnotiz";
const actions = { name: "Annotationsaktionen" };

test.beforeAll(async () => {
  const input = new Uint8Array(await readFile("artifacts/fixture.pdf"));
  const doc = new mupdf.PDFDocument(input);
  const pix = new mupdf.Pixmap(
    mupdf.ColorSpace.DeviceRGB,
    [0, 0, 20, 10],
    true,
  );
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    pix.clear(255);
    const pixels = pix.getPixels();
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 25;
      pixels[i + 1] = 170;
      pixels[i + 2] = 90;
    }
    const image = new Uint8Array(pix.asPNG());
    const editor = new AnnotationEditor(doc, input);
    for (const index of [0, 1]) {
      const p = doc.loadPage(index),
        matrix = inverse(p.getTransform());
      const pdf = (x: number, y: number) => transform({ x, y }, matrix);
      p.destroy();
      for (const [contents, kind, x, y, w, h] of [
        [ownText, "FreeText", 35, 70, 1, 1],
        [foreignText, "FreeText", 40, 220, 180, 65],
        [noteText, "Text", 220, 130, 24, 24],
        ["Gesperrtes Textfeld", "FreeText", 220, 210, 24, 24],
        ["Geschützter RichText", "FreeText", 40, 295, 150, 30],
      ] as const) {
        editor.apply({
          action: "create",
          page: index,
          kind,
          rect: selectionRect(pdf(x, y), pdf(x + w, y + h)),
          anchor: pdf(x, y),
          autoSize: contents === ownText,
          contents,
          color: "#123456",
          backgroundColor: "#fff0a0",
          width: 1,
          fontSize: 14,
        });
      }
      editor.apply({
        action: "create",
        page: index,
        kind: "Ink",
        rect: [0, 0, 1, 1],
        ink: [[pdf(40, 340), pdf(140, 370)]],
        contents: "Unveränderte Linie",
        color: "#ff0000",
        width: 3,
        fontSize: 14,
      });
      editor.apply({
        action: "create-image",
        page: index,
        rect: selectionRect(pdf(200, 330), pdf(260, 360)),
        bytes: image,
        contents: "Unverändertes Bild",
      });
    }
    bytes = editor.export();
  } finally {
    pix.destroy();
    doc.destroy();
  }
  const protectedDoc = new mupdf.PDFDocument(bytes);
  try {
    for (const index of [0, 1]) {
      const p = protectedDoc.loadPage(index);
      try {
        for (const a of p.getAnnotations()) {
          if (a.getContents() === "Gesperrtes Textfeld")
            a.setFlags(a.getFlags() | mupdf.PDFAnnotation.IS_LOCKED);
          if (a.getContents() === "Geschützter RichText")
            a.getObject().put(
              "RC",
              protectedDoc.newString("<body><p>RichText</p></body>"),
            );
        }
      } finally {
        p.destroy();
      }
    }
    const buffer = protectedDoc.saveToBuffer("compress=yes");
    try {
      await writeFile(fixture, buffer.asUint8Array());
    } finally {
      buffer.destroy();
    }
  } finally {
    protectedDoc.destroy();
  }
});

function snapshot(doc: mupdf.PDFDocument, index: number) {
  const p = doc.loadPage(index);
  try {
    return p.getAnnotations().map((a) => {
      const type = a.getType();
      return {
        id: a.getObject().asIndirect(),
        type,
        contents: a.getContents(),
        rect: type === "Ink" ? a.getBounds() : a.getRect(),
        color:
          type === "FreeText" ? a.getDefaultAppearance().color : a.getColor(),
        background: type === "FreeText" ? a.getColor() : [],
        fontSize: type === "FreeText" ? a.getDefaultAppearance().size : null,
        native: a.getObject().resolve().toString(),
        appearance: a.getObject().get("AP", "N").isStream(),
        autoSize:
          a.getObject().get("PDFAnnotationEditorAutoSize").asNumber() === 1,
      };
    });
  } finally {
    p.destroy();
  }
}
async function original(index = 0) {
  const doc = new mupdf.PDFDocument(new Uint8Array(await readFile(fixture)));
  try {
    return snapshot(doc, index);
  } finally {
    doc.destroy();
  }
}
async function open(page: Page, index = 0) {
  await page.goto("");
  await page.getByLabel("PDF öffnen", { exact: true }).setInputFiles(fixture);
  await expect(page.getByLabel("PDF-Seite 1", { exact: true })).toHaveAttribute(
    "data-rendered",
    "true",
  );
  if (index) await viewAction(page, "Nächste Seite");
  await expect(page.locator(".annotation-list button")).toHaveCount(
    index ? 7 : 8,
  );
  await tool(page, "select");
}
async function point(page: Page, x: number, y: number, index = 0) {
  const b = (await page.getByTestId("page-" + index).boundingBox())!;
  const scale = b.width / (index ? 400 : 300);
  return { x: b.x + x * scale, y: b.y + y * scale };
}
async function right(page: Page, x: number, y: number, index = 0) {
  const p = await point(page, x, y, index);
  await page.mouse.click(p.x, p.y, { button: "right" });
  const menu = page.getByRole("menu", actions);
  await expect(menu).toBeVisible();
  const b = (await menu.boundingBox())!,
    viewport = page.viewportSize()!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(b.y + b.height).toBeLessThanOrEqual(viewport.height + 1);
  return menu;
}
async function editDialog(
  page: Page,
  note = false,
  activate?: (entry: Locator) => Promise<void>,
) {
  const entry = page.getByRole("menuitem", { name: "Bearbeiten", exact: true });
  await expect(entry).toBeEnabled();
  await expect(page.getByRole("menuitem").first()).toHaveText("Bearbeiten");
  if (activate) await activate(entry);
  else await entry.click();
  const dialog = page.getByRole("dialog", {
    name: note ? "Notiz bearbeiten" : "Textkommentar bearbeiten",
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByLabel("Textkommentar", { exact: true }),
  ).toBeFocused();
  await expect(page.locator("#annotations-menu")).toBeHidden();
  await expect(page.getByRole("menu", actions)).toHaveCount(0);
  return dialog;
}
async function save(page: Page, name: string, browserName: string, index = 0) {
  const path = "artifacts/context-edit-" + name + "-" + browserName + ".pdf";
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PDF herunterladen", exact: true })
    .click();
  await (await pending).saveAs(path);
  await expect(
    page.getByRole("button", { name: "PDF herunterladen", exact: true }),
  ).toBeEnabled();
  const doc = new mupdf.PDFDocument(new Uint8Array(await readFile(path)));
  try {
    expect(doc.wasRepaired()).toBe(false);
    return { path, annotations: snapshot(doc, index) };
  } finally {
    doc.destroy();
  }
}
function unchangedOthers(
  before: Awaited<ReturnType<typeof original>>,
  after: Awaited<ReturnType<typeof original>>,
  id: number,
) {
  expect(after).toHaveLength(before.length);
  expect(after.filter((a) => a.id !== id)).toEqual(
    before.filter((a) => a.id !== id),
  );
}

for (const index of [0, 1]) {
  test(
    "right-click edits one native FreeText with undo/redo and roundtrip on page " +
      (index + 1),
    async ({ page, browserName }) => {
      await open(page, index);
      const baseline = await original(index),
        own = baseline.find((a) => a.contents === ownText)!;
      if (index) {
        const p = await point(page, 80, 100, index);
        await page.mouse.move(p.x, p.y);
        await page.mouse.wheel(0, -80);
        await page.mouse.down({ button: "middle" });
        await page.mouse.move(p.x + 25, p.y + 20);
        await page.mouse.up({ button: "middle" });
      }
      await expect(page.getByTestId("selection-outline")).toHaveCount(0);
      await right(page, 50, 80, index);
      await expect(page.getByTestId("selection-outline")).toHaveAttribute(
        "data-annotation-id",
        String(own.id),
      );
      await expect(
        page.getByRole("menuitem", { name: "Bearbeiten", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", {
        name: "Textkommentar bearbeiten",
      });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByLabel("Textkommentar", { exact: true }),
      ).toBeFocused();
      await expect(
        dialog.getByLabel("Textkommentar", { exact: true }),
      ).toHaveValue(ownText);
      await expect(dialog.getByLabel("Textfarbe", { exact: true })).toHaveValue(
        "#123456",
      );
      await expect(
        dialog.getByLabel("Hintergrundfarbe", { exact: true }),
      ).toHaveValue("#fff0a0");
      const changed = "Bearbeiteter Kommentar\nWeitere Zeile\nDritte Zeile";
      await dialog.getByLabel("Textkommentar", { exact: true }).fill(changed);
      await dialog.getByLabel("Schriftgröße", { exact: true }).fill("18");
      await dialog.getByLabel("Textfarbe", { exact: true }).fill("#225588");
      await dialog
        .getByLabel("Hintergrundfarbe", { exact: true })
        .fill("#eedd88");
      await dialog
        .getByRole("button", { name: "Übernehmen", exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByTestId("selection-outline")).toHaveAttribute(
        "data-annotation-id",
        String(own.id),
      );
      const edited = await save(page, "own-" + index, browserName, index);
      unchangedOthers(baseline, edited.annotations, own.id);
      const annotation = edited.annotations.find((a) => a.id === own.id)!;
      expect(annotation).toMatchObject({
        type: "FreeText",
        contents: changed,
        fontSize: 18,
        autoSize: true,
        appearance: true,
      });
      expect(annotation.color.map((c) => Math.round(c * 255))).toEqual([
        34, 85, 136,
      ]);
      expect(annotation.background.map((c) => Math.round(c * 255))).toEqual([
        238, 221, 136,
      ]);
      expect(annotation.rect[3] - annotation.rect[1]).toBeGreaterThan(
        own.rect[3] - own.rect[1],
      );
      await page
        .getByRole("button", { name: "Rückgängig", exact: true })
        .click();
      const undone = await save(page, "undo-" + index, browserName, index);
      expect(undone.annotations).toEqual(baseline);
      await page
        .getByRole("button", { name: "Wiederholen", exact: true })
        .click();
      const redone = await save(page, "redo-" + index, browserName, index);
      expect(redone.annotations).toEqual(edited.annotations);
      await page
        .getByLabel("PDF öffnen", { exact: true })
        .setInputFiles(redone.path);
      await expect(
        page.getByLabel("PDF-Seite 1", { exact: true }),
      ).toHaveAttribute("data-rendered", "true");
      if (index) await viewAction(page, "Nächste Seite");
      await right(page, 50, 80, index);
      const reopened = await editDialog(page);
      await expect(
        reopened.getByLabel("Textkommentar", { exact: true }),
      ).toHaveValue(changed);
      await reopened
        .getByRole("button", { name: "Abbrechen", exact: true })
        .click();
      await expect(page.getByTestId("viewport")).toBeFocused();
    },
  );
}

test("selected FreeText frame supports editing, cancel and Escape preserve history, and foreign dimensions stay unchanged", async ({
  page,
  browserName,
}) => {
  await open(page);
  const baseline = await original(),
    foreign = baseline.find((a) => a.contents === foreignText)!;
  const p = await point(page, 50, 230);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("selection-outline")).toHaveAttribute(
    "data-annotation-id",
    String(foreign.id),
  );
  // Bottom-right padding is inside the selection box but away from its text.
  const box = (await page.getByTestId("selection-outline").boundingBox())!;
  await page.mouse.click(box.x + box.width - 3, box.y + box.height - 3, {
    button: "right",
  });
  let dialog = await editDialog(page);
  await expect(dialog.getByLabel("Textkommentar", { exact: true })).toHaveValue(
    foreignText,
  );
  await dialog
    .getByLabel("Textkommentar", { exact: true })
    .fill("Abbrechen verwirft diesen Text");
  await dialog.getByLabel("Hintergrundfarbe", { exact: true }).fill("#aabbcc");
  await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(page.getByTestId("viewport")).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Rückgängig", exact: true }),
  ).toBeDisabled();
  await right(page, 50, 230);
  dialog = await editDialog(page);
  await expect(
    dialog.getByLabel("Hintergrundfarbe", { exact: true }),
  ).toHaveValue("#fff0a0");
  await dialog
    .getByLabel("Textkommentar", { exact: true })
    .fill("Escape verwirft diesen Text");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId("selection-outline")).toHaveAttribute(
    "data-annotation-id",
    String(foreign.id),
  );
  await expect(
    page.getByRole("button", { name: "Rückgängig", exact: true }),
  ).toBeDisabled();
  expect((await save(page, "cancel-foreign", browserName)).annotations).toEqual(
    baseline,
  );
  await right(page, 50, 230);
  dialog = await editDialog(page);
  await dialog.getByRole("button", { name: "Übernehmen", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Rückgängig", exact: true }),
  ).toBeDisabled();
  expect(
    (await save(page, "unchanged-foreign", browserName)).annotations,
  ).toEqual(baseline);
  await right(page, 50, 230);
  dialog = await editDialog(page);
  await dialog
    .getByLabel("Textkommentar", { exact: true })
    .fill("Fremdes Feld geändert");
  await dialog.getByLabel("Schriftgröße", { exact: true }).fill("18");
  await dialog.getByRole("button", { name: "Übernehmen", exact: true }).click();
  const edited = await save(page, "foreign", browserName);
  const annotation = edited.annotations.find((a) => a.id === foreign.id)!;
  expect(annotation.contents).toBe("Fremdes Feld geändert");
  expect(annotation.rect).toEqual(foreign.rect);
  expect(annotation.autoSize).toBe(false);
  unchangedOthers(baseline, edited.annotations, foreign.id);
});

test("supported sticky notes edit their existing native Text object, including an empty comment", async ({
  page,
  browserName,
}) => {
  await open(page);
  const baseline = await original(),
    note = baseline.find((a) => a.contents === noteText)!;
  await right(page, 225, 135);
  let dialog = await editDialog(page, true);
  await expect(dialog.getByLabel("Textkommentar", { exact: true })).toHaveValue(
    noteText,
  );
  await expect(dialog.getByLabel("Schriftgröße", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    dialog.getByLabel("Hintergrundfarbe", { exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByLabel("Textkommentar", { exact: true })
    .fill("Haftnotiz geändert\nZweite Zeile");
  await dialog.getByLabel("Notizfarbe", { exact: true }).fill("#338855");
  await dialog.getByRole("button", { name: "Übernehmen", exact: true }).click();
  let edited = await save(page, "note", browserName);
  expect(edited.annotations.find((a) => a.id === note.id)).toMatchObject({
    type: "Text",
    contents: "Haftnotiz geändert\nZweite Zeile",
    rect: note.rect,
    appearance: true,
  });
  unchangedOthers(baseline, edited.annotations, note.id);
  await right(page, 225, 135);
  dialog = await editDialog(page, true);
  await dialog.getByLabel("Textkommentar", { exact: true }).fill("");
  await dialog.getByRole("button", { name: "Übernehmen", exact: true }).click();
  edited = await save(page, "empty-note", browserName);
  expect(edited.annotations.find((a) => a.id === note.id)).toMatchObject({
    type: "Text",
    contents: "",
    rect: note.rect,
  });
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await expect(page.locator(".annotation-list")).toContainText(
    "Haftnotiz geändert",
  );
});

test("groups, Ink, images, locked FreeText and RichText retain their existing context actions without Edit", async ({
  page,
  browserName,
}) => {
  await open(page);
  const baseline = await original();
  for (const [x, y] of [
    [90, 355],
    [225, 345],
  ]) {
    await right(page, x, y);
    await expect(
      page.getByRole("menuitem", { name: "Bearbeiten", exact: true }),
    ).toHaveCount(0);
    for (const name of [/^Kopieren/, /^Ausschneiden/, /^Löschen/])
      await expect(page.getByRole("menuitem", { name })).toBeEnabled();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }
  for (const [x, y] of [
    [225, 215],
    [50, 305],
  ]) {
    const p = await point(page, x, y);
    await page.mouse.click(p.x, p.y, { button: "right" });
    await expect(
      page.getByRole("menuitem", { name: "Bearbeiten", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await page.getByTestId("viewport").focus();
  await page.keyboard.press("Control+a");
  await expect(page.getByTestId("selection-outline")).toHaveCount(6);
  const ids = await page
    .getByTestId("selection-outline")
    .evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-annotation-id")),
    );
  await right(page, 50, 80);
  await expect(
    page.getByRole("menuitem", { name: "Bearbeiten", exact: true }),
  ).toHaveCount(0);
  expect(
    await page
      .getByTestId("selection-outline")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-annotation-id")),
      ),
  ).toEqual(ids);
  await page.getByRole("menuitem", { name: /^Kopieren/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "6 Markierungen kopiert." }),
  ).toBeVisible();
  await right(page, 50, 80);
  await page.getByRole("menuitem", { name: "Löschen", exact: true }).click();
  await expect(page.locator(".annotation-list button")).toHaveCount(2);
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await expect(page.locator(".annotation-list button")).toHaveCount(8);
  expect((await save(page, "guards", browserName)).annotations).toEqual(
    baseline,
  );
});

test("editing uses isolated styles and does not replace saved creation preferences", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "free-text-style",
      JSON.stringify({
        color: "#008800",
        backgroundColor: "#ddeeff",
        transparent: true,
        fontSize: 22,
      }),
    ),
  );
  await open(page);
  await right(page, 50, 80);
  const dialog = await editDialog(page);
  await expect(dialog.getByLabel("Textfarbe", { exact: true })).toHaveValue(
    "#123456",
  );
  await expect(dialog.getByLabel("Schriftgröße", { exact: true })).toHaveValue(
    "14",
  );
  await dialog
    .getByLabel("Textkommentar", { exact: true })
    .fill("Isoliert bearbeitet");
  await dialog.getByLabel("Textfarbe", { exact: true }).fill("#995544");
  await dialog.getByRole("button", { name: "Übernehmen", exact: true }).click();
  await tool(page, "FreeText");
  const p = await point(page, 40, 170);
  await page.mouse.click(p.x, p.y);
  const create = page.getByRole("dialog", { name: "Textkommentar erstellen" });
  await expect(create.getByLabel("Textkommentar", { exact: true })).toHaveValue(
    "",
  );
  await expect(create.getByLabel("Textfarbe", { exact: true })).toHaveValue(
    "#008800",
  );
  await expect(
    create.getByLabel("Hintergrundfarbe", { exact: true }),
  ).toHaveValue("#ddeeff");
  await expect(create.getByLabel("Schriftgröße", { exact: true })).toHaveValue(
    "22",
  );
  await expect(
    create.getByLabel("Transparenter Hintergrund", { exact: true }),
  ).toBeChecked();
  await create.getByRole("button", { name: "Abbrechen", exact: true }).click();
});

test("touch long-press edits existing text and notes without moving them; cancel and Escape leave no history", async ({
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
  const baseline = await original(),
    own = baseline.find((a) => a.contents === ownText)!;
  const session = await context.newCDPSession(page);
  const tap = async (entry: Locator) => {
    const box = (await entry.boundingBox())!;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 },
      ],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };
  const hold = async (x: number, y: number) => {
    const p = await point(page, x, y),
      before = await page.getByTestId("page-0").boundingBox();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...p, id: 1 }],
    });
    await expect(
      page.getByRole("menuitem", { name: "Bearbeiten", exact: true }),
    ).toBeVisible();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    expect(await page.getByTestId("page-0").boundingBox()).toEqual(before);
  };
  await hold(50, 80);
  let dialog = await editDialog(page, false, tap);
  await dialog
    .getByLabel("Textkommentar", { exact: true })
    .fill("Nicht übernehmen");
  await tap(dialog.getByRole("button", { name: "Abbrechen", exact: true }));
  await expect(
    page.getByRole("button", { name: "Rückgängig", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await hold(225, 135);
  dialog = await editDialog(page, true, tap);
  await expect(dialog.getByLabel("Textkommentar", { exact: true })).toHaveValue(
    noteText,
  );
  await dialog
    .getByLabel("Textkommentar", { exact: true })
    .fill("Escape verwirft");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Rückgängig", exact: true }),
  ).toBeDisabled();
  expect((await save(page, "touch-cancel", browserName)).annotations).toEqual(
    baseline,
  );
  await page.keyboard.press("Escape");
  await hold(50, 80);
  dialog = await editDialog(page, false, tap);
  await dialog
    .getByLabel("Textkommentar", { exact: true })
    .fill("Touch geändert\nZweite Zeile");
  await page.setViewportSize({ width: 390, height: 450 });
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(451);
  await page.screenshot({ path: "artifacts/context-edit-touch.png" });
  await tap(dialog.getByRole("button", { name: "Übernehmen", exact: true }));
  const edited = await save(page, "touch-apply", browserName);
  const annotation = edited.annotations.find((a) => a.id === own.id)!;
  expect(annotation).toMatchObject({
    type: "FreeText",
    contents: "Touch geändert\nZweite Zeile",
    appearance: true,
  });
  expect(annotation.rect[0]).toBeCloseTo(own.rect[0], 3);
  expect(annotation.rect[1]).toBeCloseTo(own.rect[1], 3);
  unchangedOthers(baseline, edited.annotations, own.id);
});

test("touch movement, a second finger, wheel zoom and Escape cancel pending edit holds", async ({
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
  const baseline = await original(),
    session = await context.newCDPSession(page);
  const touch = (
    type: "touchStart" | "touchMove" | "touchEnd",
    points: { x: number; y: number; id: number }[],
  ) => session.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  for (const kind of ["move", "second", "wheel", "escape"]) {
    const p = await point(page, 50, 80);
    await touch("touchStart", [{ ...p, id: 1 }]);
    if (kind === "move") {
      await touch("touchMove", [{ x: p.x + 35, y: p.y, id: 1 }]);
      await page.keyboard.press("Escape");
    } else if (kind === "second") {
      await touch("touchStart", [
        { ...p, id: 1 },
        { x: p.x + 50, y: p.y, id: 2 },
      ]);
    } else if (kind === "wheel") {
      await page.mouse.move(p.x, p.y);
      await page.mouse.wheel(0, -50);
    } else await page.keyboard.press("Escape");
    await page.waitForTimeout(700);
    await expect(page.getByRole("menu", actions)).toHaveCount(0);
    await touch("touchEnd", []);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByTestId("viewport").focus();
    await page.keyboard.press("Escape");
  }
  await expect(
    page.getByRole("button", { name: "Rückgängig", exact: true }),
  ).toBeDisabled();
  expect((await save(page, "touch-holds", browserName)).annotations).toEqual(
    baseline,
  );
});
