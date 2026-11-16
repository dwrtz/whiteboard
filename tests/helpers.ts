import { newElement, DEFAULT_STYLE, syncIndices } from "../src/shared/elements";
import type { Element, ElementType } from "../src/shared/types";
export function el(type: ElementType, x: number, y: number, w = 100, h = 100, extra: Record<string, unknown> = {}): Element {
  const e = newElement(type, x, y, DEFAULT_STYLE, 1000, extra as any);
  return { ...e, width: w, height: h, ...(type === "arrow" || type === "line" ? { points: (extra.points as any) ?? [[0, 0], [w, h]] } : {}) } as Element;
}
export const indexed = (els: Element[]) => syncIndices(els);
