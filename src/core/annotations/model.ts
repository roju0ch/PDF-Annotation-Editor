import type { Point } from "../viewport";
/** Coordinates are unrotated PDF user-space points, not CSS or MuPDF page space. */
export type PdfRect = [number, number, number, number];
export type AnnotationKind = "Ink" | "Text" | "FreeText";
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
export type AnnotationPatch = {
  contents?: string;
  color?: string;
  width?: number;
  fontSize?: number;
  offset?: Point;
};
export type AnnotationCommand =
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
  Ink: "Freihand",
  Text: "Notiz",
  FreeText: "Textfeld",
};
