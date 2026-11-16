import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import type { Element, ElementType, LinearElement, FreedrawElement, TextElement, ImageElement, Point, Arrowhead, FillStyle, StrokeStyle, TextAlign } from "./types";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";
export function randomId(n = 21): string {
  const b = crypto.getRandomValues(new Uint8Array(n));
  let s = ""; for (const x of b) s += ALPHABET[x & 63]; return s;
}
export const randomInteger = () => Math.floor(Math.random() * 2 ** 31);

/** The style a new element gets (the "current item" style in the editor). */
export type Style = {
  strokeColor: string; backgroundColor: string; fillStyle: FillStyle; strokeWidth: number; strokeStyle: StrokeStyle;
  roughness: number; opacity: number; roundness: "round" | "sharp"; fontFamily: number; fontSize: number; textAlign: TextAlign;
  startArrowhead: Arrowhead | null; endArrowhead: Arrowhead | null;
};
export const DEFAULT_STYLE: Style = {
  strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid",
  roughness: 1, opacity: 100, roundness: "round", fontFamily: 5, fontSize: 20, textAlign: "left",
  startArrowhead: null, endArrowhead: "arrow",
};

export function newElement(type: ElementType, x: number, y: number, style: Style, now: number, extra: Partial<Element> = {}): Element {
  const base = {
    id: randomId(), type, x, y, width: 0, height: 0, angle: 0,
    strokeColor: style.strokeColor, backgroundColor: style.backgroundColor, fillStyle: style.fillStyle,
    strokeWidth: style.strokeWidth, strokeStyle: style.strokeStyle, roughness: style.roughness, opacity: style.opacity,
    roundness: style.roundness === "round" && (type === "rectangle" || type === "diamond" || type === "line" || type === "arrow" || type === "image") ? { type: type === "rectangle" || type === "image" ? 3 : 2 } : null,
    seed: randomInteger(), version: 1, versionNonce: randomInteger(), index: null, isDeleted: false, groupIds: [], frameId: null,
    boundElements: null, updated: now, link: null, locked: false,
  };
  if (type === "arrow" || type === "line") {
    return { ...base, points: [[0, 0]] as Point[], startBinding: null, endBinding: null,
      startArrowhead: type === "arrow" ? style.startArrowhead : null, endArrowhead: type === "arrow" ? style.endArrowhead : null,
      ...(type === "arrow" ? { elbowed: false } : { polygon: false }), ...extra } as LinearElement;
  }
  if (type === "freedraw") return { ...base, roundness: null, points: [[0, 0]], pressures: [], simulatePressure: true, ...extra } as FreedrawElement;
  if (type === "text") return { ...base, text: "", originalText: "", fontSize: style.fontSize, fontFamily: style.fontFamily, textAlign: style.textAlign,
    verticalAlign: "top", containerId: null, lineHeight: 1.25, autoResize: true, ...extra } as TextElement;
  if (type === "image") return { ...base, strokeColor: "transparent", backgroundColor: "transparent", fileId: null, status: "pending", scale: [1, 1], crop: null, ...extra } as ImageElement;
  return { ...base, ...extra } as Element;
}

/** Every change makes a new object with a higher version and a new nonce (used to reconcile copies). */
export function bump<T extends Element>(e: T, patch: Partial<T>, now: number): T {
  return { ...e, ...patch, version: e.version + 1, versionNonce: randomInteger(), updated: now };
}

export function duplicate(e: Element, dx: number, dy: number, now: number, groupMap: Map<string, string>): Element {
  const groupIds = e.groupIds.map(g => { if (!groupMap.has(g)) groupMap.set(g, randomId()); return groupMap.get(g)!; });
  return { ...e, id: randomId(), x: e.x + dx, y: e.y + dy, seed: randomInteger(), version: 1, versionNonce: randomInteger(), updated: now,
    groupIds, boundElements: null, ...(e.type === "arrow" || e.type === "line" ? { startBinding: null, endBinding: null } : {}) } as Element;
}

/** Order = the `index` fractional keys (ties by id). Elements whose key changes get a new version. Keeps array order: every key that is not strictly above
 *  the previous kept key (or missing) is replaced by one between its valid neighbours; valid keys are kept. */
export function syncIndices(els: Element[]): Element[] {
  const valid: boolean[] = []; let last: string | null = null;
  for (const e of els) { const ok = !!e.index && (last === null || e.index > last); valid.push(ok); if (ok) last = e.index; }
  const out = els.slice();
  let i = 0;
  while (i < out.length) {
    if (valid[i]) { i++; continue; }
    let j = i; while (j < out.length && !valid[j]) j++;
    const lo = i > 0 ? out[i - 1].index : null, hi = j < out.length ? out[j].index : null;
    const keys = keysBetween(lo, hi, j - i);
    // a changed key is a change like any other: bump the version so collaborators and saves pick it up
    for (let k = i; k < j; k++) out[k] = { ...out[k], index: keys[k - i], version: out[k].version + 1, versionNonce: randomInteger() };
    i = j;
  }
  return out;
}
function safeKey(a: string | null, b: string | null): string {
  try { return generateKeyBetween(a, b); } catch { return generateKeyBetween(a, null); }
}
export function sortByIndex(els: Element[]): Element[] {
  return els.slice().sort((a, b) => (a.index! < b.index! ? -1 : a.index! > b.index! ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  try { return generateNKeysBetween(a, b, n); } catch { return generateNKeysBetween(a, null, n); }
}
