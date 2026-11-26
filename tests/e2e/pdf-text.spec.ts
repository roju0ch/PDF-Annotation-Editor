import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { lines, pdfTextFixture } from "../pdfTextFixture";
import { zoomWithWheel } from "./viewerInput";

const fixture = "artifacts/pdf-text-crop.pdf";
const rotated = "artifacts/pdf-text-rotated.pdf";
const tool = (page: Page) =>
  page.getByRole("button", { name: "Text auswählen", exact: true });
const marks = (page: Page) => page.locator(".pdf-text-highlight polygon");
test.beforeEach(async ({ context, browserName }) => {
  // Headless Chromium cannot answer a permission prompt. Exercise the real
  // clipboard with consent. The refusal case below explicitly denies writing.
  if (browserName === "chromium")
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:4173",
    });
});
test.beforeAll(async () => {
  await writeFile(fixture, pdfTextFixture());
  await writeFile(rotated, pdfTextFixture(90));
});
async function open(page: Page, file = fixture) {
  await page.goto("");
  await page.getByLabel("PDF öffnen", { exact: true }).setInputFiles(file);
  await expect(page.getByLabel("PDF-Seite 1", { exact: true })).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await tool(page).click();
}
async function point(page: Page, x: number, y: number) {
  const b = (await page.getByTestId("page-0").boundingBox())!;
  return { x: b.x + (x * b.width) / 400, y: b.y + (y * b.height) / 400 };
}
async function pasteIntoField(page: Page, expected: string) {
  await page.evaluate(() => {
    const f = document.createElement("textarea");
    f.id = "paste-result";
    document.body.append(f);
    f.focus({ preventScroll: true });
  });
  await page.keyboard.press("Control+v");
  await expect(page.locator("#paste-result")).toHaveValue(expected);
  await page.locator("#paste-result").evaluate((el) => el.remove());
  await page.getByTestId("viewport").focus();
}

test("word, context menu, system paste, select all and normal field editing leave PDF clean", async ({
  page,
  browserName,
}) => {
  await open(page);
  const p = await point(page, 65, 72);
  await page.mouse.dblclick(p.x, p.y);
  await expect(marks(page)).toHaveCount(1);
  await page.mouse.click(p.x, p.y, { button: "right" });
  const menu = page.locator("#text-copy-menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(marks(page)).toHaveCount(1);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await menu.getByRole("button", { name: "Text kopieren" }).click();
  await expect(page.locator("footer .edit-status")).toHaveText("Text kopiert");
  await pasteIntoField(page, "Grüße");
  await page.keyboard.press("Control+a");
  await expect(marks(page)).toHaveCount(2);
  await page.keyboard.press("Control+c");
  await expect(page.locator("footer .edit-status")).toContainText(
    "Text kopiert",
  );
  await pasteIntoField(page, lines.join("\n"));
  await expect(
    page.getByRole("button", { name: "Rückgängig", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: `artifacts/pdf-text-selection-${browserName}.png`,
  });
  await page.keyboard.press("Escape");
  await expect(marks(page)).toHaveCount(0);
  await expect(tool(page)).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Auswählen / Verschieben", exact: true })
    .click();
  await page.keyboard.press("Control+a");
  await expect(page.getByTestId("selection-outline")).toHaveCount(1);
  await tool(page).click();
  for (const key of ["Control+c", "Control+x", "Delete", "Backspace"])
    await page.keyboard.press(key);
  await expect(page.getByTestId("selection-outline")).toHaveCount(0);
  await pasteIntoField(page, lines.join("\n"));
  await page.evaluate(() => {
    const field = document.createElement("div");
    field.contentEditable = "true";
    field.id = "comment-input";
    field.textContent = "Eigener Text";
    document.body.append(field);
    field.focus({ preventScroll: true });
  });
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+x");
  await expect(page.locator("#comment-input")).toHaveText("");
  await page.keyboard.press("Control+v");
  await expect(page.locator("#comment-input")).toHaveText("Eigener Text");
  await expect(page.locator(".annotation-list button")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Rückgängig", exact: true }),
  ).toBeDisabled();
});

test("backward multiline drag and highlight alignment at enlarged zoom on a rotated CropBox", async ({
  page,
}) => {
  await open(page, rotated);
  const anchor = await point(page, 315, 80);
  await page.mouse.move(anchor.x, anchor.y);
  await zoomWithWheel(page, -200, -200);
  await expect
    .poll(async () => (await page.getByTestId("page-0").boundingBox())!.width)
    .toBeGreaterThan(1000);
  const start = await point(page, 296, 112),
    end = await point(page, 328, 40);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 15 });
  await page.mouse.up();
  await expect(marks(page)).toHaveCount(2);
  const rect = (await marks(page).first().boundingBox())!;
  const top = await point(page, 328, 40),
    bottom = await point(page, 328, 40 + lines[0].length * 12);
  expect(Math.abs(rect.y - top.y)).toBeLessThan(1);
  expect(Math.abs(rect.y + rect.height - bottom.y)).toBeLessThan(1);
  await page.keyboard.press("Control+c");
  await expect(page.locator("footer .edit-status")).toContainText(
    "Text kopiert",
  );
  await pasteIntoField(page, lines[0] + "\nZweite");
  await page.mouse.click(start.x - 45, start.y + 60);
  await expect(marks(page)).toHaveCount(0);
});

