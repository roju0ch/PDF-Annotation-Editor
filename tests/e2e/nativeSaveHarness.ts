import { expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import * as mupdf from "mupdf";
import { tool } from "./menus";

export type Outcome = "saved" | "cancelled" | "failure";
type SaveTransaction = {
  fileName: string;
  expected: number;
  received: number;
  chunks: string[];
};
export type NativeSaveState = {
  calls: string[];
  transactions: SaveTransaction[];
  mode: Outcome | "hold";
  pendingFinish: boolean;
  workerDirty: boolean | null;
  acknowledgements: number;
  browserDownloads: number;
  failAcknowledgement?: boolean;
  release?: (outcome: Outcome) => void;
};
export type TestWindow = typeof globalThis & {
  nativeSaveTest: NativeSaveState;
};
export const savedName = "fixture-annotiert-gewählt.pdf";
export const comment = "Plattform-Speichertest\nZweite Zeile";
export const errorText = "Kein Schreibzugriff auf das gewählte Dokument.";

/** Only the platform IPC is simulated. Export/edit/ack use the real PDF worker.
 * Native Android ContentResolver and desktop filesystem tests run separately.
 * This bridge does not claim to exercise real operating-system dialogs.
 */
export type NativePlatform = "android" | "windows" | "macos" | "linux";
const agents: Record<NativePlatform, string> = {
  android: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
};
export async function nativeSaveBridge(
  page: Page,
  mode: NativeSaveState["mode"],
  platform: NativePlatform = "android",
) {
  await page.setViewportSize(
    platform === "android"
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  const namespace = platform === "android" ? "android-bridge" : "desktop-save";
  const userAgent = agents[platform];
  await page.addInitScript(
    ({ mode, savedName, errorText, namespace, userAgent }) => {
      Object.defineProperty(navigator, "userAgent", {
        value: userAgent,
      });
      Object.defineProperty(globalThis, "isTauri", { value: true });
      const state: NativeSaveState = {
        calls: [],
        transactions: [],
        mode,
        pendingFinish: false,
        workerDirty: null,
        acknowledgements: 0,
        browserDownloads: 0,
      };
      Object.defineProperty(globalThis, "nativeSaveTest", { value: state });
      const observed = new WeakSet<Worker>();
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (
        message: unknown,
        options?: StructuredSerializeOptions | Transferable[],
      ) {
        if (!observed.has(this)) {
          observed.add(this);
          this.addEventListener(
            "message",
            ({ data }: MessageEvent<{ editor?: { dirty?: boolean } }>) => {
              if (typeof data.editor?.dirty === "boolean")
                state.workerDirty = data.editor.dirty;
            },
          );
        }
        if (
          message &&
          typeof message === "object" &&
          "type" in message &&
          message.type === "ack-export"
        ) {
          state.acknowledgements++;
          if (state.failAcknowledgement) {
            const id = "id" in message ? message.id : undefined;
            if (typeof id !== "number")
              throw Error("Expected an identified worker acknowledgement");
            queueMicrotask(() =>
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: {
                    id,
                    error: "Synthetischer Fehler beim Exportstatus.",
                  },
                }),
              ),
            );
            return;
          }
        }
        return post.call(
          this,
          message,
          Array.isArray(options) ? { transfer: options } : options,
        );
      };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) state.browserDownloads++;
        click.call(this);
      };
      Object.defineProperty(globalThis, "__TAURI_INTERNALS__", {
        value: {
          invoke: async (
            command: string,
            args: Record<string, unknown> = {},
          ) => {
            state.calls.push(command);
            if (command === `plugin:${namespace}|begin_pdf_save`) {
              state.transactions.push({
                fileName: String(args.fileName),
                expected: Number(args.byteLength),
                received: 0,
                chunks: [],
              });
              return { token: "00000000-0000-4000-8000-000000000001" };
            }
            if (command === `plugin:${namespace}|append_pdf_save`) {
              const transfer = state.transactions.at(-1)!;
              const base64 = String(args.base64);
              if (Number(args.offset) !== transfer.received)
                throw Error("Unexpected native upload offset");
              const length = atob(base64).length;
              if (!length || length > 256 * 1024)
                throw Error("Unexpected native upload chunk size");
              transfer.chunks.push(base64);
              transfer.received += length;
              return { received: transfer.received };
            }
            if (command === `plugin:${namespace}|finish_pdf_save`) {
              const transfer = state.transactions.at(-1)!;
              if (transfer.received !== transfer.expected)
                throw Error("Incomplete native upload");
              state.pendingFinish = true;
              return new Promise((resolve, reject) => {
                state.release = (outcome) => {
                  state.pendingFinish = false;
                  if (outcome === "failure") reject({ message: errorText });
                  else if (outcome === "cancelled")
                    resolve({ status: "cancelled" });
                  else resolve({ status: "saved", fileName: savedName });
                };
                if (state.mode !== "hold") state.release(state.mode);
              });
            }
            if (command === `plugin:${namespace}|abort_pdf_save`) return {};
            throw Error("Unexpected native IPC command");
          },
        },
      });
    },
    { mode, savedName, errorText, namespace, userAgent },
  );
}
export async function state(page: Page) {
  return page.evaluate(() => {
    const value = (globalThis as TestWindow).nativeSaveTest;
    return {
      calls: value.calls,
      transactions: value.transactions,
      pendingFinish: value.pendingFinish,
      workerDirty: value.workerDirty,
      acknowledgements: value.acknowledgements,
      browserDownloads: value.browserDownloads,
    };
  });
}
export async function openAndEdit(page: Page) {
  await page.goto("");
  await page
    .getByLabel("PDF öffnen", { exact: true })
    .setInputFiles("artifacts/fixture.pdf");
  await expect(page.getByLabel("PDF-Seite 1", { exact: true })).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await tool(page, "FreeText");
  const sheet = (await page.getByTestId("page-0").boundingBox())!;
  await page.mouse.click(
    sheet.x + sheet.width * 0.15,
    sheet.y + sheet.height * 0.4,
  );
  const dialog = page.getByRole("dialog", { name: "Textkommentar erstellen" });
  await dialog.getByLabel("Textkommentar", { exact: true }).fill(comment);
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".annotation-list button")).toHaveCount(2);
  await expect.poll(async () => (await state(page)).workerDirty).toBe(true);
  await expect(
    page.getByRole("button", { name: "PDF speichern unter …", exact: true }),
  ).toBeEnabled();
}
export function saveButton(page: Page) {
  return page.getByRole("button", {
    name: "PDF speichern unter …",
    exact: true,
  });
}
export async function transferredPdf(
  page: Page,
  browserName: string,
  suffix: string,
) {
  const transfer = (await state(page)).transactions.at(-1)!;
  expect(transfer.fileName).toBe("fixture-annotiert.pdf");
  const bytes = Buffer.concat(
    transfer.chunks.map((chunk) => Buffer.from(chunk, "base64")),
  );
  expect(bytes.length).toBe(transfer.expected);
  expect(bytes.length).toBe(transfer.received);
  const original = await readFile("artifacts/fixture.pdf");
  expect(bytes.subarray(0, original.length)).toEqual(original);
  const file = `artifacts/native-save-${suffix}-${browserName}.pdf`;
  await writeFile(file, bytes);
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes));
  try {
    expect(doc.wasRepaired()).toBe(false);
    const p = doc.loadPage(0);
    try {
      const annotations = p.getAnnotations();
      expect(annotations).toHaveLength(2);
      const annotation = annotations.find((a) => a.getType() === "FreeText")!;
      expect(annotation.getContents()).toBe(comment);
      expect(annotation.getObject().get("AP", "N").isStream()).toBe(true);
      expect(
        annotations.find((a) => a.getType() === "Text")!.getContents(),
      ).toBe("Independent fixture note");
      expect(p.getObject().get("Annots", 1, "A", "URI").asString()).toBe(
        "https://example.invalid/never-followed",
      );
    } finally {
      p.destroy();
    }
  } finally {
    doc.destroy();
  }
  return file;
}
