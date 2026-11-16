import { describe, it, expect } from "vitest";
import { el } from "./helpers";
import { shapeOf } from "../src/client/render";

describe("R8 hand-drawn shapes", () => {
  it("fills ellipses and rectangles with the non-zero rule, so rough's overlapping outline stays filled", () => {
    for (const type of ["ellipse", "rectangle"] as const) {
      const fills = shapeOf(el(type, 0, 0, 200, 100, { backgroundColor: "#b2f2bb", fillStyle: "solid", roundness: null })).filter(p => p.fill !== "none");
      expect(fills).toHaveLength(1); expect(fills[0].fill).toBe("#b2f2bb"); expect(fills[0].fillRule).toBe("nonzero");
    }
  });
  it("fills rounded rectangles even-odd (they are rough paths)", () => {
    const fills = shapeOf(el("rectangle", 0, 0, 200, 100, { backgroundColor: "#b2f2bb", fillStyle: "solid", roundness: { type: 3 } })).filter(p => p.fill !== "none");
    expect(fills.length).toBeGreaterThan(0); expect(fills.every(p => p.fillRule === "evenodd")).toBe(true);
  });
  it("rebuilds cached paths when points or style change without a version bump (drag preview)", () => {
    const a = el("line", 0, 0, 100, 0, { points: [[0, 0], [100, 0]] } as any);
    const first = shapeOf(a)[0].d;
    expect(shapeOf({ ...a, points: [[0, 0], [100, 50]] } as any)[0].d).not.toBe(first);
    expect(shapeOf({ ...a, strokeColor: "#e03131" } as any)[0].stroke).toBe("#e03131");
  });
  it("draws the same shape for the same seed, and a different one for another seed", () => {
    const a = shapeOf(el("rectangle", 0, 0, 100, 60, { seed: 42 }));
    const b = shapeOf(el("rectangle", 0, 0, 100, 60, { seed: 42 }));
    const c = shapeOf(el("rectangle", 0, 0, 100, 60, { seed: 43 }));
    expect(a.map(p => p.d)).toEqual(b.map(p => p.d)); expect(a[0].d).not.toBe(c[0].d);
  });
  it("dashed strokes carry a dash pattern scaled by the stroke width", () => {
    const dashed = shapeOf(el("rectangle", 0, 0, 100, 60, { strokeStyle: "dashed" }));
    expect(dashed.find(p => p.stroke !== "none")!.dash).toEqual([8, 10]);
  });
});
