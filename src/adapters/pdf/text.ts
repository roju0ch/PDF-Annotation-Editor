import type { DisplayList, Point, Quad, StructuredText } from "mupdf";
import type { TextQuery, TextSelection } from "./types";

// Midpoints lie inside the text line even on rotated pages. The Quad uses
// MuPDF's upper-left, upper-right, lower-left, lower-right order.
export function edge(q: Quad, end: boolean): Point {
  const i = end ? 2 : 0;
  return [(q[i] + q[i + 4]) / 2, (q[i + 1] + q[i + 5]) / 2];
}

function within(q: Quad, [x, y]: Point) {
  const vertices = [0, 2, 6, 4];
  const sides = vertices.map((a, i) => {
    const b = vertices[(i + 1) % 4];
    return (q[b] - q[a]) * (y - q[a + 1]) - (q[b + 1] - q[a + 1]) * (x - q[a]);
  });
  return (
    sides.some((v) => v !== 0) &&
    (sides.every((v) => v >= 0) || sides.every((v) => v <= 0))
  );
}

export class PageText {
  private readonly text: StructuredText;
  private first?: Point;
  private last?: Point;
  private words: Quad[] = [];
  constructor(contents: DisplayList) {
    this.text = contents.toStructuredText("");
    try {
      let word: Quad | undefined;
      let direction = 0;
      this.text.walk({
        beginLine: () => {
          word = undefined;
        },
        onChar: (ch, _origin, font, _size, quad, _color, bidi) => {
          font.destroy(); // MuPDF.js retains a font reference for each callback.
          const rtl = bidi & 1;
          this.first ??= edge(quad, !!rtl);
          this.last = edge(quad, !rtl);
          if (!ch.trim()) {
            word = undefined;
            return;
          }
          if (!word || direction !== rtl) {
            if (this.words.length >= 100_000)
              throw new Error(
                "Diese Seite enthält zu viele Wörter für die Textauswahl.",
              );
            word = [...quad];
            this.words.push(word);
            direction = rtl;
          } else {
            const i = rtl ? 0 : 2;
            word[i] = quad[i];
            word[i + 1] = quad[i + 1];
            word[i + 4] = quad[i + 4];
            word[i + 5] = quad[i + 5];
          }
        },
      });
    } catch (error) {
      this.destroy();
      throw error;
    }
  }
  destroy() {
    this.text.destroy();
  }
  select(query: TextQuery): TextSelection {
    const readable = this.words.length > 0;
    const empty = { readable, text: "", quads: [] };
    if (!readable || !this.first || !this.last || query.mode === "probe")
      return empty;
    let start = this.first,
      end = this.last;
    if (query.mode === "word") {
      const word = this.words.find((quad) => within(quad, query.at));
      if (!word) return empty;
      start = edge(word, false);
      end = edge(word, true);
    } else if (query.mode === "range") {
      start = query.start;
      end = query.end;
    }
    // 1.28.6 silently caps highlight() at 100 by default. Retry on exact
    // capacity; refuse excessive geometry explicitly instead of partial copy.
    for (let limit = 128; limit <= 65536; limit *= 2) {
      const quads = this.text.highlight(start, end, limit);
      if (quads.length < limit)
        return { readable: true, text: this.text.copy(start, end), quads };
    }
    throw new Error(
      "Diese Textauswahl ist zu groß. Bitte einen kleineren Bereich auswählen.",
    );
  }
}
