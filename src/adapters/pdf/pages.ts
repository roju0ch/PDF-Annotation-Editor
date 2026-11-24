import * as mupdf from "mupdf";
import type { PageInfo } from "./types";
export function pageInfos(doc: mupdf.PDFDocument): PageInfo[] {
  const n = doc.countPages();
  if (n < 1 || n > 2000)
    throw new Error("Bitte eine PDF mit 1 bis 2000 Seiten verwenden.");
  return Array.from({ length: n }, (_, i) => {
    const p = doc.loadPage(i);
    try {
      const b = p.getBounds(),
        width = b[2] - b[0],
        height = b[3] - b[1];
      if (
        !Number.isFinite(width + height) ||
        width <= 0 ||
        height <= 0 ||
        width > 20000 ||
        height > 20000
      )
        throw new Error("Nicht unterstützte Seitengröße.");
      return {
        id: doc.findPage(i).asIndirect(),
        rotation: p.getObject().getInheritable("Rotate").asNumber(),
        width,
        height,
        origin: [b[0], b[1]],
        pdfToPage: p.getTransform(),
      };
    } finally {
      p.destroy();
    }
  });
}
export function pageEditingReason(doc: mupdf.PDFDocument): string | null {
  const root = doc.getTrailer().get("Root");
  if (!root.get("AcroForm").isNull())
    return "Seitenbearbeitung für PDFs mit Formularen wird noch nicht unterstützt.";
  if (!root.get("StructTreeRoot").isNull())
    return "Seitenbearbeitung für strukturierte/tagged PDFs wird noch nicht unterstützt.";
  return null;
}
function importedDocumentCheck(doc: mupdf.PDFDocument) {
  const reason = pageEditingReason(doc);
  if (reason) throw new Error(reason);
  const root = doc.getTrailer().get("Root");
  if (!root.get("OCProperties").isNull())
    throw new Error("PDFs mit Ebenen können noch nicht hinzugefügt werden.");
  if (!root.get("OutputIntents").isNull())
    throw new Error(
      "PDFs mit dokumentweiten Druck-/Farbprofilen können noch nicht hinzugefügt werden.",
    );
  if (!root.get("AF").isNull())
    throw new Error(
      "PDFs mit dokumentweiten Dateianhängen können noch nicht hinzugefügt werden.",
    );
  root.get("Names").forEach((_value, key) => {
    if (key !== "Dests")
      throw new Error(
        "Diese PDF enthält zusätzliche Dokumentverzeichnisse (z. B. Anhänge), die noch nicht zusammengeführt werden können.",
      );
  });
  for (let i = 0; i < doc.countPages(); i++)
    doc
      .findPage(i)
      .get("Annots")
      .forEach((a) => {
        if (a.get("Subtype").asName() === "Widget")
          throw new Error(
            "PDFs mit Formularfeldern können noch nicht hinzugefügt werden.",
          );
      });
}
function readNamedDestinations(
  root: mupdf.PDFObject,
  entry: (name: string, value: mupdf.PDFObject) => void,
) {
  const nameNodes = new Set<number>();
  let entries = 0;
  const readNames = (node: mupdf.PDFObject, depth: number) => {
    if (node.isNull()) return;
    if (++entries > 200000 || depth > 100)
      throw new Error(
        "Das Seitenzielverzeichnis ist zu komplex für diese Bearbeitung.",
      );
    if (node.isIndirect()) {
      const id = node.asIndirect();
      if (nameNodes.has(id))
        throw new Error("Ungültiges Seitenzielverzeichnis.");
      nameNodes.add(id);
    }
    const pairs = node.get("Names");
    entries += pairs.length;
    if (entries > 200000 || pairs.length % 2)
      throw new Error("Ungültiges oder zu großes Seitenzielverzeichnis.");
    for (let i = 0; i < pairs.length; i += 2)
      entry(pairs.get(i).asString(), pairs.get(i + 1));
    node.get("Kids").forEach((child) => readNames(child, depth + 1));
  };
  readNames(root.get("Names", "Dests"), 0);
}
/** Resolve source named links before grafting: destination names may collide. */
function explicitDestinations(doc: mupdf.PDFDocument) {
  const root = doc.getTrailer().get("Root");
  const names = new Map<string, mupdf.PDFObject>();
  readNamedDestinations(root, (name, value) => names.set(name, value));
  const pages = new Set(
    Array.from({ length: doc.countPages() }, (_, i) =>
      doc.findPage(i).asIndirect(),
    ),
  );
  const resolve = (value: mupdf.PDFObject): mupdf.PDFObject => {
    let dest = value;
    if (dest.isName() || dest.isString()) {
      const name = dest.isName() ? dest.asName() : dest.asString();
      dest = names.get(name) ?? root.get("Dests", name);
    }
    if (dest.isDictionary()) dest = dest.get("D");
    if (!dest.isArray() || !pages.has(dest.get(0).asIndirect()))
      throw new Error(
        "Ein internes Seitenziel dieser PDF kann nicht sicher übernommen werden.",
      );
    return dest;
  };
  if (doc.countObjects() > 200000)
    throw new Error("Die PDF enthält zu viele Objekte zum Hinzufügen.");
  const seen = new Set<number>();
  let visited = 0;
  const visit = (object: mupdf.PDFObject, depth: number) => {
    if (object.isIndirect()) {
      const id = object.asIndirect();
      if (seen.has(id)) return;
      seen.add(id);
    }
    if (++visited > 500000 || depth > 200)
      throw new Error("Die PDF-Verweisstruktur ist zu komplex zum Hinzufügen.");
    if (object.isDictionary()) {
      const dest = object.get("Dest");
      if (!dest.isNull()) object.put("Dest", resolve(dest));
      if (object.get("S").asName() === "GoTo")
        object.put("D", resolve(object.get("D")));
    }
    if (object.isDictionary() || object.isArray())
      object.forEach((child) => visit(child, depth + 1));
  };
  visit(root, 0);
}
export function pageLabels(doc: mupdf.PDFDocument): string[] | null {
  if (doc.getTrailer().get("Root", "PageLabels").isNull()) return null;
  return Array.from({ length: doc.countPages() }, (_, i) => {
    const page = doc.loadPage(i);
    try {
      return page.getLabel();
    } finally {
      page.destroy();
    }
  });
}
export function setLabels(doc: mupdf.PDFDocument, labels: string[]) {
  const nums = doc.newArray();
  labels.forEach((label, i) => {
    nums.push(i);
    const value = doc.newDictionary();
    value.put("P", doc.newString(label));
    nums.push(value);
  });
  const tree = doc.newDictionary();
  tree.put("Nums", nums);
  doc.getTrailer().get("Root").put("PageLabels", tree);
}
export function prepareImport(doc: mupdf.PDFDocument) {
  importedDocumentCheck(doc);
  pageInfos(doc);
  explicitDestinations(doc);
}
export function importPages(
  target: mupdf.PDFDocument,
  source: mupdf.PDFDocument,
  at: number,
  name: string,
): number[] {
  const map = target.newGraftMap();
  try {
    const oldCount = target.countPages(),
      oldLabels = pageLabels(target),
      incomingLabels = pageLabels(source);
    // Unlike graftPage, graftObject preserves Annots and cross-page references.
    // One map for the entire import keeps popup/reply/link/appearance relationships.
    const imported = Array.from({ length: source.countPages() }, (_, i) =>
      map.graftObject(source.findPage(i)),
    );
    for (const page of imported)
      for (const key of ["Resources", "MediaBox", "CropBox", "Rotate"]) {
        const value = page.getInheritable(key);
        if (!value.isNull()) page.put(key, value);
        // An absent source rotation means zero, not the target parent’s rotation.
        else if (key === "Rotate") page.put(key, 0);
      }
    imported.forEach((page, i) => target.insertPage(at + i, page));
    const outlines = source.getTrailer().get("Root", "Outlines");
    if (!outlines.isNull() && !outlines.get("First").isNull()) {
      const catalog = target.getTrailer().get("Root");
      let root = catalog.get("Outlines");
      if (root.isNull()) {
        root = target.addObject({ Type: "Outlines", Count: 0 });
        catalog.put("Outlines", root);
      }
      const group = map.graftObject(outlines);
      group.delete("Type");
      group.put("Title", target.newString(name));
      group.put("Parent", root);
      group.put("Count", -Math.abs(group.get("Count").asNumber()));
      const last = root.get("Last");
      if (!last.isNull()) {
        last.put("Next", group);
        group.put("Prev", last);
      } else root.put("First", group);
      root.put("Last", group);
      root.put("Count", Math.max(0, root.get("Count").asNumber()) + 1);
    }
    if (oldLabels || incomingLabels) {
      const labels =
        oldLabels ?? Array.from({ length: oldCount }, (_, i) => String(i + 1));
      labels.splice(
        at,
        0,
        ...(incomingLabels ?? imported.map((_, i) => String(i + 1))),
      );
      setLabels(target, labels);
    }
    return imported.flatMap((page) => {
      const ids: number[] = [];
      page.get("Annots").forEach((a) => {
        if (a.isIndirect()) ids.push(a.asIndirect());
      });
      return ids;
    });
  } finally {
    map.destroy();
  }
}