test("denied clipboard offers a selected manual copy and editable controls retain their shortcuts", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator.clipboard, "writeText", {
      value: async () => {
        throw new Error("denied");
      },
    }),
  );
  await open(page);
  await page.keyboard.press("Control+a");
  await page
    .getByRole("button", { name: "Text kopieren", exact: true })
    .click();
  const field = page.getByRole("textbox", { name: "Ausgewählter PDF-Text" });
  await expect(field).toHaveValue(lines.join("\n"));
  expect(
    await field.evaluate((el) => (el as HTMLTextAreaElement).selectionEnd),
  ).toBe(lines.join("\n").length);
  await expect(page.locator("footer .edit-status")).not.toContainText(
    "Text kopiert",
  );
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await pasteIntoField(page, lines.join("\n"));
  await expect(marks(page)).toHaveCount(2);
});

test("discard delayed text replies on tool and document changes; blank page stays usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      message,
      options?: StructuredSerializeOptions | Transferable[],
    ) {
      if (message.type === "select-text" && message.query.mode === "all") {
        const hold = (e: MessageEvent) => {
          if (e.data.id !== message.id) return;
          e.stopImmediatePropagation();
          this.removeEventListener("message", hold, true);
          Object.assign(window, {
            releasePdfText: () =>
              this.dispatchEvent(new MessageEvent("message", { data: e.data })),
          });
        };
        this.addEventListener("message", hold, true);
      }
      original.call(
        this,
        message,
        Array.isArray(options) ? { transfer: options } : options,
      );
    };
  });
  await open(page);
  for (const change of ["tool", "document"]) {
    await page.keyboard.press("Control+a");
    await page.waitForFunction(() => "releasePdfText" in window);
    if (change === "tool")
      await page.getByRole("button", { name: "Freihand", exact: true }).click();
    else {
      await page
        .getByLabel("PDF öffnen", { exact: true })
        .setInputFiles("artifacts/fixture.pdf");
      await expect(page.locator(".filename")).toHaveText("fixture.pdf");
    }
    await page.evaluate(() => {
      const w = window as Window & { releasePdfText?: () => void };
      w.releasePdfText!();
      delete w.releasePdfText;
    });
    await tool(page).click();
    await expect(marks(page)).toHaveCount(0);
  }
  await expect(page.locator("footer .edit-status")).toHaveText(
    "Auf dieser Seite wurde kein auslesbarer Text gefunden.",
  );
  await page.getByRole("button", { name: "Freihand", exact: true }).click();
  await expect(page.getByLabel("PDF-Seite 1", { exact: true })).toBeVisible();
});

