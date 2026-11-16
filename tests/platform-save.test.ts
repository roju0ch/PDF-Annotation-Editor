import { afterEach, expect, it, vi } from "vitest";
import {
  isAndroidApp,
  savePdf,
  usesNativeSave,
} from "../src/adapters/platform/savePdf";

const api = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => api);
const prefix = "plugin:android-bridge|";
const desktopPrefix = "plugin:desktop-save|";
const desktopPlatforms = [
  ["Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"],
  ["macOS", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6)"],
  ["Linux", "Mozilla/5.0 (X11; Linux x86_64)"],
] as const;
const CHUNK = 256 * 1024;
const token = "12345678-1234-1234-1234-123456789abc";

function platform(native = true, userAgent = "Android 16") {
  api.isTauri.mockReturnValue(native);
  vi.stubGlobal("navigator", { userAgent });
  const link = { href: "", download: "", click: vi.fn() };
  vi.stubGlobal("document", { createElement: vi.fn(() => link) });
  const create = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:test-pdf");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return { link, create, revoke };
}

function pdf(size = 32): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = i % 256;
  bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
  return bytes;
}

function nativeReply(
  finished: unknown = { status: "saved", fileName: "Gewählt.pdf" },
  namespace = prefix,
) {
  api.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown>) => {
      if (command === namespace + "begin_pdf_save") return { token };
      if (command === namespace + "append_pdf_save")
        return {
          received:
            Number(args.offset) +
            Buffer.from(String(args.base64), "base64").length,
        };
      if (command === namespace + "finish_pdf_save") return finished;
      if (command === namespace + "abort_pdf_save") return {};
      throw new Error("Unexpected native command");
    },
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it("recognizes only native Android and transfers exact bytes as bounded ordered chunks", async () => {
  const browser = platform();
  expect(isAndroidApp()).toBe(true);
  expect(usesNativeSave()).toBe(true);
  const bytes = pdf(CHUNK * 2 + 97),
    original = bytes.slice();
  const chunks: Buffer[] = [];
  let received = 0;
  api.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown>) => {
      if (command === prefix + "begin_pdf_save") {
        expect(args).toEqual({
          fileName: "Plan__A.pdf",
          byteLength: bytes.length,
        });
        return { token };
      }
      if (command === prefix + "append_pdf_save") {
        expect(args.token).toBe(token);
        expect(args.offset).toBe(received);
        expect(String(args.base64).length).toBeLessThanOrEqual(
          4 * Math.ceil(CHUNK / 3),
        );
        const chunk = Buffer.from(String(args.base64), "base64");
        expect(chunk.length).toBeLessThanOrEqual(CHUNK);
        chunks.push(chunk);
        received += chunk.length;
        return { received };
      }
      expect(command).toBe(prefix + "finish_pdf_save");
      expect(args).toEqual({ token });
      expect(received).toBe(bytes.length);
      return { status: "saved", fileName: "Vom Benutzer gewählt.pdf" };
    },
  );
  expect(await savePdf(bytes, "C:\\privat\\Plan?\nA.PDF")).toEqual({
    status: "saved",
    fileName: "Vom Benutzer gewählt.pdf",
  });
  expect(chunks).toHaveLength(3);
  expect(new Uint8Array(Buffer.concat(chunks))).toEqual(original);
  expect(bytes).toEqual(original);
  expect(bytes.byteLength).toBe(original.byteLength);
  expect(browser.create).not.toHaveBeenCalled();
  expect(browser.link.click).not.toHaveBeenCalled();
});

it("bounds suggested names without cutting a Unicode surrogate pair", async () => {
  platform();
  nativeReply();
  await savePdf(pdf(), "😀".repeat(200) + ".pdf");
  const suggestion = api.invoke.mock.calls[0][1].fileName as string;
  expect(suggestion.length).toBeLessThanOrEqual(180);
  expect(suggestion).toBe("😀".repeat(88) + ".pdf");
});

it("returns cancellation without claiming a successful save or starting a browser download", async () => {
  const browser = platform();
  nativeReply({ status: "cancelled" });
  expect(await savePdf(pdf(), "Plan.pdf")).toEqual({ status: "cancelled" });
  expect(api.invoke.mock.calls.map(([command]) => command)).toEqual([
    prefix + "begin_pdf_save",
    prefix + "append_pdf_save",
    prefix + "finish_pdf_save",
  ]);
  expect(browser.create).not.toHaveBeenCalled();
});