// MuPDF's rearrangePages rebuilds the catalog and drops entries such as
// OpenAction and ViewerPreferences. Keep the tree and replace only leaf slots.
export function reorderPages(doc: mupdf.PDFDocument, order: number[]) {
  const pages = order.map((_, i) => doc.findPage(i));
  const slots = new Map<
    number,
    { parent: mupdf.PDFObject; kids: mupdf.PDFObject; index: number }
  >();
  const parents = new Set<number>();
  for (const page of pages) {
    const parent = page.get("Parent");
    if (parents.has(parent.asIndirect())) continue;
    parents.add(parent.asIndirect());
    const kids = parent.get("Kids");
    kids.forEach((child, index) =>
      slots.set(child.asIndirect(), { parent, kids, index: Number(index) }),
    );
  }
  for (const [i, from] of order.entries()) {
    if (i === from) continue;
    const page = pages[from];
    const slot = slots.get(pages[i].asIndirect());
    if (!slot) throw new Error("Der PDF-Seitenbaum ist ungültig.");
    if (page.get("Parent").asIndirect() !== slot.parent.asIndirect()) {
      // Preserve effective geometry and resources when crossing tree branches.
      const media = page.getInheritable("MediaBox");
      if (!media.isArray())
        throw new Error("Die PDF-Seite hat keine gültige MediaBox.");
      const defaults = {
        MediaBox: media,
        CropBox: media,
        Rotate: 0,
        Resources: {},
      };
      for (const key of [
        "MediaBox",
        "CropBox",
        "Rotate",
        "Resources",
      ] as const) {
        if (!page.get(key).isNull()) continue;
        const inherited = page.getInheritable(key);
        page.put(key, inherited.isNull() ? defaults[key] : inherited);
      }
      page.put("Parent", slot.parent);
    }
    slot.kids.put(slot.index, page);
  }
}

