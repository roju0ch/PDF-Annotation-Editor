import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const PDF_OPEN_MESSAGES = {
  badFile: "Bitte eine gültige PDF-Datei auswählen (maximal 100 MB).",
  unavailable:
    "Die übergebene PDF konnte nicht geöffnet werden. Bitte die Datei erneut über „Öffnen mit“ auswählen.",
  denied:
    "Der Zugriff auf die übergebene PDF wurde nicht erlaubt. Bitte die Datei erneut über „Öffnen mit“ auswählen.",
  queueFull:
    "Zu viele PDFs warten auf das Öffnen. Bitte die Datei erneut einzeln über „Öffnen mit“ auswählen.",
};

const MAX_BYTES = 100 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;
const PREFIX = "plugin:pdf-open|";
type IncomingPdf = { id: string; fileName: string; byteLength: number };
export type PdfOpenOutcome = "handled" | "deferred";
type Consumer = {
  canOpen: () => boolean;
  onFile: (file: File) => Promise<PdfOpenOutcome>;
  onError: (message: string) => void;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
  );
}

function descriptor(value: Record<string, unknown>): IncomingPdf {
  if (
    !validId(value.id) ||
    typeof value.fileName !== "string" ||
    !value.fileName.trim() ||
    value.fileName.length > 255 ||
    /[\\/\p{Cc}]/u.test(value.fileName) ||
    !Number.isSafeInteger(value.byteLength) ||
    Number(value.byteLength) < 5 ||
    Number(value.byteLength) > MAX_BYTES
  )
    throw new Error(PDF_OPEN_MESSAGES.badFile);
  return value as IncomingPdf;
}

function nativeError(value: unknown): string {
  const code = object(value)?.code;
  if (code === "invalid" || code === "too_large")
    return PDF_OPEN_MESSAGES.badFile;
  if (code === "denied") return PDF_OPEN_MESSAGES.denied;
  if (code === "queue_full") return PDF_OPEN_MESSAGES.queueFull;
  // Provider exception strings can contain private paths/URIs. Only fixed
  // messages selected by a known error code cross into the user interface.
  return PDF_OPEN_MESSAGES.unavailable;
}

async function readFile(pdf: IncomingPdf, alive: () => boolean) {
  const bytes = new Uint8Array(pdf.byteLength);
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    const chunk = object(
      await invoke(PREFIX + "read_pdf_open", { id: pdf.id, offset }),
    );
    if (!alive()) return null;
    if (
      chunk?.offset !== offset ||
      typeof chunk.base64 !== "string" ||
      !chunk.base64.length ||
      chunk.base64.length > 4 * Math.ceil(CHUNK_BYTES / 3) ||
      chunk.base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk.base64)
    )
      throw new Error(PDF_OPEN_MESSAGES.unavailable);
    const decoded = atob(chunk.base64);
    if (
      decoded.length !== Math.min(CHUNK_BYTES, bytes.length - offset) ||
      btoa(decoded) !== chunk.base64
    )
      throw new Error(PDF_OPEN_MESSAGES.unavailable);
    for (let i = 0; i < decoded.length; i++)
      bytes[offset + i] = decoded.charCodeAt(i);
  }
  // File joins the very same App.open(File) path as a file input or drop. PDF
  // parsing and annotation handling remain exclusively in the existing worker.
  return new File([bytes], pdf.fileName, { type: "application/pdf" });
}

/** Subscribe before checking the OS-owned queue, so startup cannot lose an open. */
export function subscribePdfOpens(consumer: Consumer) {
  let disposed = false;
  let initialized = false;
  let active = false;
  let requested = false;
  let unlisten: UnlistenFn | undefined;
  let pending: { pdf: IncomingPdf; file: File } | undefined;
  const handled = new Set<string>();

  const remember = (id: string) => {
    handled.add(id);
    if (handled.size > 256) handled.delete(handled.values().next().value!);
  };

  async function drain() {
    if (active || disposed || !initialized) return;
    active = true;
    const seen = new Set<string>();
    try {
      do {
        requested = false;
        while (!disposed && consumer.canOpen()) {
          const value = pending
            ? pending.pdf
            : await invoke<unknown>(PREFIX + "next_pdf_open");
          if (disposed || value === null) break;
          const raw = object(value);
          if (!raw || !validId(raw.id))
            throw new Error(PDF_OPEN_MESSAGES.unavailable);
          const id = raw.id;
          if (seen.has(id)) throw new Error(PDF_OPEN_MESSAGES.unavailable);
          seen.add(id);
          if (!handled.has(id)) {
            try {
              if ("error" in raw) {
                consumer.onError(nativeError(raw.error));
              } else {
                const pdf = descriptor(raw);
                const file =
                  pending?.file ?? (await readFile(pdf, () => !disposed));
                if (disposed || !file) return;
                pending = { pdf, file };
                if (!consumer.canOpen()) {
                  requested = false;
                  return;
                }
                const result = await consumer.onFile(file);
                if (disposed) return;
                if (result === "deferred") {
                  requested = false;
                  return;
                }
              }
            } catch (error) {
              if (disposed) return;
              consumer.onError(
                error instanceof Error &&
                  error.message === PDF_OPEN_MESSAGES.badFile
                  ? PDF_OPEN_MESSAGES.badFile
                  : PDF_OPEN_MESSAGES.unavailable,
              );
            }
            remember(id);
          }
          // Keep the native head until the shared importer has completed or the
          // user has declined a document switch. Disposal never acknowledges a
          // request still being read, so React remounts can replay from offset 0.
          if (disposed) return;
          await invoke(PREFIX + "finish_pdf_open", { id });
          pending = undefined;
        }
      } while (requested && !disposed && consumer.canOpen());
    } catch {
      requested = false;
      if (!disposed) consumer.onError(PDF_OPEN_MESSAGES.unavailable);
    } finally {
      active = false;
      if (requested) resume();
    }
  }

  // A render is only a readiness update, not evidence of a new OS document.
  // Never poll an idle native queue while zooming, panning or editing.
  function resume() {
    if (
      !disposed &&
      initialized &&
      !active &&
      (requested || pending) &&
      consumer.canOpen()
    )
      void drain();
  }

  function wake() {
    if (disposed) return;
    requested = true;
    resume();
  }

  const ready = (async () => {
    if (!isTauri()) return;
    try {
      const stop = await listen("pdf-open-available", wake);
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      initialized = true;
      wake();
    } catch {
      if (!disposed) consumer.onError(PDF_OPEN_MESSAGES.unavailable);
    }
  })();

  return {
    ready,
    wake,
    resume,
    dispose() {
      disposed = true;
      pending = undefined;
      unlisten?.();
    },
  };
}
