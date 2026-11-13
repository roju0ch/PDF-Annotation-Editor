import { describe, expect, it } from "vitest";
import {
  intersectingAnnotations,
  selectionRect,
  touchesAnnotation,
} from "../src/core/annotations/selection";
import type { Annotation } from "../src/core/annotations/model";

const ink: Annotation = {
  id: 1,
  page: 0,
  type: "Ink",
  editable: true,
  contents: "",
  color: "#ff0000",
  width: 2,
  fontSize: 14,
  rect: [-1, -1, 101, 101],
  ink: [
    [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ],
  ],
};
describe("touching marquee selection", () => {
  it("selects crossing strokes with both endpoints outside, including reverse drags", () => {
    const rect = selectionRect({ x: 60, y: 55 }, { x: 40, y: 45 });
    expect(touchesAnnotation(ink, rect)).toBe(true);
    expect(rect).toEqual(selectionRect({ x: 40, y: 45 }, { x: 60, y: 55 }));
  });
  it("does not select empty space inside an ink bounding box or between disjoint paths", () => {
    expect(touchesAnnotation(ink, [0, 80, 10, 90])).toBe(false);
    expect(
      touchesAnnotation(
        {
          ...ink,
          ink: [
            [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
            ],
            [
              { x: 90, y: 0 },
              { x: 100, y: 0 },
            ],
          ],
        },
        [40, -2, 60, 2],
      ),
    ).toBe(false);
  });
  it("includes stroke width, exact border contact, round caps and zero-length segments", () => {
    const line = {
      ...ink,
      width: 10,
      ink: [
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      ],
    };
    expect(touchesAnnotation(line, [20, 5, 30, 10])).toBe(true);
    expect(touchesAnnotation(line, [20, 5.01, 30, 10])).toBe(false);
    expect(touchesAnnotation(line, [103, 4, 110, 8])).toBe(true);
    expect(touchesAnnotation(line, [104, 4, 110, 8])).toBe(false);
    expect(
      touchesAnnotation(
        {
          ...line,
          ink: [
            [
              { x: 0, y: 0 },
              { x: 0, y: 0 },
            ],
          ],
        },
        [3, 4, 5, 6],
      ),
    ).toBe(true);
  });
  it("selects partially touched text rectangles, but excludes other pages and protected objects", () => {
    const note = {
      ...ink,
      id: 2,
      type: "Text",
      rect: [10, 10, 30, 30] as [number, number, number, number],
    };
    expect(
      intersectingAnnotations(
        [
          note,
          { ...note, id: 3, editable: false },
          { ...note, id: 4, page: 1 },
        ],
        0,
        [30, 15, 40, 20],
      ),
    ).toEqual([2]);
    expect(touchesAnnotation(note, [30.01, 15, 40, 20])).toBe(false);
  });
});