test("touch hold, both handles, cancel, one-finger scroll and pinch", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Touch injection uses Chromium CDP.");
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const session = await context.newCDPSession(page);
  const touch = (
    type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
    points: { x: number; y: number; id: number }[],
  ) => session.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  const p = { ...(await point(page, 65, 72)), id: 1 };
  await touch("touchStart", [p]);
  await expect(marks(page)).toHaveCount(1);
  await touch("touchEnd", []);
  await expect(
    page.getByRole("menu", { name: "Annotationsaktionen" }),
  ).toHaveCount(0);
  for (const name of ["end", "start"]) {
    const b = (await page
      .locator(`[data-text-handle="${name}"]`)
      .boundingBox())!;
    expect(b.width).toBeGreaterThan(43);
    const grip = { x: b.x + b.width / 2, y: b.y + b.height / 2, id: 1 };
    await touch("touchStart", [grip]);
    await touch("touchMove", [
      {
        ...grip,
        x: grip.x + (name === "end" ? 45 : 11),
        y: grip.y + (name === "end" ? 30 : 0),
      },
    ]);
    await touch(name === "end" ? "touchEnd" : "touchCancel", []);
    await expect(marks(page)).toHaveCount(2);
  }
  await page
    .getByRole("button", { name: "Text kopieren", exact: true })
    .click();
  await expect(page.locator("footer .edit-status")).toHaveText("Text kopiert");
  await pasteIntoField(page, lines[0].slice(1) + "\n" + lines[1].slice(0, 9));
  await page.screenshot({ path: "artifacts/pdf-text-touch.png" });
  await page.getByTestId("viewport").focus();
  await page.keyboard.press("Escape");
  const before = await page.getByTestId("world").getAttribute("style");
  await touch("touchStart", [p]);
  await touch("touchMove", [{ ...p, y: p.y - 60 }]);
  await page.waitForTimeout(680);
  await touch("touchEnd", []);
  await expect(marks(page)).toHaveCount(0);
  await expect(page.getByTestId("world")).not.toHaveAttribute("style", before!);
  const p2 = { ...(await point(page, 70, 72)), id: 1 },
    q = { ...p2, x: p2.x + 40, id: 2 };
  const width = (await page.getByTestId("page-0").boundingBox())!.width;
  await touch("touchStart", [p2]);
  await touch("touchStart", [p2, q]);
  await touch("touchMove", [p2, { ...q, x: q.x + 45 }]);
  await page.waitForTimeout(680);
  await touch("touchEnd", []);
  await expect(marks(page)).toHaveCount(0);
  expect(
    (await page.getByTestId("page-0").boundingBox())!.width,
  ).toBeGreaterThan(width * 1.5);
});

test("page edits and history discard old selection and resolve the current PDF page object", async ({
  page,
}) => {
  await open(page);
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const select = async (index: number) => {
    await page.getByTestId("viewport").focus();
    await page.keyboard.press("Control+a");
    await expect(
      page.getByTestId(`page-${index}`).locator(".pdf-text-highlight polygon"),
    ).toHaveCount(2);
    await page.keyboard.press("Control+c");
    await expect(page.locator("footer .edit-status")).toContainText(
      "Text kopiert",
    );
    await pasteIntoField(page, lines.join("\n"));
  };
  const action = async (name: string) => {
    await button("Seitenübersicht").click();
    await button(name).click();
    await expect(marks(page)).toHaveCount(0);
    await button("Menü schließen").click();
  };
  await select(0);
  await action("Seite 90° nach rechts drehen");
  await select(0);
  await action("Seite nach hinten verschieben");
  await select(1);
  await button("Rückgängig").click();
  await expect(marks(page)).toHaveCount(0);
  await select(0);
  await button("Wiederholen").click();
  await expect(marks(page)).toHaveCount(0);
  await select(1);

  await button("Seitenübersicht").click();
  const chooser = page.waitForEvent("filechooser");
  await button("PDF hinzufügen …").click();
  await (
    await chooser
  ).setFiles({
    name: "Anhang.pdf",
    mimeType: "application/pdf",
    buffer: pdfTextFixture(0, ["Anhang"]),
  });
  await expect(page.locator("#pages-menu h2")).toHaveText("Seiten · 4");
  await expect(marks(page)).toHaveCount(0);
  await button("Menü schließen").click();
  await page.getByTestId("viewport").focus();
  await page.keyboard.press("Control+a");
  await expect(
    page.getByTestId("page-2").locator(".pdf-text-highlight polygon"),
  ).toHaveCount(1);
  await page.keyboard.press("Control+c");
  await expect(page.locator("footer .edit-status")).toContainText(
    "Text kopiert",
  );
  await pasteIntoField(page, "Anhang");
  await button("Seitenübersicht").click();
  await button("Ausgewählte Seiten löschen").click();
  await button("1 Seite löschen").click();
  await expect(page.locator("#pages-menu h2")).toHaveText("Seiten · 3");
  await expect(marks(page)).toHaveCount(0);
  await button("Menü schließen").click();
  await expect(page.locator("footer .edit-status")).toContainText(
    "kein auslesbarer Text",
  );
});
