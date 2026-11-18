import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as mupdf from "mupdf";
import {
  nativeSaveBridge,
  saveButton,
  state as saveState,
  type NativeOpenRequest,
  type NativePlatform,
  type TestWindow,
} from "./nativeSaveHarness";
import { closeMenu, menu, tool } from "./menus";
import { documentSwitchDialog } from "./documentSwitch";

// Each page is an isolated WebView with its own mocked native IPC endpoint.
// PDF parsing, annotations, history and export use the real MuPDF worker. This
// does not claim to exercise actual Finder routing or native macOS windows.
const labelB = "pdf-00000000-0000-4000-8000-000000000002";
const filenameA = "Grundriss A – Zürich.pdf";
const filenameB = "Plan B – Räume.pdf";
let sourceA: Buffer;
let sourceB: Buffer;
test.beforeAll(async () => {
  sourceA = await readFile("artifacts/fixture.pdf");
  const doc = new mupdf.PDFDocument();
  try {
    doc.insertPage(
      -1,
      doc.addPage([0, 0, 360, 480], 0, {}, "0.3 0.7 0.4 rg 0 0 360 480 re f"),
    );
    const page = doc.loadPage(0);
    try {
      const note = page.createAnnotation("Text");
      note.setRect([100, 100, 124, 124]);
      note.setContents("Originalnotiz nur in B");
      note.update();
    } finally {
      page.destroy();
    }
    const buffer = doc.saveToBuffer("compress=yes");
    try {
      sourceB = Buffer.from(buffer.asUint8Array());
    } finally {
      buffer.destroy();
    }
  } finally {
    doc.destroy();
  }
});
function incoming(
  index: number,
  fileName: string,
  bytes: Buffer,
): NativeOpenRequest {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    fileName,
    base64: bytes.toString("base64"),
  };
}
async function rendered(page: Page, fileName: string) {
  await expect(page.locator(".filename")).toHaveText(fileName);
  await expect(page.getByTestId("viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByLabel("PDF-Seite 1", { exact: true })).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (globalThis as TestWindow).nativeSaveTest.closeListenerCount(),
      ),
    )
    .toBe(1);
}
async function windowState(page: Page) {
  return page.evaluate(() => {
    const state = (globalThis as TestWindow).nativeSaveTest;
    return {
      reports: state.windowReports,
      calls: state.windowCalls,
      created: state.createdWindows,
      closed: state.closedWindows,
      cancelled: state.cancelledCloses,
      requests: state.closeRequests,
    };
  });
}
async function requestClose(page: Page) {
  // A real native event waits for the handler. Do not block Playwright while
  // the app's asynchronous close-confirmation modal is awaiting a person.
  await page.evaluate(() => {
    void (globalThis as TestWindow).nativeSaveTest.requestWindowClose();
  });
}
async function edit(page: Page, contents: string) {
  await page.bringToFront();
  await tool(page, "FreeText");
  const sheet = (await page.getByTestId("page-0").boundingBox())!;
  await page.mouse.click(
    sheet.x + sheet.width * 0.15,
    sheet.y + sheet.height * 0.4,
  );
  const dialog = page.getByRole("dialog", { name: "Textkommentar erstellen" });
  await dialog.getByLabel("Textkommentar", { exact: true }).fill(contents);
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".annotation-list button")).toHaveCount(2);
  await expect.poll(async () => (await saveState(page)).workerDirty).toBe(true);
}
async function closeDecision(page: Page, discard: boolean) {
  const dialog = documentSwitchDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "Ungesicherte Änderungen verwerfen und dieses Fenster schließen?",
  );
  await expect(
    dialog.getByRole("button", { name: "Abbrechen", exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("button", {
      name: discard ? "Verwerfen und schließen" : "Abbrechen",
      exact: true,
    })
    .click();
  await expect(dialog).not.toBeVisible();
}
async function release(page: Page, outcome: "saved" | "cancelled") {
  await page.evaluate((outcome) => {
    const state = (globalThis as TestWindow).nativeSaveTest;
    if (!state.release) throw Error("Expected a pending native save");
    state.release(outcome);
  }, outcome);
}
async function exported(page: Page) {
  const transaction = (await saveState(page)).transactions.at(-1)!;
  const bytes = Buffer.concat(
    transaction.chunks.map((chunk) => Buffer.from(chunk, "base64")),
  );
  expect(bytes.length).toBe(transaction.expected);
  expect(bytes.length).toBe(transaction.received);
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes));
  try {
    expect(doc.wasRepaired()).toBe(false);
    const first = doc.loadPage(0);
    try {
      const annotations = first.getAnnotations();
      expect(
        annotations
          .find((annotation) => annotation.getType() === "FreeText")!
          .getObject()
          .get("AP", "N")
          .isStream(),
      ).toBe(true);
      return {
        pages: doc.countPages(),
        contents: annotations.map((annotation) => annotation.getContents()),
        bytes,
      };
    } finally {
      first.destroy();
    }
  } finally {
    doc.destroy();
  }
}
async function twoViewers(a: Page, b: Page, mode: "saved" | "hold" = "hold") {
  await nativeSaveBridge(a, mode, "macos", [incoming(1, filenameA, sourceA)], {
    label: "main",
    savedFileName: "Gespeichert A.pdf",
  });
  await nativeSaveBridge(b, mode, "macos", [incoming(2, filenameB, sourceB)], {
    label: labelB,
    savedFileName: "Gespeichert B.pdf",
  });
  await Promise.all([a.goto(""), b.goto("")]);
  await Promise.all([rendered(a, filenameA), rendered(b, filenameB)]);
}

