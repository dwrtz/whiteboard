import type { Element, Point } from "./types";
import { hasPoints } from "./types";

export type Box = { x1: number; y1: number; x2: number; y2: number };

export function rotate(px: number, py: number, cx: number, cy: number, angle: number): Point {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [(px - cx) * c - (py - cy) * s + cx, (px - cx) * s + (py - cy) * c + cy];
}
/** Unrotated box of an element's own coordinates (points-based elements use their points). */
export function localBox(e: Element): Box {
  if (hasPoints(e)) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const [px, py] of e.points) { x1 = Math.min(x1, px); y1 = Math.min(y1, py); x2 = Math.max(x2, px); y2 = Math.max(y2, py); }
    if (!isFinite(x1)) return { x1: e.x, y1: e.y, x2: e.x, y2: e.y };
    return { x1: e.x + x1, y1: e.y + y1, x2: e.x + x2, y2: e.y + y2 };
  }
  return { x1: e.x, y1: e.y, x2: e.x + e.width, y2: e.y + e.height };
}
export function center(e: Element): Point { const b = localBox(e); return [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2]; }
/** Axis-aligned bounds after rotation. */
export function bounds(e: Element): Box {
  const b = localBox(e);
  if (!e.angle) return b;
  const [cx, cy] = [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];
  const pts = [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]].map(([x, y]) => rotate(x, y, cx, cy, e.angle));
  return { x1: Math.min(...pts.map(p => p[0])), y1: Math.min(...pts.map(p => p[1])), x2: Math.max(...pts.map(p => p[0])), y2: Math.max(...pts.map(p => p[1])) };
}
export function commonBounds(els: Element[]): Box | null {
  if (!els.length) return null;
  const bs = els.map(bounds);
  return { x1: Math.min(...bs.map(b => b.x1)), y1: Math.min(...bs.map(b => b.y1)), x2: Math.max(...bs.map(b => b.x2)), y2: Math.max(...bs.map(b => b.y2)) };
}
export function boxContains(outer: Box, inner: Box) { return inner.x1 >= outer.x1 && inner.y1 >= outer.y1 && inner.x2 <= outer.x2 && inner.y2 <= outer.y2; }
export function boxesIntersect(a: Box, b: Box) { return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1; }

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay; const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function pointInPolygon(px: number, py: number, poly: Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Does a click at (x, y) hit this element? `tol` is in scene units. Filled shapes, text and images hit inside;
 *  outlines, lines and drawings hit near their stroke. */
export function hitTest(e: Element, x: number, y: number, tol: number): boolean {
  const [cx, cy] = center(e);
  const [lx, ly] = e.angle ? rotate(x, y, cx, cy, -e.angle) : [x, y];
  const b = localBox(e);
  if (lx < b.x1 - tol || lx > b.x2 + tol || ly < b.y1 - tol || ly > b.y2 + tol) return false;
  const filled = e.backgroundColor !== "transparent" || e.type === "text" || e.type === "image";
  if (hasPoints(e)) {
    const pts = e.points;
    if (pts.length === 1) return Math.hypot(lx - (e.x + pts[0][0]), ly - (e.y + pts[0][1])) <= tol + e.strokeWidth;
    for (let i = 1; i < pts.length; i++) if (distToSegment(lx, ly, e.x + pts[i - 1][0], e.y + pts[i - 1][1], e.x + pts[i][0], e.y + pts[i][1]) <= tol + e.strokeWidth / 2) return true;
    if (e.type === "line" && filled && pts.length > 2) return pointInPolygon(lx, ly, pts.map(([px, py]) => [e.x + px, e.y + py]));
    return false;
  }
  if (e.type === "ellipse") {
    const rx = e.width / 2, ry = e.height / 2; const ex = (lx - cx), ey = (ly - cy);
    if (rx < 1 || ry < 1) return Math.abs(ex) <= rx + tol && Math.abs(ey) <= ry + tol;
    const outer = (ex * ex) / ((rx + tol) ** 2) + (ey * ey) / ((ry + tol) ** 2) <= 1;
    if (!outer) return false; if (filled) return true;
    const ir = Math.max(rx - tol, 0.1), iry = Math.max(ry - tol, 0.1);
    return (ex * ex) / (ir * ir) + (ey * ey) / (iry * iry) >= 1;
  }
  if (e.type === "diamond") {
    const poly: Point[] = [[cx, b.y1], [b.x2, cy], [cx, b.y2], [b.x1, cy]];
    if (filled && pointInPolygon(lx, ly, poly)) return true;
    for (let i = 0; i < 4; i++) { const a = poly[i], c = poly[(i + 1) % 4]; if (distToSegment(lx, ly, a[0], a[1], c[0], c[1]) <= tol + e.strokeWidth / 2) return true; }
    return false;
  }
  // rectangle, text, image
  if (filled) return true;
  const edges: [number, number, number, number][] = [[b.x1, b.y1, b.x2, b.y1], [b.x2, b.y1, b.x2, b.y2], [b.x2, b.y2, b.x1, b.y2], [b.x1, b.y2, b.x1, b.y1]];
  return edges.some(([a1, a2, c1, c2]) => distToSegment(lx, ly, a1, a2, c1, c2) <= tol + e.strokeWidth / 2);
}

/** Where the ray from the element's centre toward `toward` leaves its real outline (rectangle, text and image:
 *  the box; ellipse: the ellipse; diamond: the rhombus through its edge midpoints), moved `gap` further out along
 *  the same ray. Rotation is honoured. Used to place bound arrow ends just outside a shape. */
export function edgePoint(e: Element, toward: Point, gap = 4): Point {
  const [cx, cy] = center(e);
  const [tx, ty] = e.angle ? rotate(toward[0], toward[1], cx, cy, -e.angle) : toward;
  let dx = tx - cx, dy = ty - cy; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
  const hw = Math.abs(e.width) / 2 || 1e-9, hh = Math.abs(e.height) / 2 || 1e-9;
  let t: number;
  if (e.type === "ellipse") t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  else if (e.type === "diamond") t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  t += gap;
  const p: Point = [cx + dx * t, cy + dy * t];
  return e.angle ? rotate(p[0], p[1], cx, cy, e.angle) : p;
}
export const snap = (v: number, grid: number | null) => (grid ? Math.round(v / grid) * grid : v);
