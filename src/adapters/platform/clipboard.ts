import { invoke, isTauri } from "@tauri-apps/api/core";
import { imageInfo, MAX_IMAGE_BYTES } from "../../core/annotations/image";

function nativeImage(payload: unknown): Blob {
  if (!payload || typeof payload !== "object")
    throw new Error(
      "Die Android-Zwischenablage hat kein gültiges Bild geliefert.",
    );
  const { mimeType, base64 } = payload as Record<string, unknown>;
  if (
    !["image/png", "image/jpeg"].includes(mimeType as string) ||
    typeof base64 !== "string" ||
    !base64.length
  )
    throw new Error(
      "Die Android-Zwischenablage hat kein PNG-/JPEG-Bild geliefert.",
    );
  if (base64.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3))
    throw new Error("Das Bild ist größer als 20 MB.");
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    throw new Error(
      "Die Bilddaten aus der Android-Zwischenablage sind ungültig.",
    );
  }
  imageInfo(bytes);
  return new Blob([bytes], { type: mimeType as string });
}

/** Only read on an explicit paste action, never during app start or polling. */
export async function readClipboardImage(): Promise<Blob> {
  if (isTauri() && /\bAndroid\b/i.test(navigator.userAgent)) {
    let payload: unknown;
    try {
      payload = await invoke("plugin:android-bridge|read_clipboard_image");
    } catch (error) {
      const message =
        typeof error === "string"
          ? error
          : error && typeof error === "object" && "message" in error
            ? String(error.message)
            : "Bild konnte unter Android nicht gelesen werden. Bitte erneut kopieren oder ‚Bild einfügen …‘ verwenden.";
      throw new Error(message, { cause: error });
    }
    return nativeImage(payload);
  }
  if (!navigator.clipboard?.read)
    throw new Error(
      "Dieser Browser erlaubt keinen direkten Bildzugriff. Bitte ‚Bild einfügen …‘ verwenden.",
    );
  let entries: ClipboardItems;
  try {
    entries = await navigator.clipboard.read();
  } catch {
    throw new Error(
      "Kein Zugriff auf die Zwischenablage. Bitte den Zugriff erlauben oder ‚Bild einfügen …‘ verwenden.",
    );
  }
  for (const item of entries) {
    const type = item.types.find((t) =>
      ["image/png", "image/jpeg"].includes(t),
    );
    if (type) return item.getType(type);
  }
  throw new Error(
    "Kein PNG-/JPEG-Bild in der Zwischenablage. Bitte einen Screenshot kopieren oder ‚Bild einfügen …‘ verwenden.",
  );
}
