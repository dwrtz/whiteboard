// Drawing elements: one shape builder (roughjs + perfect-freehand) feeds both the canvas and SVG export.
import { RoughGenerator } from "roughjs/bin/generator";
import type { Options } from "roughjs/bin/core";
import { getStroke } from "perfect-freehand";
import type { Element, LinearElement, FreedrawElement, TextElement, ImageElement, Point, Arrowhead, BinaryFiles } from "./types";
import { fontStack, isLinear, isFreedraw, isText, isImage } from "./types";
import { localBox, commonBounds, type Box } from "./geometry";

const gen = new RoughGenerator();
export type ShapePath = { d: string; stroke: string; strokeWidth: number; fill: string; dash?: number[]; fillRule?: "evenodd" | "nonzero" };
type Built = { key: string; paths: ShapePath[] };
const cache = new Map<string, Built>();
/** Cache key: everything the paths depend on, so an uncommitted drag preview (same version) still rebuilds. */
export const shapeKey = (e: Element) => {
  const a = e as any;
  return JSON.stringify([e.version, e.versionNonce, e.type, e.width, e.height, e.seed, e.strokeColor, e.backgroundColor, e.fillStyle,
    e.strokeWidth, e.strokeStyle, e.roughness, e.roundness, a.points, a.pressures, a.simulatePressure, a.polygon, a.startArrowhead, a.endArrowhead]);
};
const keyOf = shapeKey;

