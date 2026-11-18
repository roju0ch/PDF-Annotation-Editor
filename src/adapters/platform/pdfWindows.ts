import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

const PREFIX = "plugin:pdf-open|";
export const PDF_WINDOW_MESSAGES = {
  unavailable:
    "Das PDF-Fenster konnte nicht geöffnet oder geschlossen werden. Bitte erneut versuchen.",
  windowLimit:
    "Es sind bereits 16 PDF-Fenster geöffnet. Bitte zuerst ein Fenster schließen.",
  busy: "Bitte warten, bis die PDF-Verarbeitung oder Speicherung abgeschlossen ist, bevor dieses Fenster geschlossen wird.",
};

export type PdfWindowState = {
  hasDocument: boolean;
  unsaved: boolean;
  busy: boolean;
  fileName: string;
  pageCount: number;
};

type WindowConsumer = {
  getState: () => PdfWindowState;
  askDiscard: () => Promise<boolean>;
  onError: (message: string) => void;
};

export function supportsMultiplePdfWindows() {
  return (
    isTauri() &&
    typeof window !== "undefined" &&
    (window as Window & { __PDF_MULTI_WINDOW__?: boolean })
      .__PDF_MULTI_WINDOW__ === true
  );
}

function windowError(error: unknown) {
  const code =
    error && typeof error === "object"
      ? (error as { code?: unknown }).code
      : undefined;
  return code === "window_limit"
    ? PDF_WINDOW_MESSAGES.windowLimit
    : PDF_WINDOW_MESSAGES.unavailable;
}

export async function newPdfWindow() {
  if (!supportsMultiplePdfWindows())
    throw new Error(PDF_WINDOW_MESSAGES.unavailable);
  try {
    await invoke(PREFIX + "new_pdf_window");
  } catch (error) {
    throw new Error(windowError(error), { cause: error });
  }
}

/** Every command is scoped to the caller by Rust; JavaScript supplies no label. */
export function subscribePdfWindow(consumer: WindowConsumer) {
  let disposed = false;
  let initialized = false;
  let closing = false;
  const stops: UnlistenFn[] = [];
  let previousReport = "";
  let reports = Promise.resolve();
  let waitingReport: PdfWindowState | undefined;

  const reportError = (message: string) => {
    if (!disposed) consumer.onError(message);
  };
  async function cancelClose() {
    try {
      await invoke(PREFIX + "cancel_window_close");
    } catch (error) {
      reportError(windowError(error));
    }
  }

  const ready = (async () => {
    if (!supportsMultiplePdfWindows()) return;
    try {
      const stopClose = await getCurrentWindow().onCloseRequested(
        async (event) => {
          // The SDK otherwise calls its broad window.destroy command after the
          // handler. Our native command can close only this caller's own window.
          event.preventDefault();
          if (disposed || closing) return;
          closing = true;
          try {
            if (consumer.getState().busy) {
              reportError(PDF_WINDOW_MESSAGES.busy);
              await cancelClose();
              return;
            }
            if (consumer.getState().unsaved && !(await consumer.askDiscard())) {
              await cancelClose();
              return;
            }
            if (disposed) return;
            // A programmatic transaction may have started while a confirmation
            // was pending, even though the modal prevents ordinary UI editing.
            if (consumer.getState().busy) {
              reportError(PDF_WINDOW_MESSAGES.busy);
              await cancelClose();
              return;
            }
            await invoke(PREFIX + "close_pdf_window");
          } catch (error) {
            reportError(windowError(error));
            if (!disposed) await cancelClose();
          } finally {
            closing = false;
          }
        },
      );
      if (disposed) {
        stopClose();
        return;
      }
      stops.push(stopClose);
      const stopErrors = await listen<{ code?: unknown }>(
        "pdf-window-error",
        (event) => {
          reportError(windowError(event.payload));
        },
      );
      if (disposed) {
        stopErrors();
        return;
      }
      stops.push(stopErrors);
      initialized = true;
      if (waitingReport) report(waitingReport);
    } catch (error) {
      reportError(windowError(error));
    }
  })();

  function report(state: PdfWindowState) {
    if (disposed || !supportsMultiplePdfWindows()) return;
    const snapshot: PdfWindowState = {
      hasDocument: state.hasDocument,
      unsaved: state.unsaved,
      busy: state.busy,
      fileName: state.fileName,
      pageCount: state.pageCount,
    };
    // Queue the first report until the close listener is installed. Native
    // routing can then trust an empty/occupied state without an unguarded gap.
    if (!initialized) {
      waitingReport = snapshot;
      return;
    }
    waitingReport = undefined;
    const key = JSON.stringify(snapshot);
    if (key === previousReport) return;
    previousReport = key;
    reports = reports.then(async () => {
      if (disposed) return;
      try {
        await invoke(PREFIX + "report_window_state", snapshot);
      } catch (error) {
        reportError(windowError(error));
      }
    });
  }

  return {
    ready,
    report,
    dispose() {
      disposed = true;
      waitingReport = undefined;
      for (const stop of stops) stop();
      if (closing) void cancelClose();
    },
  };
}
