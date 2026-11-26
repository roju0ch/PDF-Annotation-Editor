import type { Point as TextPoint, Quad } from "mupdf";
import type {
  Annotation,
  AnnotationCommand,
  AnnotationClipboard,
  EditorState,
} from "../../core/annotations/model";
import type { RasterBox, TileRequest } from "./raster";
import type { Matrix } from "../../core/viewport";
export type PageInfo = {
  id: number;
  rotation: number;
  width: number;
  height: number;
  origin: [number, number];
  pdfToPage: Matrix;
};
export type TextQuery =
  | { mode: "all" | "probe" }
  | { mode: "word"; at: TextPoint }
  | { mode: "range"; start: TextPoint; end: TextPoint };
export type TextSelection = {
  readable: boolean;
  text: string;
  quads: Quad[];
};
export type Payload =
  | {
      type: "select-text";
      page: number;
      pageId: number;
      rotation: number;
      query: TextQuery;
    }
  | { type: "open"; data: ArrayBuffer }
  | { type: "render"; page: number; scale: number; split?: boolean }
  | ({ type: "render-tile"; split?: boolean } & TileRequest)
  | { type: "annotation-bounds"; pages: number[]; revision: number }
  | ({
      type: "render-annotation-patch";
      background: Uint8ClampedArray<ArrayBuffer>;
      revision: number;
    } & TileRequest)
  | { type: "list"; page: number }
  | { type: "copy"; page: number; ids: number[]; cut: boolean }
  | { type: "edit"; command: AnnotationCommand }
  | { type: "export" }
  | { type: "ack-export"; revision: number };
export type Request = { id: number } & Payload;
export type Reply = {
  textSelection?: TextSelection;
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
  overlayPixels?: Uint8ClampedArray<ArrayBuffer>;
  overlayBox?: RasterBox;
  rasterRevision?: number;
  stale?: boolean;
  annotationBounds?: {
    page: number;
    bounds: [number, number, number, number][];
  }[];
  width?: number;
  height?: number;
};
