import * as mupdf from "mupdf";

const AUTO_SIZE_KEY = "PDFAnnotationEditorAutoSize";
const PADDING = 4;
const PAGE_MARGIN = 2;
const MAX_TEXT_WIDTH = 480;

export function isAutoFreeText(a: mupdf.PDFAnnotation) {
  return (
    a.getType() === "FreeText" &&
    a.getObject().get(AUTO_SIZE_KEY).asNumber() === 1
  );
}

export function markAutoFreeText(a: mupdf.PDFAnnotation, enabled: boolean) {
  if (enabled) a.getObject().put(AUTO_SIZE_KEY, 1);
  else a.getObject().delete(AUTO_SIZE_KEY);
}

const normalized = (text: string) =>
  text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");

/** Read the actual native fonts, including MuPDF's embedded Unicode fallbacks. */
function glyphMetrics(a: mupdf.PDFAnnotation) {
  const widths = new Map<string, number>();
  const device = new mupdf.Device({
    fillText(text) {
      text.walk({
        showGlyph(font, _matrix, glyph, unicode) {
          if (unicode >= 0 && glyph > 0) {
            const width = font.advanceGlyph(glyph);
            if (Number.isFinite(width))
              widths.set(String.fromCodePoint(unicode), width);
          }
        },
      });
    },
  });
  try {
    a.run(device, mupdf.Matrix.identity);
    device.close();
  } finally {
    device.destroy();
  }
  let ascent = 0,
    descent = 0;
  const list = a.toDisplayList(),
    structured = list.toStructuredText({});
  try {
    structured.walk({
      onChar(_c, origin, _font, _size, q) {
        const dx = q[2] - q[0],
          dy = q[3] - q[1],
          length = Math.hypot(dx, dy);
        if (!length) return;
        const upX = dy / length,
          upY = -dx / length;
        ascent = Math.max(
          ascent,
          (q[0] - origin[0]) * upX + (q[1] - origin[1]) * upY,
        );
        descent = Math.max(
          descent,
          -(q[4] - origin[0]) * upX - (q[5] - origin[1]) * upY,
        );
      },
    });
  } finally {
    structured.destroy();
    list.destroy();
  }
  return { widths, ascent, descent };
}

function measuredLines(
  text: string,
  size: number,
  widths: Map<string, number>,
  maxWidth: number,
) {
  const lines: string[] = [];
  const advance = (character: string) => {
    const width = widths.get(character);
    if (width === undefined)
      throw new Error(
        `Das Zeichen „${character}“ wird von den verfügbaren PDF-Schriften nicht unterstützt. Bitte den Text anpassen.`,
      );
    return width * size;
  };
  for (const paragraph of normalized(text).split("\n")) {
    let line = "",
      width = 0;
    for (const character of paragraph) {
      const next = advance(character);
      if (next > maxWidth)
        throw new Error(
          "Die Schrift ist für diese Seite zu groß. Bitte eine kleinere Schriftgröße wählen.",
        );
      if (line && width + next > maxWidth) {
        const split = line.lastIndexOf(" ");
        if (split > 0) {
          lines.push(line.slice(0, split));
          line = line.slice(split + 1);
          width = [...line].reduce((sum, c) => sum + advance(c), 0);
        } else {
          lines.push(line);
          line = "";
          width = 0;
        }
      }
      // A long suffix after a word boundary can still fill the next line.
      if (line && width + next > maxWidth) {
        lines.push(line);
        line = "";
        width = 0;
      }
      line += character;
      width += next;
    }
    lines.push(line);
  }
  return { lines, advance };
}

/** Generate native FreeText AP text, then wrap it in a padded native form. */
function appearance(
  doc: mupdf.PDFDocument,
  a: mupdf.PDFAnnotation,
  rect: mupdf.Rect,
  wrapped: string,
  padding: number,
) {
  const object = a.getObject(),
    contents = a.getContents(),
    background = a.getColor();
  a.setRect([
    rect[0] + padding,
    rect[1] + padding,
    rect[2] - padding,
    rect[3] - padding,
  ]);
  a.setContents(wrapped);
  a.setColor([]);
  a.setBorderWidth(0);
  a.update();
  const source = object.get("AP", "N");
  if (!source.isStream())
    throw new Error("Die Textdarstellung konnte nicht erzeugt werden.");
  a.setRect(rect);
  a.setContents(contents);
  a.setColor(background);
  const rawRect = [0, 1, 2, 3].map((i) =>
    object.get("Rect", i).asNumber(),
  ) as mupdf.Rect;
  const [x0, y0, x1, y1] = rawRect;
  const paint = background.length
    ? `${background.join(" ")} ${background.length === 1 ? "g" : background.length === 4 ? "k" : "rg"}\n${x0} ${y0} ${x1 - x0} ${y1 - y0} re f\n`
    : "";
  // Detach first: setAppearance may otherwise replace the source stream itself.
  object.put("AP", doc.newDictionary());
  a.setAppearance(
    null,
    null,
    mupdf.Matrix.identity,
    rawRect,
    { XObject: { Text: source } },
    `q\n${paint}/Text Do\nQ\n`,
  );
  a.update();
}

