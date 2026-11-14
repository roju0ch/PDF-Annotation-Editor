import type { Matrix, Point } from "../viewport";
/** Coordinates are unrotated PDF user-space points, not CSS or MuPDF page space. */
export type PdfRect = [number, number, number, number];
export type AnnotationKind = "Ink" | "Text" | "FreeText" | "Stamp";
export type Annotation = {
  id: number;
  page: number;
  type: string;
  rect: PdfRect;
  contents: string;
  editable: boolean;
  color: string;
  width: number;
  fontSize: number;
  ink?: Point[][];
};
/** In-memory native PDF snapshot; never written to the system clipboard. */
export type AnnotationClipboard = {
  bytes: Uint8Array<ArrayBuffer>;
  items: Annotation[];
  matrix: Matrix;
  pageRotation: number;
};
export type AnnotationPatch = {
  contents?: string;
  color?: string;
  width?: number;
  fontSize?: number;
  offset?: Point;
  rect?: PdfRect;
};
export type AnnotationCommand =
  | {
      action: "create-image";
      page: number;
      rect: PdfRect;
      bytes: Uint8Array<ArrayBuffer>;
      contents: string;
    }
  | {
      action: "create";
      page: number;
      kind: AnnotationKind;
      rect: PdfRect;
      ink?: Point[][];
      contents: string;
      color: string;
      width: number;
      fontSize: number;
    }
  | {
      action: "paste";
      page: number;
      point: Point;
      clipboard: AnnotationClipboard;
    }
  | { action: "delete-many"; page: number; ids: number[] }
  | { action: "move"; page: number; ids: number[]; offset: Point }
  | { action: "update"; page: number; id: number; patch: AnnotationPatch }
  | { action: "delete"; page: number; id: number }
  | { action: "erase"; page: number; id: number; center: Point; radius: number }
  | { action: "undo" }
  | { action: "redo" };
export type EditorState = {
  revision: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  readOnly: string | null;
};
export const annotationLabels: Record<string, string> = {
  Stamp: "Bild",
  Ink: "Freihand",
  Text: "Notiz",
  FreeText: "Textfeld",
};