test("Mac-capable viewer requests a new window and reports document state without polling on zoom or pan", async ({
  page,
}) => {
  await nativeSaveBridge(page, "saved", "macos", [], { label: "main" });
  await page.goto("");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (globalThis as TestWindow).nativeSaveTest.closeListenerCount(),
      ),
    )
    .toBe(1);
  await menu(page, "view");
  await page
    .getByRole("button", { name: "Neues Fenster", exact: true })
    .click();
  await expect.poll(async () => (await windowState(page)).created).toBe(1);
  await closeMenu(page);
  await page.evaluate(
    (request) => (globalThis as TestWindow).nativeSaveTest.enqueueOpen(request),
    incoming(1, filenameA, sourceA),
  );
  await rendered(page, filenameA);
  await expect
    .poll(async () => (await windowState(page)).reports.at(-1))
    .toMatchObject({
      hasDocument: true,
      fileName: filenameA,
      busy: false,
      unsaved: false,
    });
  const reports = (await windowState(page)).reports.length;
  const geometry = () =>
    page.getByTestId("world").evaluate((element) => {
      const matrix = new DOMMatrix(getComputedStyle(element).transform);
      return { scale: matrix.a, x: matrix.e };
    });
  const before = await geometry();
  const bounds = (await page.getByTestId("viewport").boundingBox())!;
  await page.mouse.move(bounds.x + 280, bounds.y + 220);
  await page.mouse.wheel(0, -100);
  await expect
    .poll(async () => (await geometry()).scale)
    .toBeGreaterThan(before.scale);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(bounds.x + 340, bounds.y + 240);
  await page.mouse.up({ button: "middle" });
  await expect.poll(async () => (await geometry()).x).not.toBe(before.x);
  expect((await windowState(page)).reports).toHaveLength(reports);
  expect(
    (await windowState(page)).calls.every(
      (call) => !("label" in call.args) && !("path" in call.args),
    ),
  ).toBe(true);
});