it("keeps an Android picker pending without a browser-style timeout", async () => {
  vi.useFakeTimers();
  const browser = platform();
  let finish!: (value: unknown) => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  nativeReply();
  const ordinary = api.invoke.getMockImplementation()!;
  api.invoke.mockImplementation(
    (command: string, args: Record<string, unknown>) => {
      if (command === prefix + "finish_pdf_save") {
        started();
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      return ordinary(command, args);
    },
  );
  let settled = false;
  const saving = savePdf(pdf(), "Plan.pdf").then((result) => {
    settled = true;
    return result;
  });
  await waiting;
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
  expect(settled).toBe(false);
  expect(browser.create).not.toHaveBeenCalled();
  finish({ status: "cancelled" });
  expect(await saving).toEqual({ status: "cancelled" });
});

it("rejects bad PDF headers and oversized exports before any native or browser write", async () => {
  const browser = platform();
  const tooLarge = new Uint8Array(150 * 1024 * 1024 + 1);
  tooLarge.set([37, 80, 68, 70, 45]);
  for (const bytes of [
    new Uint8Array(),
    new Uint8Array([37, 80, 68, 70]),
    new TextEncoder().encode("<html>"),
    tooLarge,
  ])
    await expect(savePdf(bytes, "Plan.pdf")).rejects.toThrow(
      "gültige PDF bis 150 MB",
    );
  expect(api.invoke).not.toHaveBeenCalled();
  expect(browser.create).not.toHaveBeenCalled();
});

it("rejects malformed begin replies without falling back to an unconfirmed Android download", async () => {
  const browser = platform();
  for (const reply of [
    null,
    {},
    { token: 1 },
    { token: " " },
    { token: "not-a-uuid" },
    { token: "x".repeat(129) },
  ]) {
    api.invoke.mockResolvedValue(reply);
    await expect(savePdf(pdf(), "Plan.pdf")).rejects.toThrow(
      "nicht vorbereitet",
    );
  }
  expect(browser.create).not.toHaveBeenCalled();
});

it("aborts incomplete upload acknowledgements instead of opening the destination picker", async () => {
  const browser = platform();
  for (const reply of [
    null,
    {},
    { received: 0 },
    { received: 31 },
    { received: "32" },
  ]) {
    nativeReply();
    const ordinary = api.invoke.getMockImplementation()!;
    api.invoke.mockImplementation(
      (command: string, args: Record<string, unknown>) =>
        command === prefix + "append_pdf_save"
          ? Promise.resolve(reply)
          : ordinary(command, args),
    );
    await expect(savePdf(pdf(), "Plan.pdf")).rejects.toThrow(
      "nicht vollständig",
    );
  }
  expect(
    api.invoke.mock.calls.filter(
      ([command]) => command === prefix + "abort_pdf_save",
    ),
  ).toHaveLength(5);
  expect(
    api.invoke.mock.calls.some(
      ([command]) => command === prefix + "finish_pdf_save",
    ),
  ).toBe(false);
  expect(browser.create).not.toHaveBeenCalled();
});

it("rejects unconfirmed finish replies and releases the native staging transaction", async () => {
  const browser = platform();
  for (const reply of [
    null,
    {},
    { status: "done" },
    { status: "saved", fileName: "" },
    { status: "saved", fileName: "content://private/file.pdf" },
    { status: "saved", fileName: "bad\nname.pdf" },
  ]) {
    nativeReply(reply);
    await expect(savePdf(pdf(), "Plan.pdf")).rejects.toThrow("nicht bestätigt");
  }
  expect(
    api.invoke.mock.calls.filter(
      ([command]) => command === prefix + "abort_pdf_save",
    ),
  ).toHaveLength(6);
  expect(browser.create).not.toHaveBeenCalled();
});

it("preserves a native write failure even if cleanup also fails", async () => {
  const browser = platform();
  nativeReply();
  const ordinary = api.invoke.getMockImplementation()!;
  api.invoke.mockImplementation(
    (command: string, args: Record<string, unknown>) => {
      if (command === prefix + "finish_pdf_save")
        return Promise.reject({
          code: "write",
          message: "Android konnte die Datei nicht vollständig schreiben.",
        });
      if (command === prefix + "abort_pdf_save")
        return Promise.reject(new Error("cleanup unavailable"));
      return ordinary(command, args);
    },
  );
  await expect(savePdf(pdf(), "Plan.pdf")).rejects.toThrow(
    "nicht vollständig schreiben",
  );
  expect(api.invoke).toHaveBeenLastCalledWith(prefix + "abort_pdf_save", {
    token,
  });
  expect(browser.create).not.toHaveBeenCalled();
});

it("never substitutes a browser download when native permission is denied", async () => {
  const browser = platform();
  api.invoke.mockRejectedValue({
    code: "denied",
    message: "Der Speicherzugriff wurde verweigert.",
  });
  await expect(savePdf(pdf(), "Plan.pdf")).rejects.toThrow("Speicherzugriff");
  expect(browser.create).not.toHaveBeenCalled();
  expect(browser.link.click).not.toHaveBeenCalled();
});

it.each(desktopPlatforms)(
  "%s uses the desktop save bridge and preserves every exported byte",
  async (_name, userAgent) => {
    const browser = platform(true, userAgent);
    expect(isAndroidApp()).toBe(false);
    expect(usesNativeSave()).toBe(true);
    nativeReply(
      { status: "saved", fileName: "Desktop-Plan.pdf" },
      desktopPrefix,
    );
    const bytes = pdf(CHUNK + 97),
      original = bytes.slice();
    expect(await savePdf(bytes, "Plan.pdf")).toEqual({
      status: "saved",
      fileName: "Desktop-Plan.pdf",
    });
    expect(api.invoke.mock.calls.map(([command]) => command)).toEqual([
      desktopPrefix + "begin_pdf_save",
      desktopPrefix + "append_pdf_save",
      desktopPrefix + "append_pdf_save",
      desktopPrefix + "finish_pdf_save",
    ]);
    const chunks = api.invoke.mock.calls
      .filter(([command]) => command === desktopPrefix + "append_pdf_save")
      .map(([, args]) => {
        expect(String(args.base64).length).toBeLessThanOrEqual(
          4 * Math.ceil(CHUNK / 3),
        );
        return Buffer.from(String(args.base64), "base64");
      });
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(original);
    expect(bytes).toEqual(original);
    expect(browser.create).not.toHaveBeenCalled();
    expect(browser.link.click).not.toHaveBeenCalled();
  },
);

it.each(desktopPlatforms)(
  "%s treats a cancelled native dialog as cancellation without a browser fallback",
  async (_name, userAgent) => {
    const browser = platform(true, userAgent);
    nativeReply({ status: "cancelled" }, desktopPrefix);
    expect(await savePdf(pdf(), "Plan.pdf")).toEqual({ status: "cancelled" });
    expect(api.invoke).toHaveBeenLastCalledWith(
      desktopPrefix + "finish_pdf_save",
      { token },
    );
    expect(browser.create).not.toHaveBeenCalled();
    expect(browser.link.click).not.toHaveBeenCalled();
  },
);

it.each(desktopPlatforms)(
  "%s preserves permission, transfer and write failures without claiming a download",
  async (_name, userAgent) => {
    const browser = platform(true, userAgent);
    for (const failure of ["begin", "append", "finish"]) {
      api.invoke.mockClear();
      nativeReply(undefined, desktopPrefix);
      const ordinary = api.invoke.getMockImplementation()!;
      api.invoke.mockImplementation(
        (command: string, args: Record<string, unknown>) => {
          if (command === desktopPrefix + failure + "_pdf_save") {
            if (failure === "append") return Promise.resolve({ received: 0 });
            return Promise.reject({
              message: "Datei konnte nicht geschrieben werden.",
            });
          }
          return ordinary(command, args);
        },
      );
      await expect(savePdf(pdf(), "Plan.pdf")).rejects.toThrow(
        failure === "append" ? "nicht vollständig" : "nicht geschrieben",
      );
      if (failure !== "begin")
        expect(api.invoke).toHaveBeenLastCalledWith(
          desktopPrefix + "abort_pdf_save",
          { token },
        );
      expect(browser.create).not.toHaveBeenCalled();
      expect(browser.link.click).not.toHaveBeenCalled();
      expect(
        api.invoke.mock.calls.some(([command]) =>
          String(command).startsWith(prefix),
        ),
      ).toBe(false);
    }
  },
);

it("preserves browser downloads on every OS while describing only their start", async () => {
  vi.useFakeTimers();
  for (const [native, userAgent] of [
    [false, "Android"],
    [false, "Windows"],
    [false, "Macintosh"],
    [false, "X11; Linux x86_64"],
    [false, "Firefox/145.0"],
  ] as const) {
    const browser = platform(native, userAgent),
      bytes = pdf();
    expect(isAndroidApp()).toBe(false);
    expect(usesNativeSave()).toBe(false);
    expect(await savePdf(bytes, "Plan-annotiert.pdf")).toEqual({
      status: "download-started",
    });
    expect(browser.link).toMatchObject({
      href: "blob:test-pdf",
      download: "Plan-annotiert.pdf",
    });
    expect(browser.link.click).toHaveBeenCalledOnce();
    const blob = browser.create.mock.calls.at(-1)![0] as Blob;
    expect(blob.type).toBe("application/pdf");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(browser.revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect(browser.revoke).toHaveBeenCalledWith("blob:test-pdf");
    vi.restoreAllMocks();
  }
  expect(api.invoke).not.toHaveBeenCalled();
});

it("releases a browser Blob URL when starting the download itself fails", async () => {
  const browser = platform(false);
  browser.link.click.mockImplementation(() => {
    throw new Error("Download blockiert");
  });
  await expect(savePdf(pdf(), "Plan.pdf")).rejects.toThrow(
    "Download blockiert",
  );
  expect(browser.revoke).toHaveBeenCalledWith("blob:test-pdf");
});
