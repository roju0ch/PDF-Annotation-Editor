import { afterEach, expect, it, vi } from "vitest";
import {
  newPdfWindow,
  PDF_WINDOW_MESSAGES,
  subscribePdfWindow,
  supportsMultiplePdfWindows,
  type PdfWindowState,
} from "../src/adapters/platform/pdfWindows";

const api = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  listen: vi.fn(),
  getCurrentWindow: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => api);
vi.mock("@tauri-apps/api/event", () => ({ listen: api.listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: api.getCurrentWindow,
}));

const prefix = "plugin:pdf-open|";
type CloseEvent = { preventDefault: () => void };
type CloseHandler = (event: CloseEvent) => void | Promise<void>;
const controllers: ReturnType<typeof subscribePdfWindow>[] = [];
const clean: PdfWindowState = {
  hasDocument: true,
  unsaved: false,
  busy: false,
  fileName: "Plan Süd №1.pdf",
  pageCount: 3,
};
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
function native(marker = true) {
  api.isTauri.mockReturnValue(true);
  vi.stubGlobal("window", { __PDF_MULTI_WINDOW__: marker });
  api.invoke.mockResolvedValue(undefined);
  let close: CloseHandler | undefined;
  let signal: ((event: { payload: unknown }) => void) | undefined;
  const stopClose = vi.fn();
  const stopErrors = vi.fn();
  api.getCurrentWindow.mockReturnValue({
    onCloseRequested: vi.fn(async (handler: CloseHandler) => {
      close = handler;
      return stopClose;
    }),
  });
  api.listen.mockImplementation(async (name, handler) => {
    expect(name).toBe("pdf-window-error");
    signal = handler;
    return stopErrors;
  });
  const current = { state: { ...clean } };
  const askDiscard = vi.fn(async () => false);
  const onError = vi.fn();
  const controller = subscribePdfWindow({
    getState: () => current.state,
    askDiscard,
    onError,
  });
  controllers.push(controller);
  return {
    controller,
    current,
    askDiscard,
    onError,
    stopClose,
    stopErrors,
    signal: (payload: unknown) => signal?.({ payload }),
    fire: () => {
      const event = { preventDefault: vi.fn() };
      const done = Promise.resolve(close?.(event));
      return { event, done };
    },
  };
}
afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.dispose();
  await flush();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("enables additional windows only for the native Mac feature marker", async () => {
  const test = native(false);
  await test.controller.ready;
  test.controller.report(clean);
  expect(supportsMultiplePdfWindows()).toBe(false);
  expect(api.getCurrentWindow).not.toHaveBeenCalled();
  expect(api.listen).not.toHaveBeenCalled();
  expect(api.invoke).not.toHaveBeenCalled();
  vi.stubGlobal("window", { __PDF_MULTI_WINDOW__: true });
  api.isTauri.mockReturnValue(false);
  expect(supportsMultiplePdfWindows()).toBe(false);
  await expect(newPdfWindow()).rejects.toThrow(PDF_WINDOW_MESSAGES.unavailable);
  expect(api.invoke).not.toHaveBeenCalled();
});

it("creates a native window without accepting an arbitrary URL or label", async () => {
  const test = native();
  await test.controller.ready;
  await newPdfWindow();
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith(prefix + "new_pdf_window");
});

it("reports only real document state changes and never sends label/path authority", async () => {
  const test = native();
  // The initial empty state waits until the safe close listener exists.
  test.controller.report({
    ...clean,
    hasDocument: false,
    fileName: "",
    pageCount: 0,
  });
  expect(api.invoke).not.toHaveBeenCalled();
  await test.controller.ready;
  await flush();
  for (let i = 0; i < 100; i++)
    test.controller.report({
      ...clean,
      hasDocument: false,
      fileName: "",
      pageCount: 0,
    });
  await flush();
  expect(api.invoke).toHaveBeenCalledTimes(1);
  test.controller.report(clean);
  test.controller.report({ ...clean, unsaved: true });
  await flush();
  expect(api.invoke.mock.calls).toEqual([
    [
      prefix + "report_window_state",
      { ...clean, hasDocument: false, fileName: "", pageCount: 0 },
    ],
    [prefix + "report_window_state", clean],
    [prefix + "report_window_state", { ...clean, unsaved: true }],
  ]);
});

it("keeps native state reports ordered while an earlier report is still pending", async () => {
  const test = native();
  await test.controller.ready;
  const first = deferred<void>();
  api.invoke.mockReturnValueOnce(first.promise);
  test.controller.report({ ...clean, busy: true });
  test.controller.report(clean);
  await flush();
  expect(api.invoke).toHaveBeenCalledTimes(1);
  first.resolve();
  await flush();
  expect(api.invoke.mock.calls.map((call) => call[1].busy)).toEqual([
    true,
    false,
  ]);
});

