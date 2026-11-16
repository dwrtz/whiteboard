import type { Element, LinearElement, Point, Binding } from "./types";
import { isLinear } from "./types";
import { edgePoint, hitTest, bounds, rotate, center } from "./geometry";
import { bump } from "./elements";

export const BINDABLE = new Set(["rectangle", "diamond", "ellipse", "text", "image"]);

/** The topmost bindable element under (x, y), within `tol` of its outline or inside it. */
export function bindTarget(els: Element[], x: number, y: number, tol: number, exclude: Set<string>): Element | null {
  for (let i = els.length - 1; i >= 0; i--) {
    const e = els[i];
    if (e.isDeleted || exclude.has(e.id) || !BINDABLE.has(e.type) || e.locked) continue;
    const b = bounds(e);
    if (x < b.x1 - tol || x > b.x2 + tol || y < b.y1 - tol || y > b.y2 + tol) continue;
    if (hitTest({ ...e, backgroundColor: "#000" } as Element, x, y, tol)) return e;
  }
  return null;
}
/** Where on the target (as 0..1 of its unrotated box) a point sits — stored as the binding's fixedPoint. */
export function fixedPointOf(target: Element, x: number, y: number): [number, number] {
  const [cx, cy] = center(target);
  const [lx, ly] = target.angle ? rotate(x, y, cx, cy, -target.angle) : [x, y];
  const w = target.width || 1, h = target.height || 1;
  return [Math.min(Math.max((lx - target.x) / w, 0), 1), Math.min(Math.max((ly - target.y) / h, 0), 1)];
}
const abs = (a: LinearElement, i: number): Point => [a.x + a.points[i][0], a.y + a.points[i][1]];

/** Recompute the ends of an arrow from its bindings: each bound end sits on the target's outline, on the
 *  line toward the neighbouring point (or the other target's centre for a two-point arrow bound at both ends). */
export function placeBoundEnds(arrow: LinearElement, byId: Map<string, Element>): LinearElement {
  const n = arrow.points.length; if (n < 2) return arrow;
  const pts: Point[] = arrow.points.map((_, i) => abs(arrow, i));
  const start = arrow.startBinding && byId.get(arrow.startBinding.elementId);
  const end = arrow.endBinding && byId.get(arrow.endBinding.elementId);
  const live = (e: Element | null | undefined) => (e && !e.isDeleted ? e : null);
  const s = live(start), t = live(end);
  if (!s && !t) return arrow;
  if (s) { const toward = n === 2 && t ? center(t) : pts[1]; pts[0] = edgePoint(s, toward); }
  if (t) { const toward = n === 2 && s ? center(s) : pts[n - 2]; pts[n - 1] = edgePoint(t, toward); }
  if (n === 2 && s && t) pts[0] = edgePoint(s, pts[1]); // settle the start against the placed end
  const ox = pts[0][0], oy = pts[0][1];
  const points = pts.map(([x, y]) => [x - ox, y - oy] as Point);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  return { ...arrow, x: ox, y: oy, points, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** After elements in `changed` moved or resized, move the bound ends of arrows attached to them.
 *  Arrows that are themselves in `changed` (moved together with their targets) are left alone. */
export function updateBoundArrows(els: Element[], changed: Set<string>, now: number): Element[] {
  const byId = new Map(els.map(e => [e.id, e] as const));
  return els.map(e => {
    if (!isLinear(e) || e.isDeleted || changed.has(e.id)) return e;
    const hit = (b: Binding | null) => !!b && changed.has(b.elementId);
    if (!hit(e.startBinding) && !hit(e.endBinding)) return e;
    const placed = placeBoundEnds(e, byId);
    return bump(placed, {}, now);
  });
}
/** Keep the targets' boundElements lists in step with arrow bindings (needed by other tools reading the file). */
export function syncBoundElements(els: Element[], now: number): Element[] {
  const want = new Map<string, Set<string>>();
  for (const e of els) if (isLinear(e) && !e.isDeleted) for (const b of [e.startBinding, e.endBinding]) if (b) (want.get(b.elementId) ?? want.set(b.elementId, new Set()).get(b.elementId)!).add(e.id);
  return els.map(e => {
    if (!BINDABLE.has(e.type)) return e;
    const cur = (e.boundElements ?? []).filter(b => b.type === "arrow").map(b => b.id).sort();
    const next = [...(want.get(e.id) ?? [])].sort();
    if (cur.join() === next.join()) return e;
    const other = (e.boundElements ?? []).filter(b => b.type !== "arrow");
    const list = [...other, ...next.map(id => ({ id, type: "arrow" as const }))];
    return bump(e, { boundElements: list.length ? list : null }, now);
  });
}
/** Remove bindings that point at deleted or missing elements. */
export function dropDeadBindings(els: Element[], now: number): Element[] {
  const alive = new Set(els.filter(e => !e.isDeleted).map(e => e.id));
  return els.map(e => {
    if (!isLinear(e)) return e;
    const s = e.startBinding && !alive.has(e.startBinding.elementId), t = e.endBinding && !alive.has(e.endBinding.elementId);
    return s || t ? bump(e, { ...(s ? { startBinding: null } : {}), ...(t ? { endBinding: null } : {}) } as Partial<LinearElement>, now) : e;
  });
}
