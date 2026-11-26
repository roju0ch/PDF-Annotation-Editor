import {
  expect,
  test,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as mupdf from "mupdf";
import {
  nativeSaveBridge,
  openAndEdit,
  saveButton,
  state as saveState,
  transferredPdf,
  type NativeOpenRequest,
  type TestWindow,
} from "./nativeSaveHarness";
import { tool } from "./menus";
import {
  documentSwitchDialog,
  respondToDocumentSwitch,
} from "./documentSwitch";

// Simulates only the native queue/event IPC, not Finder/Explorer/Android intents.
// Every successful import passes through App.open(File) and the real PDF worker.
const id = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
let fixture: Buffer;
let second: Buffer;
let large: Buffer;
test.beforeAll(async () => {
  fixture = await readFile("artifacts/fixture.pdf");
  const doc = new mupdf.PDFDocument();
  try {
    doc.insertPage(
      -1,
      doc.addPage([0, 0, 360, 480], 0, {}, "0.7 0.2 0.4 rg 0 0 360 480 re f"),
    );
    const page = doc.loadPage(0);
    try {
      const note = page.createAnnotation("Text");
      note.setRect([100, 100, 124, 124]);
      note.setContents("Extern übergebene native Notiz");
      note.update();
    } finally {
      page.destroy();
    }
    const saved = doc.saveToBuffer("compress=no");
    try {
      second = Buffer.from(saved.asUint8Array());
    } finally {
      saved.destroy();
    }
    // Meaningful chunk-boundary coverage with a valid uncompressed PDF, rather
    // than trailing junk that MuPDF would need to repair.
    doc.insertPage(
      -1,
      doc.addPage(
        [0, 0, 360, 480],
        0,
        {},
        "% Harmless synthetic content comment\n".repeat(20000),
      ),
    );
    const expanded = doc.saveToBuffer("compress=no");
    try {
      large = Buffer.from(expanded.asUint8Array());
    } finally {
      expanded.destroy();
    }
  } finally {
    doc.destroy();
  }
});
function request(
  index: number,
  fileName: string,
  bytes: Buffer = fixture,
): NativeOpenRequest {
  return { id: id(index), fileName, base64: bytes.toString("base64") };
}
async function openState(page: Page) {
  return page.evaluate(() => {
    const value = (globalThis as TestWindow).nativeSaveTest;
    return {
      queue: value.openQueue.map((item) => item.id),
      finished: value.finishedOpens,
      calls: value.openCalls,
      workerOpens: value.workerOpens,
    };
  });
}
async function enqueue(page: Page, incoming: NativeOpenRequest, wakeups = 1) {
  await page.evaluate(
    ({ incoming, wakeups }) => {
      const value = (globalThis as TestWindow).nativeSaveTest;
      value.enqueueOpen(incoming);
      for (let i = 1; i < wakeups; i++) value.wakeOpen();
    },
    { incoming, wakeups },
  );
}
async function rendered(page: Page, name: string, pages: number) {
  await expect(page.locator(".filename")).toHaveText(name);
  await expect(page.locator(".document-status")).toContainText(
    `${pages} Seiten`,
  );
  await expect(page.getByLabel("PDF-Seite 1", { exact: true })).toHaveAttribute(
    "data-rendered",
    "true",
  );
}

for (const platform of ["windows", "android"] as const) {
  test(`${platform} cold start drains an OS PDF queued before React is ready and preserves Unicode filenames`, async ({
    page,
  }) => {
    const incoming = request(1, "Grundriss Zürich – EG #1 (ÄÖ).pdf");
    await nativeSaveBridge(page, "saved", platform, [incoming]);
    await page.goto("");
    await rendered(page, incoming.fileName, 3);
    await expect(page.locator(".annotation-list")).toContainText(
      "Independent fixture note",
    );
    await expect
      .poll(async () => (await openState(page)).finished)
      .toEqual([incoming.id]);
    expect(await openState(page)).toMatchObject({
      queue: [],
      workerOpens: 1,
    });
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

test("iPad native picker and Files handoff open through the same worker", async ({
  page,
}) => {
  const incoming = request(1, "Dateien-App – Übergabe.pdf");
  const picked = request(2, "Baustelle – Plan EG.pdf", second);
  await nativeSaveBridge(page, "saved", "ios", [incoming]);
  await page.goto("");
  await rendered(page, incoming.fileName, 3);
  await expect(page.locator(".annotation-list")).toContainText(
    "Independent fixture note",
  );
  await expect(
    page.getByRole("button", { name: "PDF speichern …", exact: true }),
  ).toBeEnabled();
  await page.evaluate((item) => {
    (window as unknown as TestWindow).nativeSaveTest.picked = item;
  }, picked);
  await page.getByLabel("PDF öffnen", { exact: true }).click();
  await rendered(page, picked.fileName, 1);
  await expect
    .poll(async () => (await openState(page)).finished)
    .toEqual([incoming.id, picked.id]);
});

test("a running desktop app reads bounded PDF chunks and coalesces repeated open notifications", async ({
  page,
}) => {
  const first = request(1, "Erster Plan.pdf");
  const next = request(2, "Zweiter Plan – mehrteilig.pdf", large);
  expect(large.length).toBeGreaterThan(2 * 256 * 1024);
  await nativeSaveBridge(page, "saved", "linux", [first]);
  await page.goto("");
  await rendered(page, first.fileName, 3);
  await enqueue(page, next, 8);
  await rendered(page, next.fileName, 2);
  await expect
    .poll(async () => (await openState(page)).finished)
    .toEqual([first.id, next.id]);
  const value = await openState(page);
  expect(value.workerOpens).toBe(2);
  const reads = value.calls.filter(
    (call) => call.command.endsWith("|read_pdf_open") && call.id === next.id,
  );
  expect(reads.map((call) => call.offset)).toEqual(
    Array.from(
      { length: Math.ceil(large.length / (256 * 1024)) },
      (_, index) => index * 256 * 1024,
    ),
  );
  await expect(page.locator(".annotation-list")).toContainText(
    "Extern übergebene native Notiz",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("unsaved desktop edits survive a rejected external switch, and a later accepted switch uses the same import pipeline", async ({
  page,
}) => {
  await nativeSaveBridge(page, "saved", "macos");
  await openAndEdit(page);
  const next = request(2, "Externer Folgevertrag.pdf", second);
  await enqueue(page, next, 4);
  await respondToDocumentSwitch(page, false, () =>
    page.keyboard.press("Escape"),
  );
  await expect
    .poll(async () => (await openState(page)).finished)
    .toEqual([next.id]);
  await rendered(page, "fixture.pdf", 3);
  await expect(page.locator(".annotation-list button")).toHaveCount(2);
  expect((await saveState(page)).workerDirty).toBe(true);
  expect((await openState(page)).workerOpens).toBe(1);
  await expect(documentSwitchDialog(page)).not.toBeVisible();
  await enqueue(page, { ...next, id: id(3) });
  await respondToDocumentSwitch(page, true);
  await rendered(page, next.fileName, 1);
  await expect(page.locator(".annotation-list button")).toHaveCount(1);
  await expect
    .poll(async () => (await openState(page)).finished)
    .toEqual([next.id, id(3)]);
  await expect(documentSwitchDialog(page)).not.toBeVisible();
  expect((await openState(page)).workerOpens).toBe(2);
  expect((await saveState(page)).workerDirty).toBe(false);
});

test("an external switch protects an unfinished text dialog and keeps cancellation focused", async ({
  page,
}) => {
  await nativeSaveBridge(page, "saved", "macos");
  await openAndEdit(page);
  await tool(page, "FreeText");
  const sheet = (await page.getByTestId("page-0").boundingBox())!;
  await page.mouse.click(
    sheet.x + sheet.width * 0.3,
    sheet.y + sheet.height * 0.4,
  );
  const draft = page.getByRole("dialog", { name: "Textkommentar erstellen" });
  const input = draft.getByLabel("Textkommentar", { exact: true });
  await input.fill("Noch nicht übernommener Text");
  const incoming = request(2, "Nach dem Textentwurf.pdf", second);
  await enqueue(page, incoming);
  await respondToDocumentSwitch(page, false);
  await expect(draft).toBeVisible();
  await expect(input).toHaveValue("Noch nicht übernommener Text");
  await expect(input).toBeFocused();
  await expect
    .poll(async () => (await openState(page)).finished)
    .toEqual([incoming.id]);
  expect((await saveState(page)).workerDirty).toBe(true);
  expect((await openState(page)).workerOpens).toBe(1);
  await enqueue(page, { ...incoming, id: id(3) });
  await respondToDocumentSwitch(page, true);
  await rendered(page, incoming.fileName, 1);
  await expect(draft).not.toBeVisible();
  expect((await saveState(page)).workerDirty).toBe(false);
});

test("invalid, corrupt and unreadable external PDFs retain the current document and unsaved annotations", async ({
  page,
}) => {
  await nativeSaveBridge(page, "saved", "windows");
  await openAndEdit(page);
  const failures = [
    request(2, "Falscher Inhalt.pdf", Buffer.from("This is not a PDF file.")),
    request(
      3,
      "Defektes Dokument.pdf",
      Buffer.from("%PDF-1.7\nnot-an-object-or-trailer\n%%EOF\n"),
    ),
    {
      ...request(4, "Nicht lesbar.pdf"),
      error: {
        code: "denied",
        message:
          "Synthetic provider failure at content://synthetic-private-provider/Plan.pdf",
      },
    },
  ];
  for (const [index, incoming] of failures.entries()) {
    await enqueue(page, incoming);
    if (!("error" in incoming)) await respondToDocumentSwitch(page, true);
    await expect
      .poll(async () => (await openState(page)).finished)
      .toHaveLength(index + 1);
    await expect(page.getByRole("alert")).toBeVisible();
    if ("error" in incoming) {
      await expect(page.getByRole("alert")).toContainText(
        "Der Zugriff auf die übergebene PDF wurde nicht erlaubt.",
      );
      await expect(page.getByRole("alert")).not.toContainText("content://");
    }
    await rendered(page, "fixture.pdf", 3);
    await expect(page.locator(".annotation-list button")).toHaveCount(2);
    expect((await saveState(page)).workerDirty).toBe(true);
    await expect(saveButton(page)).toBeEnabled();
  }
  // A bad item must not wedge delivery of later valid operating-system events.
  const next = request(5, "Nach dem Fehler.pdf", second);
  await enqueue(page, next);
  await respondToDocumentSwitch(page, true);
  await rendered(page, next.fileName, 1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(async () => (await openState(page)).finished)
    .toHaveLength(4);
});

test("an external open arriving during a native save waits for verified completion without interrupting export", async ({
  page,
  browserName,
}) => {
  await nativeSaveBridge(page, "hold", "windows");
  await openAndEdit(page);
  await saveButton(page).click();
  await expect
    .poll(async () => (await saveState(page)).pendingFinish)
    .toBe(true);
  const incoming = request(2, "Nach dem Speichern.pdf", second);
  await enqueue(page, incoming, 4);
  await expect(page.locator(".filename")).toHaveText("fixture.pdf");
  const waiting = await openState(page);
  expect(waiting.queue).toEqual([incoming.id]);
  expect(waiting.finished).toEqual([]);
  expect(
    waiting.calls.some((call) => call.command.endsWith("|read_pdf_open")),
  ).toBe(false);
  expect((await saveState(page)).acknowledgements).toBe(0);
  await transferredPdf(page, browserName, "external-open-during-save");
  await page.evaluate(() => {
    const release = (globalThis as TestWindow).nativeSaveTest.release;
    if (!release) throw Error("Expected a pending native save");
    release("saved");
  });
  await rendered(page, incoming.fileName, 1);
  await expect
    .poll(async () => (await openState(page)).finished)
    .toEqual([incoming.id]);
  expect((await saveState(page)).acknowledgements).toBe(1);
  await expect(documentSwitchDialog(page)).not.toBeVisible();
  expect((await openState(page)).workerOpens).toBe(2);
});

async function tap(session: CDPSession, x: number, y: number) {
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}
test("Android touch editing keeps a new external PDF queued until the unsaved-switch decision", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Touch injection requires Chromium CDP.",
  );
  const first = request(1, "Android Eingangsplan.pdf");
  await nativeSaveBridge(page, "saved", "android", [first]);
  await page.goto("");
  await rendered(page, first.fileName, 3);
  await tool(page, "FreeText");
  const session = await context.newCDPSession(page);
  const sheet = (await page.getByTestId("page-0").boundingBox())!;
  await tap(session, sheet.x + sheet.width * 0.3, sheet.y + sheet.height * 0.4);
  const editor = page.getByRole("dialog", { name: "Textkommentar erstellen" });
  await editor
    .getByLabel("Textkommentar", { exact: true })
    .fill("Touchänderung");
  const okay = (await editor
    .getByRole("button", { name: "OK", exact: true })
    .boundingBox())!;
  await tap(session, okay.x + okay.width / 2, okay.y + okay.height / 2);
  await expect(editor).not.toBeVisible();
  await expect(page.locator(".annotation-list button")).toHaveCount(2);
  await expect.poll(async () => (await saveState(page)).workerDirty).toBe(true);
  const next = request(2, "Android neuer Plan.pdf", second);
  await enqueue(page, next);
  const activate = async (button: Locator) => {
    const bounds = (await button.boundingBox())!;
    await tap(
      session,
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
  };
  await respondToDocumentSwitch(page, false, activate);
  await expect
    .poll(async () => (await openState(page)).finished)
    .toEqual([first.id, next.id]);
  await rendered(page, first.fileName, 3);
  await expect(page.locator(".annotation-list")).toContainText("Touchänderung");
  expect((await saveState(page)).workerDirty).toBe(true);
  await enqueue(page, { ...next, id: id(3) });
  await respondToDocumentSwitch(page, true, activate);
  await rendered(page, next.fileName, 1);
  expect((await saveState(page)).workerDirty).toBe(false);
  await session.detach();
});
