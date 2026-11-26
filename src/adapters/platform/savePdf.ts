import { invoke, isTauri } from "@tauri-apps/api/core";
import { isIosApp } from "./ios";

export type PdfFile = { fileName: string; sourceId?: string };

export type SaveResult =
  | ({ status: "saved" } & PdfFile)
  | { status: "cancelled" }
  | { status: "download-started" };

const MAX_PDF_BYTES = 150 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;
/** Installed apps always use their native save bridge, never a WebView download. */
export function usesNativeSave() {
  return isTauri();
}

export function isAndroidApp() {
  return (
    isTauri() &&
    typeof navigator !== "undefined" &&
    /\bAndroid\b/i.test(navigator.userAgent)
  );
}

function suggestedFileName(value: string) {
  // Keep legal basenames verbatim, including mixed-case extensions and characters
  // such as ":" that are valid on Unix. The system picker makes the final choice.
  if (
    value.length <= 255 &&
    /\.pdf$/i.test(value) &&
    !/[\\/\p{Cc}]/u.test(value) &&
    !(/^Win/i.test(navigator.platform) && /[<>:"|?*]/.test(value))
  )
    return value;
  const name = value
    .split(/[\\/]/)
    .at(-1)!
    .replace(/[\p{Cc}<>:"|?*]/gu, "_")
    .trim()
    .replace(/\.+$/, "");
  const base = name.replace(/\.pdf$/i, "") || "Dokument";
  let bounded = "";
  // Keep the entire suggestion within 255 UTF-16 units, including its suffix.
  for (const character of base) {
    if (bounded.length + character.length > 251) break;
    bounded += character;
  }
  return bounded + (name.match(/\.pdf$/i)?.[0] ?? ".pdf");
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function saveError(error: unknown): Error {
  if (error instanceof Error) return error;
  const message = typeof error === "string" ? error : object(error)?.message;
  return new Error(
    typeof message === "string" && message.trim()
      ? message
      : "Die PDF konnte nicht gespeichert werden. Bitte erneut versuchen.",
    { cause: error },
  );
}

function base64(bytes: Uint8Array<ArrayBuffer>) {
  let binary = "";
  // Spreading a whole 256-KiB chunk exceeds some WebViews' argument limit.
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

/** Native apps confirm the file write; browsers report only download initiation. */
export async function savePdf(
  bytes: Uint8Array<ArrayBuffer>,
  fileName: string,
  sourceId?: string,
  replaceOriginal = false,
): Promise<SaveResult> {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 5 ||
    bytes.byteLength > MAX_PDF_BYTES ||
    [37, 80, 68, 70, 45].some((byte, index) => bytes[index] !== byte)
  )
    throw new Error("Bitte eine gültige PDF bis 150 MB speichern.");
  const suggestion = suggestedFileName(fileName);
  if (!usesNativeSave()) {
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/pdf" }),
    );
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = suggestion;
      link.click();
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { status: "download-started" };
  }

  const ios = isIosApp();
  const namespace = ios
    ? "ios-bridge"
    : isAndroidApp()
      ? "android-bridge"
      : "desktop-save";
  const command = (action: string) => `plugin:${namespace}|${action}_pdf_save`;
  let token: string | undefined;
  try {
    const begun = object(
      await invoke(command("begin"), {
        fileName: suggestion,
        byteLength: bytes.byteLength,
      }),
    );
    if (
      typeof begun?.token !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(begun.token)
    )
      throw new Error(
        "Die native PDF-Speicherung konnte nicht vorbereitet werden.",
      );
    token = begun.token;
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + CHUNK_BYTES);
      const appended = object(
        await invoke(command("append"), {
          token,
          offset,
          base64: base64(chunk),
        }),
      );
      if (appended?.received !== offset + chunk.byteLength)
        throw new Error(
          "Die PDF wurde nicht vollständig an die App übergeben. Bitte erneut speichern.",
        );
    }
    // A person may leave the system picker open indefinitely. A timer here
    // could falsely fail a legitimate selection or acknowledge an unfinished file.
    const finished = object(
      await invoke(command("finish"), {
        token,
        sourceId,
        ...(ios ? { replaceOriginal } : {}),
      }),
    );
    if (finished?.status === "cancelled") return { status: "cancelled" };
    if (
      finished?.status === "saved" &&
      typeof finished.fileName === "string" &&
      finished.fileName.trim().length > 0 &&
      finished.fileName.length <= 255 &&
      !/[\\/\p{Cc}]/u.test(finished.fileName)
    )
      return { status: "saved", fileName: finished.fileName, sourceId: token };
    throw new Error(
      "Die gespeicherte PDF wurde nicht bestätigt. Die Änderungen bleiben ungesichert.",
    );
  } catch (error) {
    if (token)
      try {
        await invoke(command("abort"), { token });
      } catch {
        // Preserve the original failure; native staging is also cleared on destroy/start.
      }
    throw saveError(error);
  }
}
