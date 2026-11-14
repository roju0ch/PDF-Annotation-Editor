import { imageInfo } from "../../core/annotations/image";
import * as mupdf from "mupdf";
import { inverse, transform, type Point } from "../../core/viewport";
import { eraseInk } from "../../core/annotations/erase";
import type {
  Annotation,
  AnnotationCommand,
  AnnotationClipboard,
  AnnotationKind,
  EditorState,
  PdfRect,
} from "../../core/annotations/model";
const supported = (s: string): s is AnnotationKind =>
  ["Ink", "Text", "FreeText", "Stamp"].includes(s);
const finite = (n: number, min: number, max: number) => {
  if (!Number.isFinite(n) || n < min || n > max)
    throw new Error("Wert außerhalb des zulässigen Bereichs.");
  return n;
};
const rgb = (s: string): mupdf.Color => {
  if (!/^#[0-9a-f]{6}$/i.test(s)) throw new Error("Ungültige Farbe.");
  return [1, 3, 5].map(
    (i) => parseInt(s.slice(i, i + 2), 16) / 255,
  ) as mupdf.Color;
};
function hex(c: mupdf.AnnotColor) {
  const v =
    c.length === 1
      ? [c[0], c[0], c[0]]
      : c.length === 4
        ? [
            1 - Math.min(1, c[0] + c[3]),
            1 - Math.min(1, c[1] + c[3]),
            1 - Math.min(1, c[2] + c[3]),
          ]
        : c.length === 3
          ? c
          : [0, 0, 0];
  return (
    "#" +
    v
      .map((x) =>
        Math.round(x * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
function checkPoint(p: Point) {
  finite(p.x, -100000, 100000);
  finite(p.y, -100000, 100000);
}
function checkRect(r: PdfRect) {
  r.forEach((v) => finite(v, -100000, 100000));
  if (r[2] <= r[0] || r[3] <= r[1])
    throw new Error("Ungültige Annotationsgröße.");
}
function protectedReason(doc: mupdf.PDFDocument): string | null {
  const trailer = doc.getTrailer();
  if (!trailer.get("Encrypt").isNull() || !doc.hasPermission("annotate"))
    return "Diese PDF ist verschlüsselt oder schreibgeschützt. Nur Ansicht.";
  const root = trailer.get("Root");
  if (!root.get("Perms").isNull())
    return "Diese PDF enthält Signatur- oder Zertifizierungsrechte. Nur Ansicht.";
  const seen = new Set<number>();
  let count = 0;
  const signature = (fields: mupdf.PDFObject, depth = 0): boolean => {
    if (depth > 32 || ++count > 10000) return true;
    for (let i = 0; i < fields.length; i++) {
      const field = fields.get(i);
      const id = field.asIndirect();
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      if (
        field.get("FT").asName() === "Sig" ||
        signature(field.get("Kids"), depth + 1)
      )
        return true;
    }
    return false;
  };
  return signature(root.get("AcroForm", "Fields"))
    ? "Diese PDF enthält ein Signaturfeld. Nur Ansicht; Signaturen werden nicht verändert."
    : null;
}
// MuPDF regenerates a Stamp appearance on update, resetting its Matrix. Reapply
// the existing custom appearance to retain image orientation/alpha on later edits.
function updateAnnotation(a: mupdf.PDFAnnotation) {
  if (a.getType() === "Stamp") {
    const ap = a.getObject().get("AP", "N");
    if (!ap.isStream()) throw new Error("Bilddarstellung fehlt.");
    const bbox = [0, 1, 2, 3].map((i) =>
      ap.get("BBox", i).asNumber(),
    ) as mupdf.Rect;
    const matrix = ap.get("Matrix").isNull()
      ? mupdf.Matrix.identity
      : ([0, 1, 2, 3, 4, 5].map((i) =>
          ap.get("Matrix", i).asNumber(),
        ) as mupdf.Matrix);
    const data = ap.readStream();
    try {
      a.setAppearance(null, null, matrix, bbox, ap.get("Resources"), data);
    } finally {
      data.destroy();
    }
  }
  a.update();
}
export class AnnotationEditor {
  readonly readOnly: string | null;
  private sequence = 0;
  private history = [0];
  private saved = 0;
  private operations: {
    command: AnnotationCommand;
    createdIds: number[];
  }[] = [];
  constructor(
    private doc: mupdf.PDFDocument,
    private original: Uint8Array<ArrayBuffer>,
  ) {
    this.readOnly = protectedReason(doc);
    doc.enableJournal();
  }
  state(): EditorState {
    const j = this.doc.getJournal();
    return {
      revision: this.history[j.position] ?? 0,
      dirty: (this.history[j.position] ?? 0) !== this.saved,
      canUndo: this.doc.canUndo(),
      canRedo: this.doc.canRedo(),
      readOnly: this.readOnly,
    };
  }
  list(index: number): Annotation[] {
    const p = this.doc.loadPage(index);
    try {
      const inv = inverse(p.getTransform());
      return p.getAnnotations().map((a) => {
        const type = a.getType(),
          flags = a.getFlags();
        const rect = mupdf.Rect.transform(
          supported(type) && a.getObject().isIndirect() && type !== "Ink"
            ? a.getRect()
            : a.getBounds(),
          inv,
        );
        const editable =
          !this.readOnly &&
          supported(type) &&
          (type !== "Stamp" ||
            (a.getObject().get("IT").asName() === "StampImage" &&
              a.getObject().get("AP", "N").isStream())) &&
          a.getObject().isIndirect() &&
          !(
            type === "FreeText" &&
            (!a.getObject().get("RC").isNull() ||
              a.getIntent() === "FreeTextCallout")
          ) &&
          !(
            flags &
            (mupdf.PDFAnnotation.IS_READ_ONLY |
              mupdf.PDFAnnotation.IS_LOCKED |
              mupdf.PDFAnnotation.IS_LOCKED_CONTENTS |
              mupdf.PDFAnnotation.IS_HIDDEN |
              mupdf.PDFAnnotation.IS_INVISIBLE |
              mupdf.PDFAnnotation.IS_NO_VIEW)
          );
        return {
          id: a.getObject().asIndirect(),
          page: index,
          type,
          rect,
          contents: a.getContents(),
          editable,
          color: hex(
            type === "FreeText" ? a.getDefaultAppearance().color : a.getColor(),
          ),
          width: type === "Ink" ? a.getBorderWidth() : 0,
          fontSize: type === "FreeText" ? a.getDefaultAppearance().size : 14,
          ink:
            type === "Ink"
              ? a
                  .getInkList()
                  .map((path) => path.map(([x, y]) => transform({ x, y }, inv)))
              : undefined,
        };
      });
    } finally {
      p.destroy();
    }
  }
  copy(index: number, ids: number[]): AnnotationClipboard {
    if (this.readOnly) throw new Error(this.readOnly);
    if (!ids.length || new Set(ids).size !== ids.length)
      throw new Error("Ungültige Auswahl.");
    const items = this.list(index);
    const selected = ids.map((id) => {
      const item = items.find((a) => a.id === id);
      if (!item?.editable)
        throw new Error("Diese Annotation kann nicht kopiert werden.");
      return item;
    });
    const page = this.doc.loadPage(index);
    const snapshot = new mupdf.PDFDocument();
    const graft = snapshot.newGraftMap();
    try {
      const objects = snapshot.newArray();
      const native = new Map(
        page.getAnnotations().map((a) => [a.getObject().asIndirect(), a]),
      );
      for (const item of selected) {
        const clean = this.doc.newDictionary();
        // Do not carry page trees, popup/reply relationships or annotation identities.
        native
          .get(item.id)!
          .getObject()
          .forEach((value, key) => {
            if (!["P", "Popup", "IRT", "Parent", "NM"].includes(String(key)))
              clean.put(key, value);
          });
        objects.push(graft.graftObject(clean));
      }
      snapshot.getTrailer().get("Root").put("AnnotationClipboard", objects);
      const buffer = snapshot.saveToBuffer("compress=yes");
      try {
        const bytes = new Uint8Array(buffer.asUint8Array());
        if (bytes.length > 20 * 1024 * 1024)
          throw new Error(
            "Die Auswahl überschreitet die Zwischenablagegrenze von 20 MB.",
          );
        return {
          bytes,
          items: selected,
          matrix: page.getTransform(),
          pageRotation: page.getObject().getInheritable("Rotate").asNumber(),
        };
      } finally {
        buffer.destroy();
      }
    } finally {
      graft.destroy();
      snapshot.destroy();
      page.destroy();
    }
  }
  apply(c: Extract<AnnotationCommand, { action: "paste" }>): number[];
  apply(c: Exclude<AnnotationCommand, { action: "paste" }>): number | null;
  apply(c: AnnotationCommand): number | number[] | null;
  apply(c: AnnotationCommand): number | number[] | null {
    if (this.readOnly) throw new Error(this.readOnly);
    if (c.action === "undo" || c.action === "redo") {
      if (c.action === "undo" && this.doc.canUndo()) this.doc.undo();
      if (c.action === "redo" && this.doc.canRedo()) this.doc.redo();
      return null;
    }
    const p = this.doc.loadPage(c.page);
    let id: number | number[] | null;
    try {
      const matrix = p.getTransform();
      const toPage = (pt: Point): mupdf.Point => {
        checkPoint(pt);
        const v = transform(pt, matrix);
        return [v.x, v.y];
      };
      const move = (
        a: mupdf.PDFAnnotation,
        item: Annotation,
        offset: Point,
      ) => {
        checkPoint(offset);
        const { x, y } = offset;
        if (item.type === "Ink")
          a.setInkList(
            item.ink!.map((path) =>
              path.map((pt) => toPage({ x: pt.x + x, y: pt.y + y })),
            ),
          );
        else {
          const rect = item.rect.map(
            (v, i) => v + (i % 2 === 0 ? x : y),
          ) as PdfRect;
          checkRect(rect);
          a.setRect(mupdf.Rect.transform(rect, matrix));
        }
      };
      const beforePosition = this.doc.getJournal().position;
      this.doc.beginOperation(c.action);
      try {
        if (c.action === "create-image") {
          const size = imageInfo(c.bytes);
          checkRect(c.rect);
          if (c.contents.length > 10000) throw new Error("Text ist zu lang.");
          const image = new mupdf.Image(c.bytes);
          try {
            if (
              image.getWidth() !== size.width ||
              image.getHeight() !== size.height
            )
              throw new Error("Ungültige Bildabmessungen.");
            const a = p.createAnnotation("Stamp");
            id = a.getObject().asIndirect();
            a.setRect(mupdf.Rect.transform(c.rect, matrix));
            a.setContents(c.contents);
            a.setFlags(mupdf.PDFAnnotation.IS_PRINT);
            // MuPDF.js 1.28.6 declares StampImage but its intent setter writes null.
            a.getObject().put("IT", this.doc.newName("StampImage"));
            a.getObject().put("Name", this.doc.newName("Image"));
            a.setColor([]);
            // Custom appearance retains image alpha and compensates page rotation.
            a.setAppearance(
              null,
              null,
              mupdf.Matrix.rotate(
                p.getObject().getInheritable("Rotate").asNumber(),
              ),
              [0, 0, 1, 1],
              { XObject: { I: this.doc.addImage(image) } },
              "/I Do",
            );
            updateAnnotation(a);
          } finally {
            image.destroy();
          }
        } else if (c.action === "create") {
          if (!supported(c.kind) || c.kind === "Stamp")
            throw new Error("Nicht unterstützter Annotationstyp.");
          checkRect(c.rect);
          if (c.contents.length > 10000) throw new Error("Text ist zu lang.");
          const color = rgb(c.color);
          finite(c.width, 0.1, 30);
          finite(c.fontSize, 6, 96);
          const a = p.createAnnotation(c.kind);
          id = a.getObject().asIndirect();
          a.setContents(c.contents);
          a.setColor(c.kind === "FreeText" ? [] : color);
          a.setFlags(mupdf.PDFAnnotation.IS_PRINT);
          if (c.kind === "Ink") {
            if (
              !c.ink?.length ||
              c.ink.length > 1000 ||
              c.ink.reduce((n, s) => n + s.length, 0) > 20000 ||
              c.ink.some((s) => s.length < 2)
            )
              throw new Error("Ungültiger Freihandpfad.");
            a.setInkList(c.ink.map((path) => path.map(toPage)));
            a.setBorderWidth(c.width);
          } else {
            a.setRect(mupdf.Rect.transform(c.rect, matrix));
            if (c.kind === "FreeText") {
              a.getObject().put(
                "Rotate",
                p.getObject().getInheritable("Rotate").asNumber(),
              );
              a.setDefaultAppearance("Helv", c.fontSize, color);
            }
          }
          updateAnnotation(a);
        } else if (c.action === "paste") {
          const clip = c.clipboard;
          if (!clip.items.length || clip.bytes.length > 20 * 1024 * 1024)
            throw new Error("Ungültige Zwischenablage.");
          checkPoint(c.point);
          const source = new mupdf.PDFDocument(clip.bytes);
          const graft = this.doc.newGraftMap();
          try {
            const objects = source
              .getTrailer()
              .get("Root", "AnnotationClipboard");
            if (objects.length !== clip.items.length)
              throw new Error("Unvollständige Zwischenablage.");
            const rects = clip.items.map((item) =>
              mupdf.Rect.transform(item.rect, clip.matrix),
            );
            const x = Math.min(...rects.map((r) => r[0])),
              y = Math.min(...rects.map((r) => r[1]));
            const anchor = toPage(c.point);
            const shifted = (pt: Point): mupdf.Point => {
              const q = transform(pt, clip.matrix);
              const result: mupdf.Point = [
                q.x - x + anchor[0],
                q.y - y + anchor[1],
              ];
              checkPoint({ x: result[0], y: result[1] });
              return result;
            };
            id = clip.items.map((item, index) => {
              if (!item.editable || !supported(item.type))
                throw new Error("Nicht unterstützter Zwischenablageinhalt.");
              const a = p.createAnnotation(item.type);
              const object = a.getObject();
              // Creation installs defaults (e.g. yellow Text icons). Do not add
              // properties that were absent on the source annotation.
              const defaults: (string | number)[] = [];
              object.forEach((_value, key) => {
                if (key !== "P") defaults.push(key);
              });
              defaults.forEach((key) => object.delete(key));
              const copied = graft.graftObject(objects.get(index));
              copied.forEach((value, key) => object.put(key, value));
              if (item.type === "Ink") {
                if (!item.ink?.length)
                  throw new Error("Ungültiger Freihandpfad.");
                a.setInkList(item.ink.map((path) => path.map(shifted)));
              } else {
                const r = rects[index];
                a.setRect([
                  r[0] - x + anchor[0],
                  r[1] - y + anchor[1],
                  r[2] - x + anchor[0],
                  r[3] - y + anchor[1],
                ]);
                if (item.type === "FreeText")
                  object.put(
                    "Rotate",
                    (((copied.get("Rotate").asNumber() -
                      clip.pageRotation +
                      p.getObject().getInheritable("Rotate").asNumber()) %
                      360) +
                      360) %
                      360,
                  );
              }
              if (item.type === "Stamp") {
                const rotation =
                  p.getObject().getInheritable("Rotate").asNumber() -
                  clip.pageRotation;
                if (rotation % 360 !== 0) {
                  const sourceAP = object.get("AP", "N");
                  const bbox = [0, 1, 2, 3].map((i) =>
                    sourceAP.get("BBox", i).asNumber(),
                  ) as mupdf.Rect;
                  const sourceMatrix = sourceAP.get("Matrix");
                  const effective = sourceMatrix.isNull()
                    ? bbox
                    : mupdf.Rect.transform(
                        bbox,
                        [0, 1, 2, 3, 4, 5].map((i) =>
                          sourceMatrix.get(i).asNumber(),
                        ) as mupdf.Matrix,
                      );
                  // Detach first: appearances may be shared with other annotations.
                  object.put("AP", this.doc.newDictionary());
                  a.setAppearance(
                    null,
                    null,
                    mupdf.Matrix.rotate(rotation),
                    effective,
                    { XObject: { Source: sourceAP } },
                    "/Source Do",
                  );
                }
              }
              updateAnnotation(a);
              return object.asIndirect();
            });
          } finally {
            graft.destroy();
            source.destroy();
          }
        } else if (c.action === "delete-many") {
          if (!c.ids.length || new Set(c.ids).size !== c.ids.length)
            throw new Error("Ungültige Auswahl.");
          const items = new Map(
            this.list(c.page).map((item) => [item.id, item]),
          );
          const native = new Map(
            p.getAnnotations().map((a) => [a.getObject().asIndirect(), a]),
          );
          for (const selectedId of c.ids) {
            if (!items.get(selectedId)?.editable || !native.has(selectedId))
              throw new Error(
                "Diese Annotation kann nicht ausgeschnitten werden.",
              );
            p.deleteAnnotation(native.get(selectedId)!);
          }
          id = null;
        } else if (c.action === "move") {
          if (!c.ids.length || new Set(c.ids).size !== c.ids.length)
            throw new Error("Ungültige Gruppenauswahl.");
          checkPoint(c.offset);
          const items = new Map(
            this.list(c.page).map((item) => [item.id, item]),
          );
          const native = new Map(
            p.getAnnotations().map((a) => [a.getObject().asIndirect(), a]),
          );
          for (const selectedId of c.ids) {
            const item = items.get(selectedId);
            const a = native.get(selectedId);
            if (!item?.editable || !a)
              throw new Error(
                "Die Auswahl enthält eine nicht bearbeitbare Annotation.",
              );
            move(a, item, c.offset);
            updateAnnotation(a);
          }
          id = null;
        } else {
          const item = this.list(c.page).find((a) => a.id === c.id);
          if (!item?.editable)
            throw new Error("Diese Annotation kann nicht bearbeitet werden.");
          const a = p
            .getAnnotations()
            .find((a) => a.getObject().asIndirect() === c.id)!;
          id = c.id;
          if (c.action === "delete") {
            p.deleteAnnotation(a);
            id = null;
          } else if (c.action === "erase") {
            if (item.type !== "Ink")
              throw new Error("Teilradierung ist nur für Freihand verfügbar.");
            checkPoint(c.center);
            finite(c.radius, 0.1, 500);
            const paths = eraseInk(
              item.ink!,
              c.center,
              c.radius + item.width / 2,
            );
            if (paths.length) {
              a.setInkList(paths.map((path) => path.map(toPage)));
              updateAnnotation(a);
            } else {
              p.deleteAnnotation(a);
              id = null;
            }
          } else {
            const patch = c.patch;
            if (patch.contents !== undefined) {
              if (patch.contents.length > 10000)
                throw new Error("Text ist zu lang.");
              a.setContents(patch.contents);
            }
            if (patch.rect) {
              if (item.type !== "Stamp")
                throw new Error("Größenänderung ist nur für Bilder verfügbar.");
              checkRect(patch.rect);
              const ratio =
                (item.rect[2] - item.rect[0]) / (item.rect[3] - item.rect[1]);
              const nextRatio =
                (patch.rect[2] - patch.rect[0]) /
                (patch.rect[3] - patch.rect[1]);
              if (Math.abs(nextRatio / ratio - 1) > 0.001)
                throw new Error("Das Seitenverhältnis muss erhalten bleiben.");
              a.setRect(mupdf.Rect.transform(patch.rect, matrix));
            }
            if (patch.color !== undefined) {
              if (item.type === "Stamp")
                throw new Error("Bildfarben können nicht geändert werden.");
              const color = rgb(patch.color);
              if (item.type === "FreeText") {
                const da = a.getDefaultAppearance();
                a.setDefaultAppearance(da.font || "Helv", da.size || 14, color);
              } else a.setColor(color);
            }
            if (patch.width !== undefined) {
              if (item.type !== "Ink")
                throw new Error("Strichbreite gilt nur für Freihand.");
              a.setBorderWidth(finite(patch.width, 0.1, 30));
            }
            if (patch.fontSize !== undefined) {
              if (item.type !== "FreeText")
                throw new Error("Schriftgröße gilt nur für Textfelder.");
              const da = a.getDefaultAppearance();
              a.setDefaultAppearance(
                da.font || "Helv",
                finite(patch.fontSize, 6, 96),
                da.color,
              );
            }
            if (patch.offset) move(a, item, patch.offset);
            updateAnnotation(a);
          }
        }
        this.doc.endOperation();
        const position = this.doc.getJournal().position;
        if (position > beforePosition) {
          this.history.splice(position);
          this.history[position] = ++this.sequence;
          this.operations.splice(position - 1);
          this.operations[position - 1] = {
            command: structuredClone(c),
            createdIds: Array.isArray(id)
              ? [...id]
              : (c.action === "create" || c.action === "create-image") &&
                  id !== null
                ? [id]
                : [],
          };
        }
      } catch (e) {
        this.doc.abandonOperation();
        throw e;
      }
      return id;
    } finally {
      p.destroy();
    }
  }
  export(): Uint8Array<ArrayBuffer> {
    if (this.readOnly) throw new Error(this.readOnly);
    // Incremental updates retain original streams and unsupported PDF objects.
    if (!this.doc.canBeSavedIncrementally())
      throw new Error(
        "Diese Datei kann nicht sicher inkrementell gespeichert werden.",
      );
    // MuPDF incremental buffer writes change native startxref state. Replaying the
    // active commands on original bytes isolates export from the live undo journal.
    const output = new mupdf.PDFDocument(this.original);
    let buffer: mupdf.Buffer | undefined;
    try {
      const replay = new AnnotationEditor(output, this.original);
      const ids = new Map<number, number>();
      for (const operation of this.operations.slice(
        0,
        this.doc.getJournal().position,
      )) {
        const command = structuredClone(operation.command);
        if ("id" in command) command.id = ids.get(command.id) ?? command.id;
        if (command.action === "move" || command.action === "delete-many")
          command.ids = command.ids.map((id) => ids.get(id) ?? id);
        const id = replay.apply(command);
        const created = Array.isArray(id) ? id : id === null ? [] : [id];
        operation.createdIds.forEach((originalId, index) => {
          if (created[index] === undefined)
            throw new Error("Export-ID-Zuordnung fehlgeschlagen.");
          ids.set(originalId, created[index]);
        });
      }
      buffer = output.saveToBuffer("incremental=yes,compress=yes");
      const bytes = new Uint8Array(buffer.asUint8Array());
      if (bytes.length > 150 * 1024 * 1024)
        throw new Error("Die exportierte PDF überschreitet 150 MB.");
      const check = new mupdf.PDFDocument(bytes);
      try {
        if (check.wasRepaired() || check.countPages() !== this.doc.countPages())
          throw new Error(
            "Die exportierte PDF hat die Prüfung nicht bestanden.",
          );
      } finally {
        check.destroy();
      }
      return bytes;
    } finally {
      buffer?.destroy();
      output.destroy();
    }
  }
  acknowledgeExport(revision: number) {
    if (this.state().revision === revision) this.saved = revision;
  }
}