test("two Mac viewers keep PDFs, undo, clipboard and simultaneous native saves independent", async ({
  page,
  context,
}) => {
  const other = await context.newPage();
  await twoViewers(page, other);
  await edit(page, "Bearbeitung ausschließlich A");
  await edit(other, "Bearbeitung ausschließlich B");
  await page.bringToFront();
  await tool(page, "select");
  await menu(page, "annotations");
  await page
    .locator(".annotation-list button")
    .filter({ hasText: "Bearbeitung ausschließlich A" })
    .click();
  await closeMenu(page);
  await page.keyboard.press("Meta+c");
  for (const [viewer, canPaste] of [
    [page, true],
    [other, false],
  ] as const) {
    await viewer.bringToFront();
    await tool(viewer, "select");
    const sheet = (await viewer.getByTestId("page-0").boundingBox())!;
    await viewer.mouse.click(
      sheet.x + sheet.width * 0.8,
      sheet.y + sheet.height * 0.8,
      { button: "right" },
    );
    const paste = viewer.getByRole("menuitem", {
      name: /^Einfügen\b/,
    });
    if (canPaste) await expect(paste).toBeEnabled();
    else await expect(paste).toBeDisabled();
    await viewer.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await expect(page.locator(".annotation-list button")).toHaveCount(1);
  await expect(other.locator(".annotation-list")).toContainText(
    "Bearbeitung ausschließlich B",
  );
  expect((await saveState(other)).workerDirty).toBe(true);
  await page.getByRole("button", { name: "Wiederholen", exact: true }).click();
  await expect(page.locator(".annotation-list")).toContainText(
    "Bearbeitung ausschließlich A",
  );
  await Promise.all([saveButton(page).click(), saveButton(other).click()]);
  await expect
    .poll(async () => (await saveState(page)).pendingFinish)
    .toBe(true);
  await expect
    .poll(async () => (await saveState(other)).pendingFinish)
    .toBe(true);
  const resultA = await exported(page),
    resultB = await exported(other);
  expect(resultA.pages).toBe(3);
  expect(resultB.pages).toBe(1);
  expect(resultA.contents).toContain("Independent fixture note");
  expect(resultA.contents).toContain("Bearbeitung ausschließlich A");
  expect(resultA.contents).not.toContain("Bearbeitung ausschließlich B");
  expect(resultB.contents).toContain("Originalnotiz nur in B");
  expect(resultB.contents).toContain("Bearbeitung ausschließlich B");
  expect(resultB.contents).not.toContain("Bearbeitung ausschließlich A");
  expect(resultA.bytes.equals(resultB.bytes)).toBe(false);
  await release(page, "cancelled");
  await expect
    .poll(async () => (await saveState(page)).pendingFinish)
    .toBe(false);
  expect(await saveState(page)).toMatchObject({
    workerDirty: true,
    acknowledgements: 0,
  });
  expect(await saveState(other)).toMatchObject({
    pendingFinish: true,
    workerDirty: true,
    acknowledgements: 0,
  });
  await release(other, "saved");
  await expect
    .poll(async () => (await saveState(other)).workerDirty)
    .toBe(false);
  await expect(other.getByRole("status")).toContainText("Gespeichert B.pdf");
  expect((await saveState(page)).workerDirty).toBe(true);
  await page.evaluate(() => {
    (globalThis as TestWindow).nativeSaveTest.mode = "saved";
  });
  await saveButton(page).click();
  await expect
    .poll(async () => (await saveState(page)).workerDirty)
    .toBe(false);
  await expect(page.getByRole("status")).toContainText("Gespeichert A.pdf");
  expect((await saveState(other)).transactions).toHaveLength(1);
  expect((await saveState(other)).browserDownloads).toBe(0);
});

test("cancelling and approving one Mac close keeps the other viewer and its save usable", async ({
  page,
  context,
}) => {
  const other = await context.newPage();
  await twoViewers(page, other, "saved");
  await edit(page, "Ungesichert in A");
  await requestClose(page);
  await closeDecision(page, false);
  await expect.poll(async () => (await windowState(page)).cancelled).toBe(1);
  expect((await windowState(page)).closed).toBe(0);
  expect((await windowState(other)).requests).toBe(0);
  await expect(page.locator(".annotation-list")).toContainText(
    "Ungesichert in A",
  );
  expect((await saveState(page)).workerDirty).toBe(true);
  await requestClose(page);
  await closeDecision(page, true);
  await expect.poll(async () => (await windowState(page)).closed).toBe(1);
  expect((await windowState(other)).closed).toBe(0);
  expect((await saveState(page)).calls).not.toContain("plugin:window|destroy");
  // The mock records the native force-close handoff; actually remove only that
  // browser page now, then prove the remaining real worker still edits/exports.
  await page.close({ runBeforeUnload: false });
  await rendered(other, filenameB);
  await edit(other, "Nach dem Schließen von A");
  await saveButton(other).click();
  await expect
    .poll(async () => (await saveState(other)).workerDirty)
    .toBe(false);
  expect((await exported(other)).contents).toContain(
    "Nach dem Schließen von A",
  );
  expect((await windowState(other)).closed).toBe(0);
});

test("Mac close cannot interrupt an outstanding verified save and clean close needs no discard dialog", async ({
  page,
}) => {
  await nativeSaveBridge(
    page,
    "hold",
    "macos",
    [incoming(1, filenameA, sourceA)],
    { label: "main" },
  );
  await page.goto("");
  await rendered(page, filenameA);
  await edit(page, "Speicherung vor dem Schließen");
  await saveButton(page).click();
  await expect
    .poll(async () => (await saveState(page)).pendingFinish)
    .toBe(true);
  await requestClose(page);
  await expect.poll(async () => (await windowState(page)).cancelled).toBe(1);
  await expect(documentSwitchDialog(page)).not.toBeVisible();
  expect((await windowState(page)).closed).toBe(0);
  expect((await saveState(page)).pendingFinish).toBe(true);
  await release(page, "saved");
  await expect
    .poll(async () => (await saveState(page)).workerDirty)
    .toBe(false);
  await expect(saveButton(page)).toBeEnabled();
  await requestClose(page);
  await expect.poll(async () => (await windowState(page)).closed).toBe(1);
  await expect(documentSwitchDialog(page)).not.toBeVisible();
  expect((await saveState(page)).acknowledgements).toBe(1);
});

for (const platform of [
  "macos",
  "windows",
  "linux",
  "android",
  "ios",
] as NativePlatform[]) {
  test(`${platform} without the native Mac capability keeps its existing single-window interface`, async ({
    page,
  }) => {
    await nativeSaveBridge(page, "saved", platform);
    await page.goto("");
    await menu(page, "view");
    await expect(
      page.getByRole("button", { name: "Neues Fenster", exact: true }),
    ).toHaveCount(0);
    expect((await windowState(page)).calls).toEqual([]);
    expect(
      await page.evaluate(() =>
        (globalThis as TestWindow).nativeSaveTest.closeListenerCount(),
      ),
    ).toBe(0);
  });
}
