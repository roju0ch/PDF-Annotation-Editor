import { afterEach, expect, it, vi } from "vitest";
import {
  readClipboardImage,
  writeClipboardText,
} from "../src/adapters/platform/clipboard";
import { MAX_IMAGE_BYTES } from "../src/core/annotations/image";
const api = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => api);
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==";
function platform(native: boolean, userAgent = "Android") {
  api.isTauri.mockReturnValue(native);
  const read = vi
    .fn()
    .mockRejectedValue(new Error("WebView denies browser clipboard"));
  vi.stubGlobal("navigator", { userAgent, clipboard: { read } });
  return read;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
it("uses native Android clipboard even when WebView browser clipboard is denied", async () => {
  const browserRead = platform(true);
  api.invoke.mockResolvedValue({ mimeType: "image/png", base64: png });
  const blob = await readClipboardImage();
  expect(blob.type).toBe("image/png");
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
    Uint8Array.from(Buffer.from(png, "base64")),
  );
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith(
    "plugin:android-bridge|read_clipboard_image",
  );
  expect(browserRead).not.toHaveBeenCalled();
});
it("preserves browser clipboard on browser Android and Tauri desktop", async () => {
  for (const [native, ua] of [
    [false, "Android"],
    [true, "Windows"],
  ] as const) {
    const read = platform(native, ua);
    const picture = new Blob([Buffer.from(png, "base64")], {
      type: "image/png",
    });
    read.mockResolvedValue([
      { types: ["text/plain", "image/png"], getType: async () => picture },
    ]);
    expect(await readClipboardImage()).toBe(picture);
  }
  expect(api.invoke).not.toHaveBeenCalled();
});
it("reports revoked native access without silently falling back to WebView permissions", async () => {
  const read = platform(true);
  api.invoke.mockRejectedValue({
    message: "Zugriff abgelaufen. Bild erneut kopieren.",
  });
  await expect(readClipboardImage()).rejects.toThrow("Zugriff abgelaufen");
  expect(read).not.toHaveBeenCalled();
});
it("rejects invalid, oversized and oversized-dimension native image payloads", async () => {
  platform(true);
  const huge = Buffer.from(png, "base64");
  huge.writeUInt32BE(100000, 16);
  for (const payload of [
    null,
    { mimeType: "text/html", base64: png },
    { mimeType: "image/png", base64: "not base64!!" },
    { mimeType: "image/png", base64: "eA==" },
    {
      mimeType: "image/png",
      base64: "A".repeat(4 * Math.ceil(MAX_IMAGE_BYTES / 3) + 4),
    },
    { mimeType: "image/png", base64: huge.toString("base64") },
  ]) {
    api.invoke.mockResolvedValue(payload);
    await expect(readClipboardImage()).rejects.toThrow();
  }
});
it("keeps browser denial and empty clipboard messages actionable", async () => {
  const read = platform(false);
  await expect(readClipboardImage()).rejects.toThrow("Kein Zugriff");
  read.mockResolvedValue([{ types: ["text/plain"] }]);
  await expect(readClipboardImage()).rejects.toThrow("Kein PNG-/JPEG-Bild");
});

it("passes only plain selected text to the native Android write command and propagates refusal", async () => {
  platform(true);
  const text = "Grüße & Öl\nZweite Zeile!";
  await writeClipboardText(text);
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith(
    "plugin:android-bridge|write_clipboard_text",
    { text },
  );
  api.invoke.mockRejectedValueOnce(new Error("Kein Zugriff"));
  await expect(writeClipboardText(text)).rejects.toThrow("Kein Zugriff");
});
