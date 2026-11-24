import { afterEach, expect, it, vi } from "vitest";
import {
  PDF_OPEN_MESSAGES,
  subscribePdfOpens,
  type PdfOpenOutcome,
} from "../src/adapters/platform/openPdf";

const api = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => api);
vi.mock("@tauri-apps/api/event", () => ({ listen: api.listen }));
const prefix = "plugin:pdf-open|";
const chunkSize = 256 * 1024;
const id = "12345678-1234-1234-1234-123456789abc";
const secondId = "12345678-1234-1234-1234-123456789def";
type Entry = { value: unknown; bytes?: Uint8Array };
const subscriptions: ReturnType<typeof subscribePdfOpens>[] = [];

function pdf(size = 32) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = i % 256;
  bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
  return bytes;
}
function entry(
  token = id,
  bytes = pdf(),
  name = "Plan mit Räumen №1.pdf",
): Entry {
  return {
    value: { id: token, fileName: name, byteLength: bytes.length },
    bytes,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
function native(entries: Entry[] = []) {
  api.isTauri.mockReturnValue(true);
  const queue = [...entries];
  const stop = vi.fn();
  let signal = () => {};
  const log: string[] = [];
  api.listen.mockImplementation(async (event: string, callback: () => void) => {
    expect(event).toBe("pdf-open-available");
    log.push("listen");
    signal = callback;
    return stop;
  });
  const finished: string[] = [];
  api.invoke.mockImplementation(
    async (command: string, args?: { id: string; offset?: number }) => {
      log.push(command);
      if (command === prefix + "next_pdf_open") return queue[0]?.value ?? null;
      if (command === prefix + "read_pdf_open") {
        expect(args?.id).toBe((queue[0].value as { id: string }).id);
        const offset = args!.offset!;
        return {
          offset,
          base64: Buffer.from(
            queue[0].bytes!.subarray(offset, offset + chunkSize),
          ).toString("base64"),
        };
      }
      if (command === prefix + "finish_pdf_open") {
        expect(args?.id).toBe((queue[0].value as { id: string }).id);
        finished.push(args!.id);
        queue.shift();
        return;
      }
      throw Error("Unexpected native command");
    },
  );
  const state = { busy: false };
  const onFile = vi.fn(async (file: File): Promise<PdfOpenOutcome> => {
    void file;
    return "handled";
  });
  const onError = vi.fn();
  const subscribe = () => {
    const controller = subscribePdfOpens({
      canOpen: () => !state.busy,
      onFile,
      onError,
    });
    subscriptions.push(controller);
    return controller;
  };
  return {
    queue,
    stop,
    signal: () => signal(),
    log,
    finished,
    state,
    onFile,
    onError,
    subscribe,
  };
}

afterEach(() => {
  subscriptions.splice(0).forEach((subscription) => subscription.dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("does not touch native IPC or event subscriptions in the browser", async () => {
  const host = native([entry()]);
  api.isTauri.mockReturnValue(false);
  const subscription = host.subscribe();
  await subscription.ready;
  subscription.wake();
  expect(api.listen).not.toHaveBeenCalled();
  expect(api.invoke).not.toHaveBeenCalled();
  expect(host.onFile).not.toHaveBeenCalled();
});

it("subscribes before draining a cold-start PDF and preserves exact multi-chunk bytes and Unicode name", async () => {
  const bytes = pdf(chunkSize * 2 + 97);
  const host = native([entry(id, bytes)]);
  host.subscribe();
  await vi.waitFor(() => expect(host.finished).toEqual([id]));
  expect(host.log[0]).toBe("listen");
  expect(host.onFile).toHaveBeenCalledOnce();
  const file = host.onFile.mock.calls[0][0];
  expect(file.name).toBe("Plan mit Räumen №1.pdf");
  expect(file.type).toBe("application/pdf");
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  expect(
    api.invoke.mock.calls
      .filter(([command]) => command === prefix + "read_pdf_open")
      .map(([, args]) => args.offset),
  ).toEqual([0, chunkSize, chunkSize * 2]);
  expect(host.onError).not.toHaveBeenCalled();
});

it("retains only an accepted origin when two queued PDFs share a basename", async () => {
  const host = native([entry(id), entry(secondId)]);
  host.onFile.mockResolvedValueOnce("opened").mockResolvedValueOnce("handled");
  host.subscribe();
  await vi.waitFor(() => expect(host.finished).toEqual([id, secondId]));
  expect(
    api.invoke.mock.calls
      .filter(([cmd]) => cmd === prefix + "finish_pdf_open")
      .map(([, args]) => args),
  ).toEqual([
    { id, opened: true },
    { id: secondId, opened: false },
  ]);
});

it("does not poll an idle native queue when ordinary view renders resume readiness", async () => {
  const host = native();
  const subscription = host.subscribe();
  await subscription.ready;
  await Promise.resolve();
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith(prefix + "next_pdf_open");
  api.invoke.mockClear();
  // A new source needs an OS availability notification. Callback/readiness
  // updates alone must not discover it by polling on every pan/zoom render.
  host.queue.push(entry());
  for (let render = 0; render < 100; render++) subscription.resume();
  await Promise.resolve();
  expect(api.invoke).not.toHaveBeenCalled();
  expect(host.onFile).not.toHaveBeenCalled();
  host.signal();
  await vi.waitFor(() => expect(host.finished).toEqual([id]));
  expect(host.onFile).toHaveBeenCalledOnce();
});

it("handles warm opens in order and coalesces repeated availability events while importing", async () => {
  const host = native();
  host.subscribe();
  await vi.waitFor(() => expect(api.invoke).toHaveBeenCalled());
  const pending = deferred<PdfOpenOutcome>();
  host.onFile.mockImplementationOnce(() => pending.promise);
  host.queue.push(entry(), entry(secondId, pdf(50), "Weitere Datei.pdf"));
  host.signal();
  await vi.waitFor(() => expect(host.onFile).toHaveBeenCalledOnce());
  for (let i = 0; i < 10; i++) host.signal();
  expect(host.finished).toEqual([]);
  pending.resolve("handled");
  await vi.waitFor(() => expect(host.finished).toEqual([id, secondId]));
  expect(host.onFile).toHaveBeenCalledTimes(2);
  expect(host.onError).not.toHaveBeenCalled();
});

it("rechecks a staging completion event received while next still returns its earlier null result", async () => {
  const host = native();
  const next = deferred<unknown>();
  const original = api.invoke.getMockImplementation()!;
  let waiting = true;
  api.invoke.mockImplementation((command: string, args: unknown) => {
    if (command === prefix + "next_pdf_open" && waiting) {
      waiting = false;
      return next.promise;
    }
    return original(command, args);
  });
  host.subscribe();
  await vi.waitFor(() => expect(waiting).toBe(false));
  // Native staging finishes after next started, but before its null reply has
  // arrived in JS. That notification must trigger a second check, not vanish.
  host.queue.push(entry());
  host.signal();
  next.resolve(null);
  await vi.waitFor(() => expect(host.finished).toEqual([id]));
  expect(host.onFile).toHaveBeenCalledOnce();
  expect(host.onError).not.toHaveBeenCalled();
});

it("keeps requests in the native queue while the editor is busy and resumes explicitly", async () => {
  const host = native([entry()]);
  host.state.busy = true;
  const subscription = host.subscribe();
  await subscription.ready;
  host.signal();
  expect(api.invoke).not.toHaveBeenCalled();
  for (let render = 0; render < 10; render++) subscription.resume();
  expect(api.invoke).not.toHaveBeenCalled();
  host.state.busy = false;
  subscription.resume();
  await vi.waitFor(() => expect(host.finished).toEqual([id]));
  expect(host.onFile).toHaveBeenCalledOnce();
});

it("does not acknowledge when readiness changes during transfer and reuses the bounded File on resume", async () => {
  const host = native([entry()]);
  const original = api.invoke.getMockImplementation()!;
  api.invoke.mockImplementation(async (command: string, args: unknown) => {
    const result = await original(command, args);
    if (command === prefix + "read_pdf_open") host.state.busy = true;
    return result;
  });
  const subscription = host.subscribe();
  await vi.waitFor(() => expect(host.state.busy).toBe(true));
  expect(host.finished).toEqual([]);
  expect(host.onFile).not.toHaveBeenCalled();
  host.state.busy = false;
  subscription.resume();
  await vi.waitFor(() => expect(host.finished).toEqual([id]));
  expect(
    api.invoke.mock.calls.filter(
      ([command]) => command === prefix + "read_pdf_open",
    ),
  ).toHaveLength(1);
});

it("keeps a deferred document switch pending and consumes it only after the shared importer handles it", async () => {
  const host = native([entry()]);
  host.onFile.mockImplementationOnce(async () => {
    // A short transaction may complete without React ever observing a busy
    // render. The retained File must still resume on its next passive effect.
    host.state.busy = true;
    host.state.busy = false;
    return "deferred";
  });
  const subscription = host.subscribe();
  await vi.waitFor(() => expect(host.onFile).toHaveBeenCalledOnce());
  expect(host.finished).toEqual([]);
  subscription.resume();
  await vi.waitFor(() => expect(host.finished).toEqual([id]));
  expect(host.onFile).toHaveBeenCalledTimes(2);
  expect(
    api.invoke.mock.calls.filter(
      ([command]) => command === prefix + "read_pdf_open",
    ),
  ).toHaveLength(1);
});

it("maps provider errors without exposing paths and continues to the next native request", async () => {
  const host = native([
    {
      value: {
        id,
        error: { code: "denied", message: "secret content://private/provider" },
      },
    },
    entry(secondId),
  ]);
  host.subscribe();
  await vi.waitFor(() => expect(host.finished).toEqual([id, secondId]));
  expect(host.onError).toHaveBeenCalledExactlyOnceWith(
    PDF_OPEN_MESSAGES.denied,
  );
  expect(host.onFile).toHaveBeenCalledOnce();
});

it("explains a full native staging queue with a fixed message and consumes its error entry", async () => {
  const host = native([
    {
      value: {
        id,
        error: {
          code: "queue_full",
          message: "untrusted content://provider/private.pdf",
        },
      },
    },
  ]);
  host.subscribe();
  await vi.waitFor(() => expect(host.finished).toEqual([id]));
  expect(host.onFile).not.toHaveBeenCalled();
  expect(host.onError).toHaveBeenCalledExactlyOnceWith(
    PDF_OPEN_MESSAGES.queueFull,
  );
});

it.each([
  { id, fileName: "oversized.pdf", byteLength: 100 * 1024 * 1024 + 1 },
  { id, fileName: "zero.pdf", byteLength: 0 },
  { id, fileName: "bad.pdf", byteLength: 5.5 },
  { id, fileName: "../private.pdf", byteLength: 32 },
  { id, fileName: "bad\nname.pdf", byteLength: 32 },
])(
  "rejects invalid metadata before allocation or reading: %j",
  async (value) => {
    const host = native([{ value }]);
    host.subscribe();
    await vi.waitFor(() => expect(host.finished).toEqual([id]));
    expect(host.onError).toHaveBeenCalledExactlyOnceWith(
      PDF_OPEN_MESSAGES.badFile,
    );
    expect(host.onFile).not.toHaveBeenCalled();
    expect(
      api.invoke.mock.calls.some(
        ([command]) => command === prefix + "read_pdf_open",
      ),
    ).toBe(false);
  },
);

it.each([
  { offset: 1, base64: Buffer.from(pdf()).toString("base64") },
  { offset: 0, base64: "%%%=" },
  { offset: 0, base64: Buffer.from(pdf(31)).toString("base64") },
  { offset: 0, base64: "" },
  { offset: 0, base64: "A".repeat(4 * Math.ceil(chunkSize / 3) + 4) },
])(
  "rejects truncated, misplaced or malformed native chunks without importing: %j",
  async (reply) => {
    const host = native([entry()]);
    const original = api.invoke.getMockImplementation()!;
    api.invoke.mockImplementation((command: string, args: unknown) =>
      command === prefix + "read_pdf_open"
        ? Promise.resolve(reply)
        : original(command, args),
    );
    host.subscribe();
    await vi.waitFor(() => expect(host.finished).toEqual([id]));
    expect(host.onFile).not.toHaveBeenCalled();
    expect(host.onError).toHaveBeenCalledExactlyOnceWith(
      PDF_OPEN_MESSAGES.unavailable,
    );
  },
);

it("unsubscribes a listener that resolves after disposal without reading the queue", async () => {
  const host = native([entry()]);
  const listener = deferred<() => void>();
  api.listen.mockReturnValue(listener.promise);
  const subscription = host.subscribe();
  subscription.dispose();
  listener.resolve(host.stop);
  await subscription.ready;
  expect(host.stop).toHaveBeenCalledOnce();
  expect(api.invoke).not.toHaveBeenCalled();
});

it("leaves an interrupted read unacknowledged so a remount can replay from offset zero", async () => {
  const host = native([entry()]);
  const read = deferred<unknown>();
  const original = api.invoke.getMockImplementation()!;
  api.invoke.mockImplementation((command: string, args: unknown) =>
    command === prefix + "read_pdf_open"
      ? read.promise
      : original(command, args),
  );
  const first = host.subscribe();
  await vi.waitFor(() =>
    expect(
      api.invoke.mock.calls.some(([c]) => c === prefix + "read_pdf_open"),
    ).toBe(true),
  );
  first.dispose();
  read.resolve({ offset: 0, base64: Buffer.from(pdf()).toString("base64") });
  await Promise.resolve();
  api.invoke.mockImplementation(original);
  host.subscribe();
  await vi.waitFor(() => expect(host.finished).toEqual([id]));
  expect(host.onFile).toHaveBeenCalledOnce();
  expect(
    api.invoke.mock.calls
      .filter(([c]) => c === prefix + "read_pdf_open")
      .map(([, args]) => args.offset),
  ).toEqual([0, 0]);
});

it("retries an acknowledgement without importing the same request twice", async () => {
  const host = native([entry()]);
  const original = api.invoke.getMockImplementation()!;
  let failures = 1;
  api.invoke.mockImplementation((command: string, args: unknown) => {
    if (command === prefix + "finish_pdf_open" && failures-- > 0)
      return Promise.reject(Error("private path"));
    return original(command, args);
  });
  const subscription = host.subscribe();
  await vi.waitFor(() => expect(host.onError).toHaveBeenCalledOnce());
  expect(host.finished).toEqual([]);
  subscription.wake();
  await vi.waitFor(() => expect(host.finished).toEqual([id]));
  expect(host.onFile).toHaveBeenCalledOnce();
});