/** Size in visible page points; no CSS pixels or zoom state enter this path. */
export function sizeFreeText(
  doc: mupdf.PDFDocument,
  a: mupdf.PDFAnnotation,
  page: mupdf.PDFPage,
  anchor: mupdf.Point,
) {
  const text = a.getContents();
  if (!text.trim())
    throw new Error("Bitte einen Text für den Textkommentar eingeben.");
  if (text.length > 10000)
    throw new Error("Text ist zu lang (höchstens 10.000 Zeichen).");
  const size = a.getDefaultAppearance().size;
  const bounds = page.getBounds();
  const usableWidth = bounds[2] - bounds[0] - 2 * PAGE_MARGIN;
  const usableHeight = bounds[3] - bounds[1] - 2 * PAGE_MARGIN;
  // Vector-only measuring appearance: even 10k characters never allocate a bitmap.
  a.setRect([0, 0, 100000, 100000]);
  a.setContents(normalized(text));
  a.update();
  const { widths, ascent, descent } = glyphMetrics(a);
  const padding = PADDING + Math.max(0, ascent - size * 0.8);
  const maxContentWidth = Math.min(
    MAX_TEXT_WIDTH,
    usableWidth - 2 * padding - 1,
  );
  if (maxContentWidth <= 0)
    throw new Error("Die Seite ist für einen Textkommentar zu klein.");
  a.setContents(text);
  const { lines, advance } = measuredLines(text, size, widths, maxContentWidth);
  const contentWidth = Math.max(
    size,
    ...lines.map((line) => [...line].reduce((sum, c) => sum + advance(c), 0)),
  );
  const width = Math.min(usableWidth, contentWidth + 2 * padding + 1);
  // Native FreeText starts at .8em and advances baselines by 1.2em. Use
  // actual font ascender/descender quads so even large text fits its box.
  const height =
    2 * padding + size * 0.8 + (lines.length - 1) * size * 1.2 + descent;
  if (height > usableHeight)
    throw new Error(
      "Der Text passt mit dieser Schriftgröße nicht vollständig auf die Seite. Bitte kürzen oder eine kleinere Schriftgröße wählen.",
    );
  const x = Math.max(
    bounds[0] + PAGE_MARGIN,
    Math.min(anchor[0], bounds[2] - PAGE_MARGIN - width),
  );
  const y = Math.max(
    bounds[1] + PAGE_MARGIN,
    Math.min(anchor[1], bounds[3] - PAGE_MARGIN - height),
  );
  markAutoFreeText(a, true);
  appearance(doc, a, [x, y, x + width, y + height], lines.join("\n"), padding);
}

/** Keep hard wrapping/padding on move, paste and style edits after reopening. */
export function updateAutoFreeText(
  doc: mupdf.PDFDocument,
  a: mupdf.PDFAnnotation,
) {
  const rect = a.getRect(),
    text = a.getContents(),
    size = a.getDefaultAppearance().size;
  const pageRotation = a
    .getObject()
    .get("P")
    .getInheritable("Rotate")
    .asNumber();
  const rotation = a.getObject().get("Rotate").asNumber() - pageRotation;
  // Native measurement uses the existing size/font, then the actual box is restored.
  a.setRect([0, 0, 100000, 100000]);
  a.setContents(normalized(text));
  a.update();
  const { widths, ascent } = glyphMetrics(a);
  const padding = PADDING + Math.max(0, ascent - size * 0.8);
  const width =
    (Math.abs(rotation % 180) === 90 ? rect[3] - rect[1] : rect[2] - rect[0]) -
    2 * padding;
  a.setContents(text);
  const { lines } = measuredLines(text, size, widths, Math.max(1, width - 0.5));
  appearance(doc, a, rect, lines.join("\n"), padding);
}