it("prevents the SDK broad destroy path and closes only the caller when clean", async () => {
  const test = native();
  await test.controller.ready;
  const request = test.fire();
  expect(request.event.preventDefault).toHaveBeenCalledTimes(1);
  await request.done;
  expect(test.askDiscard).not.toHaveBeenCalled();
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith(
    prefix + "close_pdf_window",
  );
});

it("cancelling a dirty-window close preserves it and cancels a pending native quit", async () => {
  const test = native();
  await test.controller.ready;
  test.current.state.unsaved = true;
  await test.fire().done;
  expect(test.askDiscard).toHaveBeenCalledTimes(1);
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith(
    prefix + "cancel_window_close",
  );
});

it("confirmed dirty-window close uses the owning-window command only once", async () => {
  const test = native();
  await test.controller.ready;
  test.current.state.unsaved = true;
  test.askDiscard.mockResolvedValue(true);
  await test.fire().done;
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith(
    prefix + "close_pdf_window",
  );
});

it("does not duplicate a close confirmation while a previous request is unanswered", async () => {
  const test = native();
  await test.controller.ready;
  test.current.state.unsaved = true;
  const decision = deferred<boolean>();
  test.askDiscard.mockReturnValue(decision.promise);
  const first = test.fire();
  const second = test.fire();
  expect(first.event.preventDefault).toHaveBeenCalled();
  expect(second.event.preventDefault).toHaveBeenCalled();
  expect(test.askDiscard).toHaveBeenCalledTimes(1);
  decision.resolve(true);
  await Promise.all([first.done, second.done]);
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith(
    prefix + "close_pdf_window",
  );
});

it("blocks close during save/import and never discards an in-flight transaction", async () => {
  const test = native();
  await test.controller.ready;
  test.current.state.busy = true;
  test.current.state.unsaved = true;
  await test.fire().done;
  expect(test.askDiscard).not.toHaveBeenCalled();
  expect(test.onError).toHaveBeenCalledWith(PDF_WINDOW_MESSAGES.busy);
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith(
    prefix + "cancel_window_close",
  );
});

it("rechecks processing if a transaction starts during the close decision", async () => {
  const test = native();
  await test.controller.ready;
  test.current.state.unsaved = true;
  const decision = deferred<boolean>();
  test.askDiscard.mockReturnValue(decision.promise);
  const request = test.fire();
  test.current.state.busy = true;
  decision.resolve(true);
  await request.done;
  expect(test.onError).toHaveBeenCalledWith(PDF_WINDOW_MESSAGES.busy);
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith(
    prefix + "cancel_window_close",
  );
});

it("never closes after the consumer has unmounted while a decision is pending", async () => {
  const test = native();
  await test.controller.ready;
  test.current.state.unsaved = true;
  const decision = deferred<boolean>();
  test.askDiscard.mockReturnValue(decision.promise);
  const request = test.fire();
  test.controller.dispose();
  decision.resolve(true);
  await request.done;
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith(
    prefix + "cancel_window_close",
  );
  expect(test.stopClose).toHaveBeenCalledTimes(1);
  expect(test.stopErrors).toHaveBeenCalledTimes(1);
});

it("releases a listener that resolves after disposal", async () => {
  const wait = deferred<() => void>();
  api.isTauri.mockReturnValue(true);
  vi.stubGlobal("window", { __PDF_MULTI_WINDOW__: true });
  api.getCurrentWindow.mockReturnValue({
    onCloseRequested: () => wait.promise,
  });
  const controller = subscribePdfWindow({
    getState: () => clean,
    askDiscard: async () => false,
    onError: vi.fn(),
  });
  controllers.push(controller);
  controller.dispose();
  const stop = vi.fn();
  wait.resolve(stop);
  await controller.ready;
  expect(stop).toHaveBeenCalledTimes(1);
  expect(api.listen).not.toHaveBeenCalled();
  expect(api.invoke).not.toHaveBeenCalled();
});

it("maps only trusted error codes and never exposes provider messages or paths", async () => {
  const test = native();
  await test.controller.ready;
  test.signal({ code: "window_limit", message: "/private/document.pdf" });
  expect(test.onError).toHaveBeenLastCalledWith(
    PDF_WINDOW_MESSAGES.windowLimit,
  );
  test.signal({ code: "unknown", message: "/private/document.pdf" });
  expect(test.onError).toHaveBeenLastCalledWith(
    PDF_WINDOW_MESSAGES.unavailable,
  );
  api.invoke.mockRejectedValue({
    code: "window_limit",
    message: "/private/document.pdf",
  });
  await expect(newPdfWindow()).rejects.toThrow(PDF_WINDOW_MESSAGES.windowLimit);
});