/** Plan target changes on the surviving graph before the first journal write.
 * Only page-tree membership and recognized local destinations may refer to
 * deleted pages. References to removed annotations (even without /P) block.
 */
export function planPageReferences(
  doc: mupdf.PDFDocument,
  removed: ReadonlySet<number>,
) {
  const pages = Array.from({ length: doc.countPages() }, (_, i) =>
    doc.findPage(i),
  );
  if (
    new Set(pages.map((p) => p.asIndirect())).size !== pages.length ||
    pages.some((p) => !p.isIndirect() || !p.get("Parent").isIndirect())
  )
    throw new Error(
      "Der PDF-Seitenbaum enthält keine eindeutigen Seitenobjekte.",
    );
  const victims = new Set<number>();
  const replacements = new Map<number, mupdf.PDFObject>();
  const parents = new Set<number>();
  // Prefer the original successor, falling back to the last survivor.
  let last = pages.length - 1;
  while (removed.has(last)) last--;
  let successor = pages[last];
  for (let i = pages.length - 1; i >= 0; --i) {
    const page = pages[i];
    if (!removed.has(i)) {
      successor = page;
      continue;
    }
    replacements.set(page.asIndirect(), successor);
    victims.add(page.asIndirect());
    parents.add(page.get("Parent").asIndirect());
    page.get("Annots").forEach((annot) => {
      if (annot.get("Subtype").asName() === "Widget")
        throw new Error(
          "Seitenbearbeitung für PDFs mit Formularfeldern wird noch nicht unterstützt.",
        );
      if (annot.isIndirect()) victims.add(annot.asIndirect());
    });
  }
  const catalog = doc.getTrailer().get("Root");
  const knownTargets = new Map<number, mupdf.PDFObject>();
  const destination = (value: mupdf.PDFObject) => {
    if (!value.isArray()) return;
    if (value.get(0).isNumber())
      throw new Error(
        "Ein numerisches Seitenziel kann nicht sicher angepasst werden.",
      );
    if (
      replacements.has(value.get(0).asIndirect()) &&
      /^(XYZ|Fit|FitB|FitH|FitV|FitBH|FitBV|FitR)$/.test(value.get(1).asName())
    ) {
      const array = value.resolve();
      knownTargets.set(array.pointer, array);
    }
  };
  const named = (value: mupdf.PDFObject) =>
    destination(value.isDictionary() ? value.get("D") : value);
  readNamedDestinations(catalog, (_, value) => named(value));
  catalog.get("Dests").forEach(named);
  destination(catalog.get("OpenAction"));

  const seen = new Set<number>();
  const changes = new Map<
    number,
    { array: mupdf.PDFObject; target: mupdf.PDFObject }
  >();
  const dangling =
    "Ein PDF-Verweis auf eine ausgewählte Seite oder ihren Kommentar kann nicht sicher angepasst werden. Löschen ist daher nicht möglich.";
  let visited = 0;
  const visit = (obj: mupdf.PDFObject, depth: number) => {
    if (++visited > 500000 || depth > 200)
      throw new Error(
        "Die PDF-Verweisstruktur ist für diese Seitenbearbeitung zu komplex.",
      );
    const id = obj.asIndirect();
    if (victims.has(id)) throw new Error(dangling);
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    if (obj.isDictionary()) {
      const action = obj.get("S").asName();
      if (action === "GoToE")
        throw new Error(
          "Verschachtelte Verweise auf eingebettete PDFs können nicht sicher angepasst werden.",
        );
      if (action === "JavaScript" || !obj.get("PrintPageRange").isNull())
        throw new Error(
          "Seitenverweise in PDF-JavaScript oder festen Druckbereichen können nicht sicher angepasst werden.",
        );
      if (obj.get("Subtype").asName() === "Widget")
        throw new Error(
          "Seitenbearbeitung für PDFs mit Formularfeldern wird noch nicht unterstützt.",
        );
      destination(obj.get("Dest"));
      if (action === "GoTo") destination(obj.get("D"));
    }
    obj.forEach((value, key) => {
      if (key === "Kids" && parents.has(id)) {
        value.forEach((child) => {
          if (!replacements.has(child.asIndirect())) visit(child, depth + 2);
        });
      } else if (key === 0 && replacements.has(value.asIndirect())) {
        // A shared array may be visited before its link, bookmark or name.
        const array = obj.resolve();
        changes.set(array.pointer, {
          array,
          target: replacements.get(value.asIndirect())!,
        });
      } else visit(value, depth + 1);
    });
  };
  visit(doc.getTrailer(), 0);
  for (const pointer of changes.keys())
    if (!knownTargets.has(pointer)) throw new Error(dangling);
  return [...changes.values()];
}
