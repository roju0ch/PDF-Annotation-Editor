import type {
  Annotation,
  AnnotationCommand,
  AnnotationClipboard,
  EditorState,
} from "../../core/annotations/model";
import type { Matrix } from "../../core/viewport";
export type PageInfo = {
  id: number;
  width: number;
  height: number;
  origin: [number, number];
  pdfToPage: Matrix;
};
export type Payload =
  | { type: "open"; data: ArrayBuffer }
  | { type: "render"; page: number; scale: number }
  | { type: "list"; page: number }
  | { type: "copy"; page: number; ids: number[]; cut: boolean }
  | { type: "edit"; command: AnnotationCommand }
  | { type: "export" }
  | { type: "ack-export"; revision: number };
export type Request = { id: number } & Payload;
export type Reply = {
  annotations?: Annotation[];
  editor?: EditorState;
  selected?: number | number[] | null;
  clipboard?: AnnotationClipboard;
  bytes?: Uint8Array<ArrayBuffer>;
  id: number;
  error?: string;
  pages?: PageInfo[];
  focusPage?: number;
  pixels?: Uint8ClampedArray<ArrayBuffer>;
  width?: number;
  height?: number;
};
