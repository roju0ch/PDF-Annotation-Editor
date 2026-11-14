import type { PdfRect } from "./model";
import type { Point } from "../viewport";
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 20_000_000;
/** Check dimensions before any image decoder allocates a raster. */
export function imageInfo(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  if (bytes.length > MAX_IMAGE_BYTES)
    throw new Error("Das Bild ist größer als 20 MB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0;
  if (
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) &&
    view.getUint32(12) === 0x49484452
  ) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (offset + 2 > bytes.length) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8) {
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += size;
    }
  }
  if (!width || !height)
    throw new Error("Bitte eine gültige PNG- oder JPEG-Datei auswählen.");
  if (width * height > MAX_IMAGE_PIXELS || Math.max(width, height) > 16384)
    throw new Error(
      "Das Bild ist zu groß (maximal 20 Megapixel und 16.384 Pixel je Seite). Bitte vorher verkleinern.",
    );
  return { width, height };
}
export function imagePlacement(
  width: number,
  height: number,
  page: { width: number; height: number },
  point: Point,
): PdfRect {
  const factor = Math.min(
    0.75,
    320 / width,
    (page.width * 0.6) / width,
    (page.height * 0.6) / height,
  );
  const w = width * factor,
    h = height * factor;
  const x = Math.max(0, Math.min(page.width - w, point.x));
  const y = Math.max(0, Math.min(page.height - h, point.y));
  return [x, y, x + w, y + h];
}
export const rectCorners = (r: PdfRect): Point[] => [
  { x: r[0], y: r[1] },
  { x: r[2], y: r[1] },
  { x: r[2], y: r[3] },
  { x: r[0], y: r[3] },
];
/** Uniform scale around the opposite corner; never flip or cross the anchor. */
export function resizeImage(
  rect: PdfRect,
  corner: number,
  pointer: Point,
): PdfRect {
  const corners = rectCorners(rect),
    anchor = corners[(corner + 2) % 4],
    start = corners[corner];
  const dx = start.x - anchor.x,
    dy = start.y - anchor.y;
  const factor = Math.max(
    8 / Math.min(Math.abs(dx), Math.abs(dy)),
    Math.min(
      20,
      ((pointer.x - anchor.x) * dx + (pointer.y - anchor.y) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  const x = anchor.x + dx * factor,
    y = anchor.y + dy * factor;
  return [
    Math.min(x, anchor.x),
    Math.min(y, anchor.y),
    Math.max(x, anchor.x),
    Math.max(y, anchor.y),
  ];
}
