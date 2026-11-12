import type { Matrix } from "../../core/viewport";
export type PageInfo = {
  width: number;
  height: number;
  origin: [number, number];
  pdfToPage: Matrix;
};
export type Request = { id: number } & (
  | { type: "open"; data: ArrayBuffer }
  | { type: "render"; page: number; scale: number }
);
export type Reply = {
  id: number;
  error?: string;
  pages?: PageInfo[];
  pixels?: Uint8ClampedArray<ArrayBuffer>;
  width?: number;
  height?: number;
};