function dashFor(e: Element): number[] | undefined {
  if (e.strokeStyle === "dashed") return [8, 8 + e.strokeWidth];
  if (e.strokeStyle === "dotted") return [1.5, 6 + e.strokeWidth];
  return undefined;
}
function opts(e: Element, fillable: boolean): Options {
  const o: Options = {
    seed: e.seed, stroke: e.strokeColor, strokeWidth: e.strokeWidth, roughness: e.roughness, fillWeight: e.strokeWidth / 2,
    hachureGap: e.strokeWidth * 4, preserveVertices: e.roughness < 2, disableMultiStroke: e.strokeStyle !== "solid",
    strokeLineDash: dashFor(e),
  };
  if (fillable && e.backgroundColor !== "transparent") { o.fill = e.backgroundColor; o.fillStyle = e.fillStyle; }
  return o;
}
function toPaths(e: Element, drawables: ReturnType<RoughGenerator["path"]>[]): ShapePath[] {
  const dash = dashFor(e); const out: ShapePath[] = [];
  for (const d of drawables) {
    // like rough's own canvas renderer: paths and polygons fill even-odd, ellipses and rectangles non-zero
    // (an ellipse's rough fill outline overlaps itself, so even-odd would leave it empty)
    const fillRule = d.shape === "curve" || d.shape === "polygon" || d.shape === "path" ? "evenodd" : "nonzero";
    for (const p of gen.toPaths(d)) {
    const isOutline = p.stroke === e.strokeColor && p.strokeWidth === e.strokeWidth && p.fill === "none";
    out.push({ d: p.d, stroke: p.stroke, strokeWidth: p.strokeWidth, fill: p.fill || "none", dash: isOutline ? dash : undefined, fillRule });
  } }
  return out;
}
/** Corner radius like the file format: type 2 = proportional (25 % of the short side), type 3 = adaptive (max 32). */
export function cornerRadius(e: Element, size: number): number {
  if (!e.roundness) return 0;
  if (e.roundness.type === 3) { const fixed = e.roundness.value ?? 32; return size <= fixed / 0.25 ? size * 0.25 : fixed; }
  return size * 0.25;
}
export function roundedRect(x: number, y: number, w: number, h: number, r: number) {
  return `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y}, ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h}, ${x + w - r} ${y + h} L ${x + r} ${y + h} Q ${x} ${y + h}, ${x} ${y + h - r} L ${x} ${y + r} Q ${x} ${y}, ${x + r} ${y}`;
}
function arrowheadShapes(e: LinearElement, pts: Point[], at: "start" | "end", head: Arrowhead): ReturnType<RoughGenerator["path"]>[] {
  const n = pts.length; if (n < 2) return [];
  const [tip, prev] = at === "end" ? [pts[n - 1], pts[n - 2]] : [pts[0], pts[1]];
  const ang = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
  const segLen = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]);
  const size = Math.min(head === "bar" ? 15 : 20 + e.strokeWidth * 2, segLen * 0.75 || 10);
  const o: Options = { ...opts(e, false), strokeLineDash: undefined, disableMultiStroke: false };
  const filled: Options = { ...o, fill: e.strokeColor, fillStyle: "solid" };
  const outlined: Options = { ...o, fill: "#00000000", fillStyle: "solid" };
  const back = (a: number, len = size): Point => [tip[0] - len * Math.cos(ang + a), tip[1] - len * Math.sin(ang + a)];
  switch (head) {
    case "arrow": { const s = Math.PI / 7; return [gen.linearPath([back(s), tip, back(-s)], o)]; }
    case "bar": { const p1 = back(Math.PI / 2, size / 2), p2 = back(-Math.PI / 2, size / 2); return [gen.line(p1[0], p1[1], p2[0], p2[1], o)]; }
    case "triangle": case "triangle_outline": { const s = Math.PI / 9; return [gen.polygon([tip, back(s), back(-s)], head === "triangle" ? filled : o)]; }
    case "circle": case "circle_outline": { const r = size / 3; const c = back(0, r); return [gen.circle(c[0], c[1], r * 2, head === "circle" ? filled : outlined)]; }
    case "diamond": case "diamond_outline": { const l = size * 0.9; const s = Math.PI / 8; const far = back(0, l); return [gen.polygon([tip, back(s, l / 2 / Math.cos(s)), far, back(-s, l / 2 / Math.cos(s))], head === "diamond" ? filled : o)]; }
    default: return [];
  }
}
export function freedrawPath(e: FreedrawElement): string {
  const input = e.points.map(([x, y], i) => [x, y, e.simulatePressure ? 0.5 : e.pressures[i] ?? 0.5]);
  const stroke = getStroke(input, { size: e.strokeWidth * 4.25, thinning: 0.6, smoothing: 0.5, streamline: 0.5, easing: t => Math.sin((t * Math.PI) / 2), last: true, simulatePressure: !!e.simulatePressure });
  if (!stroke.length) return "";
  const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let d = `M ${stroke[0][0].toFixed(2)} ${stroke[0][1].toFixed(2)} Q`;
  for (let i = 0; i < stroke.length; i++) { const a = stroke[i], b = stroke[(i + 1) % stroke.length]; const m = mid(a, b); d += ` ${a[0].toFixed(2)} ${a[1].toFixed(2)} ${m[0].toFixed(2)} ${m[1].toFixed(2)}`; }
  return d + " Z";
}
/** Shape paths in the element's local frame (origin = element x, y). */
export function shapeOf(e: Element, cachePaths = true): ShapePath[] {
  const k = cachePaths ? keyOf(e) : ""; const hit = cachePaths && cache.get(e.id);
  if (hit && hit.key === k) return hit.paths;
  let paths: ShapePath[] = [];
  const w = e.width, h = e.height;
  if (e.type === "rectangle") {
    const r = cornerRadius(e, Math.min(Math.abs(w), Math.abs(h)));
    const x = Math.min(0, w), y = Math.min(0, h), aw = Math.abs(w), ah = Math.abs(h);
    paths = toPaths(e, [r ? gen.path(roundedRect(x, y, aw, ah, r), opts(e, true)) : gen.rectangle(x, y, aw, ah, opts(e, true))]);
  } else if (e.type === "diamond") {
    const top: Point = [w / 2, 0], right: Point = [w, h / 2], bottom: Point = [w / 2, h], left: Point = [0, h / 2];
    if (e.roundness) {
      const r = cornerRadius(e, Math.min(Math.abs(w), Math.abs(h)) / 2) * 0.6;
      const lerp = (a: Point, b: Point, t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const side = Math.hypot(w / 2, h / 2) || 1; const t = Math.min(r / side, 0.45);
      const c = [top, right, bottom, left];
      let d = "";
      for (let i = 0; i < 4; i++) {
        const p = c[i], prev = c[(i + 3) % 4], next = c[(i + 1) % 4];
        const a = lerp(p, prev, t), b = lerp(p, next, t);
        d += `${i ? "L" : "M"} ${a[0]} ${a[1]} Q ${p[0]} ${p[1]}, ${b[0]} ${b[1]} `;
      }
      paths = toPaths(e, [gen.path(d + "Z", opts(e, true))]);
    } else paths = toPaths(e, [gen.polygon([top, right, bottom, left], opts(e, true))]);
  } else if (e.type === "ellipse") {
    paths = toPaths(e, [gen.ellipse(w / 2, h / 2, Math.abs(w), Math.abs(h), { ...opts(e, true), curveFitting: 1 })]);
  } else if (isLinear(e)) {
    const pts = e.points as Point[];
    const closed = e.type === "line" && !!e.polygon && pts.length > 2;
    const o = opts(e, closed);
    const body = pts.length < 2 ? [] : closed ? [gen.polygon(pts, o)] : e.roundness && pts.length > 2 ? [gen.curve(pts, o)] : [gen.linearPath(pts, o)];
    const heads = e.type === "arrow" ? [...(e.startArrowhead ? arrowheadShapes(e, pts, "start", e.startArrowhead) : []), ...(e.endArrowhead ? arrowheadShapes(e, pts, "end", e.endArrowhead) : [])] : [];
    paths = toPaths(e, [...body, ...heads]);
  } else if (isFreedraw(e)) {
    const d = freedrawPath(e);
    paths = d ? [{ d, stroke: "none", strokeWidth: 0, fill: e.strokeColor }] : [];
    if (e.backgroundColor !== "transparent" && e.points.length > 2) paths.unshift(...toPaths(e, [gen.polygon(e.points as Point[], { ...opts(e, true), stroke: "none", strokeWidth: 0 })]).filter(p => p.stroke !== "none" || p.fill !== "none"));
  }
  if (cachePaths) cache.set(e.id, { key: k, paths });
  return paths;
}

// ---------- export ----------
export const EXPORT_PADDING = 10;
export type ExportOpts = { background: boolean; backgroundColor: string; dark: boolean; scale: number; padding?: number };
export function exportBounds(els: Element[], padding = EXPORT_PADDING): Box | null {
  const b = commonBounds(els.filter(e => !e.isDeleted));
  if (!b) return null;
  return { x1: b.x1 - padding, y1: b.y1 - padding, x2: b.x2 + padding, y2: b.y2 + padding };
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** A standalone SVG. `fontCss` is an @font-face rule to embed (the hand-drawn font) when text uses it. */
export function exportSvg(els: Element[], files: BinaryFiles, o: ExportOpts & { fontCss?: string; cachePaths?: boolean }): string {
  const live = els.filter(e => !e.isDeleted);
  const b = exportBounds(live, o.padding ?? EXPORT_PADDING) ?? { x1: 0, y1: 0, x2: 100, y2: 100 };
  const W = b.x2 - b.x1, H = b.y2 - b.y1;
  const parts: string[] = [];
  for (const e of live) {
    const lb = localBox(e); const cx = (lb.x1 + lb.x2) / 2 - b.x1, cy = (lb.y1 + lb.y2) / 2 - b.y1;
    const tf = `${e.angle ? `rotate(${(e.angle * 180) / Math.PI} ${cx} ${cy}) ` : ""}translate(${e.x - b.x1} ${e.y - b.y1})`;
    const op = e.opacity < 100 ? ` opacity="${e.opacity / 100}"` : "";
    if (isText(e)) {
      const lh = e.fontSize * e.lineHeight; const anchor = e.textAlign === "center" ? "middle" : e.textAlign === "right" ? "end" : "start";
      const x = e.textAlign === "center" ? e.width / 2 : e.textAlign === "right" ? e.width : 0;
      const lines = e.text.split("\n").map((l, i) => `<text x="${x}" y="${i * lh + lh / 2 + e.fontSize * 0.35}" font-family="${esc(fontStack(e.fontFamily))}" font-size="${e.fontSize}px" fill="${esc(e.strokeColor)}" text-anchor="${anchor}" style="white-space: pre;">${esc(l)}</text>`).join("");
      parts.push(`<g transform="${tf}"${op}>${lines}</g>`);
    } else if (isImage(e)) {
      const f = e.fileId ? files[e.fileId] : undefined;
      if (f) parts.push(`<g transform="${tf}"${op}><image href="${esc(f.dataURL)}" width="${e.width}" height="${e.height}" preserveAspectRatio="none"/></g>`);
    } else {
      const ps = shapeOf(e, o.cachePaths).map(p => `<path d="${p.d}" stroke="${esc(p.stroke)}" stroke-width="${p.strokeWidth}" fill="${esc(p.fill)}"${p.fill !== "none" && p.fillRule === "evenodd" ? ' fill-rule="evenodd"' : ""}${p.dash ? ` stroke-dasharray="${p.dash.join(" ")}"` : ""} stroke-linecap="round" stroke-linejoin="round"/>`).join("");
      parts.push(`<g transform="${tf}"${op}>${ps}</g>`);
    }
  }
  const bg = o.background ? `<rect x="0" y="0" width="${W}" height="${H}" fill="${esc(o.backgroundColor)}"/>` : "";
  const style = o.fontCss ? `<defs><style>${o.fontCss}</style></defs>` : "";
  const filter = o.dark ? ` style="filter: invert(93%) hue-rotate(180deg);"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ${W} ${H}" width="${W * o.scale}" height="${H * o.scale}"${filter}><!-- svg-source:whiteboard -->${style}${bg}${parts.join("")}</svg>`;
}
