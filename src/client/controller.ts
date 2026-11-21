// Pointer, wheel and keyboard handling for the canvas. Pure editor logic; React only renders.
/** Ctrl/⌘+wheel zoom: each event changes zoom by deltaY/100 (deltaY clamped to ±10, so at most 10 %),
 *  plus log10(zoom) more per event above 100 % (scaled down for small trackpad deltas). */
/** Screen pixels the pointer must travel between down and up to count as a drag, not a click (Excalidraw's DRAGGING_THRESHOLD). */
export const DRAG_THRESHOLD = 10;
/** A click within this many screen pixels of a multi-point line's last fixed point finishes it (Excalidraw's LINE_CONFIRM_THRESHOLD). */
export const LINE_CONFIRM = 8;
export function wheelZoom(zoom: number, deltaY: number): number {
  const sign = Math.sign(deltaY), abs = Math.abs(deltaY);
  const delta = Math.max(-10, Math.min(10, deltaY));
  return zoom - delta / 100 + Math.log10(Math.max(1, zoom)) * -sign * Math.min(1, abs / 20);
}
import type { Element, LinearElement, FreedrawElement, TextElement, Point, ToolType, ElementType } from "../shared/types";
import { isLinear, isFreedraw, isText, hasPoints, LINE_HEIGHT } from "../shared/types";
import { newElement, bump, duplicate, randomInteger, sortByIndex, type Style } from "../shared/elements";
import { bounds, commonBounds, hitTest, localBox, center, rotate, snap, boxContains, boxesIntersect, type Box } from "../shared/geometry";
import { bindTarget, fixedPointOf, placeBoundEnds, updateBoundArrows } from "../shared/binding";
import { reorder, align, distribute, group, ungroup, flip, expandToGroups, outerGroup } from "../shared/actions";
import type { Snap } from "../shared/history";
import { Store, clampZoom } from "./store";
import { measureText } from "./render";
import { CanvasPinch } from "./pinch";

export const HANDLE = 8; // px on screen
type Handle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se" | "rotate" | `p${number}`;
type Drag =
  | { kind: "pan"; sx: number; sy: number; scrollX: number; scrollY: number }
  | { kind: "create"; id: string; ox: number; oy: number; before: Snap; sx: number; sy: number }
  | { kind: "linear"; id: string; before: Snap; moved: boolean; sx: number; sy: number }
  | { kind: "freedraw"; id: string; before: Snap }
  | { kind: "move"; sx: number; sy: number; originals: Map<string, Element>; before: Snap; moved: boolean }
  | { kind: "resize"; handle: Handle; originals: Map<string, Element>; box: Box; before: Snap; angle: number; sx: number; sy: number }
  | { kind: "rotate"; originals: Map<string, Element>; cx: number; cy: number; start: number; before: Snap }
  | { kind: "point"; id: string; index: number; original: LinearElement; before: Snap }
  | { kind: "box"; sx: number; sy: number; base: Set<string> }
  | { kind: "erase" };

export type ControllerHooks = {
  openImagePicker: (at?: Point) => void;
  openText: (id: string) => void;
  onToast: (msg: string) => void;
  onPointer?: (x: number, y: number, button: "up" | "down") => void;
  /** keyboard shortcuts that open dialogs (export, open, help, …) */
  command: (name: string) => void;
};

export class Controller {
  drag: Drag | null = null;
  readonly pinch: CanvasPinch;
  spacePan = false;
  /** Multi-point line being drawn with clicks (each click adds a point). */
  multi: string | null = null;
  rect: DOMRect = new DOMRect(0, 0, 0, 0);
  private lastClick = { t: 0, x: 0, y: 0 };
  copiedStyle: Partial<Element> | null = null;
  lastPointer: Point | null = null;

  constructor(public s: Store, public hooks: ControllerHooks) {
    this.pinch = new CanvasPinch(s, () => this.rect, () => {
      this.lastClick.t = -Infinity;
      this.cancelDrag();
      s.dragging = false;
    });
  }

  // ---------- coordinates ----------
  toScene(cx: number, cy: number): Point {
    const { zoom, scrollX, scrollY } = this.s.view;
    return [(cx - this.rect.left) / zoom - scrollX, (cy - this.rect.top) / zoom - scrollY];
  }
  toScreen(x: number, y: number): Point { const { zoom, scrollX, scrollY } = this.s.view; return [(x + scrollX) * zoom, (y + scrollY) * zoom]; }
  zoomAt(z: number, sx: number, sy: number) {
    const zoom = clampZoom(z); const { scrollX, scrollY } = this.s.view;
    const [x, y] = [sx / this.s.view.zoom - scrollX, sy / this.s.view.zoom - scrollY];
    this.s.setView({ zoom, scrollX: sx / zoom - x, scrollY: sy / zoom - y });
  }
  zoomBy(step: number) { this.zoomAt(this.s.view.zoom + step, this.rect.width / 2, this.rect.height / 2); }
  /** Zoom and scroll so the elements fit the screen (Shift+1 / Shift+2). */
  fit(els: Element[], maxZoom = 1) {
    const b = commonBounds(els.filter(e => !e.isDeleted));
    if (!b) { this.s.setView({ scrollX: 0, scrollY: 0, zoom: 1 }); return; }
    const pad = 40, W = this.rect.width || 800, H = this.rect.height || 600;
    const zoom = clampZoom(Math.min((W - pad * 2) / Math.max(b.x2 - b.x1, 1), (H - pad * 2) / Math.max(b.y2 - b.y1, 1), maxZoom));
    this.s.setView({ zoom, scrollX: W / 2 / zoom - (b.x1 + b.x2) / 2, scrollY: H / 2 / zoom - (b.y1 + b.y2) / 2 });
  }
  viewportCenter(): Point { return [this.rect.width / 2 / this.s.view.zoom - this.s.view.scrollX, this.rect.height / 2 / this.s.view.zoom - this.s.view.scrollY]; }
  private tol() { return 10 / this.s.view.zoom; }
  private gridOn() { return this.s.appState.gridModeEnabled ? this.s.appState.gridSize ?? 20 : null; }

  // ---------- hit testing ----------
  hitAt(x: number, y: number, includeLocked = false): Element | null {
    const els = this.s.live();
    for (let i = els.length - 1; i >= 0; i--) {
      const e = els[i]; if (e.locked && !includeLocked) continue;
      if (this.s.editingGroup && !e.groupIds.includes(this.s.editingGroup) && this.s.selected.size) { /* outside the group: still hittable */ }
      if (hitTest(e, x, y, this.tol())) return e;
    }
    return null;
  }
  /** The box handles are drawn around: one element's own (rotated) box, or the selection's bounds. */
  selectionFrame(): { box: Box; angle: number; single: Element | null } | null {
    const sel = this.s.selectedElements(); if (!sel.length) return null;
    if (sel.length === 1 && !(sel[0].groupIds.length && !this.s.editingGroup)) return { box: localBox(sel[0]), angle: sel[0].angle, single: sel[0] };
    return { box: commonBounds(sel)!, angle: 0, single: null };
  }
  handles(): { name: Handle; x: number; y: number }[] {
    const f = this.selectionFrame(); if (!f || this.s.readOnly) return [];
    if (f.single?.locked) return [];
    if (f.single && isLinear(f.single)) return f.single.points.map((p, i) => ({ name: `p${i}` as Handle, x: f.single!.x + p[0], y: f.single!.y + p[1] }));
    const pad = 4 / this.s.view.zoom; const { x1, y1, x2, y2 } = f.box;
    const X1 = x1 - pad, Y1 = y1 - pad, X2 = x2 + pad, Y2 = y2 + pad, mx = (X1 + X2) / 2, my = (Y1 + Y2) / 2;
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    const small = (X2 - X1) * this.s.view.zoom < 30 || (Y2 - Y1) * this.s.view.zoom < 30;
    const list: { name: Handle; x: number; y: number }[] = [
      { name: "nw", x: X1, y: Y1 }, { name: "ne", x: X2, y: Y1 }, { name: "sw", x: X1, y: Y2 }, { name: "se", x: X2, y: Y2 },
      ...(small || (f.single && isText(f.single)) ? [] : [{ name: "n" as Handle, x: mx, y: Y1 }, { name: "s" as Handle, x: mx, y: Y2 }, { name: "w" as Handle, x: X1, y: my }, { name: "e" as Handle, x: X2, y: my }]),
      { name: "rotate", x: mx, y: Y1 - 20 / this.s.view.zoom },
    ];
    return f.angle ? list.map(h => { const [x, y] = rotate(h.x, h.y, cx, cy, f.angle); return { ...h, x, y }; }) : list;
  }
  private handleAt(x: number, y: number): Handle | null {
    const r = (HANDLE / 2 + 3) / this.s.view.zoom;
    for (const h of this.handles()) if (Math.abs(h.x - x) <= r && Math.abs(h.y - y) <= r) return h.name;
    return null;
  }

  // ---------- pointer ----------
  pointerDown(ev: PointerEvent) {
    if (this.pinch.pointer(ev, "down")) return;
    const [x, y] = this.toScene(ev.clientX, ev.clientY);
    const s = this.s;
    if (s.editingText) return; // the text box handles its own clicks; blur finishes editing
    if (ev.button === 1 || this.spacePan || s.tool === "hand" || (s.readOnly && ev.button === 0)) {
      this.drag = { kind: "pan", sx: ev.clientX, sy: ev.clientY, scrollX: s.view.scrollX, scrollY: s.view.scrollY }; return;
    }
    if (ev.button !== 0) return;
    const dbl = ev.timeStamp - this.lastClick.t < 400 && Math.hypot(ev.clientX - this.lastClick.x, ev.clientY - this.lastClick.y) < 6;
    this.lastClick = { t: dbl ? 0 : ev.timeStamp, x: ev.clientX, y: ev.clientY };
    if (this.multi) { this.addMultiPoint(x, y, dbl); return; }
    const tool = s.tool;
    if (tool === "selection") return this.selectionDown(x, y, ev, dbl);
    if (tool === "eraser") { this.drag = { kind: "erase" }; s.eraserMarked = new Set(); this.eraseAt(x, y); return; }
    if (tool === "text") { const hit = this.hitAt(x, y); if (hit && isText(hit)) return this.hooks.openText(hit.id); return this.createText(x, y); }
    if (tool === "image") { this.hooks.openImagePicker([x, y]); return; }
    const g = this.gridOn(); const px = snap(x, g), py = snap(y, g);
    const before = s.snap();
    if (tool === "freedraw") {
      const e = newElement("freedraw", x, y, s.style, s.now(), { simulatePressure: ev.pressure === 0.5 || ev.pointerType !== "pen", pressures: ev.pointerType === "pen" ? [ev.pressure] : [] } as any) as FreedrawElement;
      s.preview([...s.elements, e]); this.drag = { kind: "freedraw", id: e.id, before }; return;
    }
    if (tool === "arrow" || tool === "line") {
      const e = newElement(tool, px, py, s.style, s.now(), { points: [[0, 0], [0, 0]] } as any) as LinearElement;
      s.selected.clear(); s.preview([...s.elements, e]); this.drag = { kind: "linear", id: e.id, before, moved: false, sx: ev.clientX, sy: ev.clientY }; return;
    }
    const e = newElement(tool as ElementType, px, py, s.style, s.now());
    s.selected.clear(); s.preview([...s.elements, e]); this.drag = { kind: "create", id: e.id, ox: px, oy: py, before, sx: ev.clientX, sy: ev.clientY };
  }

  private selectionDown(x: number, y: number, ev: PointerEvent, dbl: boolean) {
    const s = this.s;
    const h = this.handleAt(x, y);
    if (h) return this.startHandleDrag(h, x, y);
    const hit = this.hitAt(x, y);
    if (dbl && this.doubleClick(x, y, hit)) return;
    const frame = this.selectionFrame();
    const insideSelection = frame && s.selected.size > 1 && x >= frame.box.x1 && x <= frame.box.x2 && y >= frame.box.y1 && y <= frame.box.y2;
    if (hit || insideSelection) {
      if (hit && ev.shiftKey) {
        const ids = expandToGroups(s.elements, new Set([hit.id]), s.editingGroup);
        const all = [...ids].every(id => s.selected.has(id));
        const next = new Set(s.selected); for (const id of ids) all ? next.delete(id) : next.add(id);
        s.select(next, false); return;
      }
      if (hit && !s.selected.has(hit.id)) {
        if (s.editingGroup && !hit.groupIds.includes(s.editingGroup)) s.editingGroup = null;
        s.select([hit.id]);
      }
      let originals = new Map(s.selectedElements().map(e => [e.id, e] as const));
      const before = s.snap();
      if (ev.altKey) { // Alt-drag leaves the originals and drags copies
        const gm = new Map<string, string>(); const copies = [...originals.values()].map(e => duplicate(e, 0, 0, s.now(), gm));
        s.elements = [...s.elements, ...copies]; s.selected = new Set(copies.map(c => c.id));
        originals = new Map(copies.map(c => [c.id, c] as const));
      }
      this.drag = { kind: "move", sx: x, sy: y, originals, before, moved: false };
      s.notify(); return;
    }
    if (!ev.shiftKey) { s.selected.clear(); s.editingGroup = null; s.notify(); }
    this.drag = { kind: "box", sx: x, sy: y, base: new Set(s.selected) };
  }
  /** Double-click: edit text, step into a group, or start text on empty canvas. Returns false when it
   *  should act as a normal click instead. */
  private doubleClick(x: number, y: number, hit: Element | null): boolean {
    const s = this.s;
    if (hit && isText(hit)) { this.hooks.openText(hit.id); return true; }
    if (hit && hit.groupIds.length) {
      const g = outerGroup(hit, s.editingGroup);
      if (g) { s.editingGroup = g; s.select([hit.id]); return true; }
    }
    if (!hit) { s.editingGroup = null; this.createText(x, y); return true; }
    return false;
  }
  private startHandleDrag(h: Handle, x: number, y: number) {
    const s = this.s; const f = this.selectionFrame()!; const before = s.snap();
    const originals = new Map(s.selectedElements().map(e => [e.id, e] as const));
    if (h.startsWith("p")) { const e = f.single as LinearElement; this.drag = { kind: "point", id: e.id, index: Number(h.slice(1)), original: e, before }; return; }
    if (h === "rotate") {
      const cx = (f.box.x1 + f.box.x2) / 2, cy = (f.box.y1 + f.box.y2) / 2;
      this.drag = { kind: "rotate", originals, cx, cy, start: Math.atan2(y - cy, x - cx), before }; return;
    }
    this.drag = { kind: "resize", handle: h, originals, box: f.box, before, angle: f.angle, sx: x, sy: y };
  }

  pointerMove(ev: PointerEvent) {
    if (this.pinch.pointer(ev, "move")) return;
    const [x, y] = this.toScene(ev.clientX, ev.clientY);
    this.hooks.onPointer?.(x, y, this.drag ? "down" : "up");
    const s = this.s; const d = this.drag;
    if (this.multi && !d) { this.updateLinearEnd(this.multi, x, y, ev.shiftKey); return; }
    if (!d) return;
    const g = this.gridOn();
    switch (d.kind) {
      case "pan": s.setView({ scrollX: d.scrollX + (ev.clientX - d.sx) / s.view.zoom, scrollY: d.scrollY + (ev.clientY - d.sy) / s.view.zoom }); return;
      case "create": {
        let x2 = snap(x, g), y2 = snap(y, g); let w = x2 - d.ox, h = y2 - d.oy;
        if (ev.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
        this.patchPreview(d.id, { x: Math.min(d.ox, d.ox + w), y: Math.min(d.oy, d.oy + h), width: Math.abs(w), height: Math.abs(h) }); return;
      }
      case "linear": {
        if (Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) >= DRAG_THRESHOLD) d.moved = true;
        this.updateLinearEnd(d.id, x, y, ev.shiftKey); return;
      }
      case "freedraw": {
        const e = s.get(d.id) as FreedrawElement;
        const pts = [...e.points, [x - e.x, y - e.y] as Point];
        this.patchPreview(d.id, { points: pts, pressures: e.simulatePressure ? [] : [...e.pressures, ev.pressure], ...sizeOf(pts) } as any); return;
      }
      case "move": {
        let dx = x - d.sx, dy = y - d.sy;
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        if (g) { const b = commonBounds([...d.originals.values()])!; dx = snap(b.x1 + dx, g) - b.x1; dy = snap(b.y1 + dy, g) - b.y1; }
        if (dx || dy) d.moved = true;
        const moved = s.elements.map(e => { const o = d.originals.get(e.id); return o ? { ...o, x: o.x + dx, y: o.y + dy } : e; });
        s.preview(this.withBindings(moved, new Set(d.originals.keys()))); return;
      }
      case "resize": return this.resizeTo(d, x, y, ev.shiftKey);
      case "rotate": {
        let delta = Math.atan2(y - d.cy, x - d.cx) - d.start;
        const single = d.originals.size === 1 ? [...d.originals.values()][0] : null;
        if (ev.shiftKey) { const base = single?.angle ?? 0; const target = Math.round((base + delta) / (Math.PI / 12)) * (Math.PI / 12); delta = target - base; }
        const next = s.elements.map(e => {
          const o = d.originals.get(e.id); if (!o) return e;
          const [ocx, ocy] = center(o); const [ncx, ncy] = rotate(ocx, ocy, d.cx, d.cy, delta);
          return { ...o, x: o.x + ncx - ocx, y: o.y + ncy - ocy, angle: normAngle(o.angle + delta) };
        });
        s.preview(this.withBindings(next, new Set(d.originals.keys()))); return;
      }
      case "point": {
        const o = d.original; const pts = o.points.map(p => [...p] as Point);
        pts[d.index] = [snap(x, g) - o.x, snap(y, g) - o.y];
        const end = d.index === 0 || d.index === pts.length - 1;
        const target = end && o.type === "arrow" ? bindTarget(s.live(), x, y, this.tol(), new Set([o.id])) : null;
        s.bindHint = target?.id ?? null;
        this.patchPreview(o.id, normalizeLinear({ ...o, points: pts })); return;
      }
      case "box": {
        const box = { x1: Math.min(d.sx, x), y1: Math.min(d.sy, y), x2: Math.max(d.sx, x), y2: Math.max(d.sy, y) };
        s.selectionBox = box;
        const inside = s.live().filter(e => !e.locked && boxContains(box, bounds(e))).map(e => e.id);
        s.selected = expandToGroups(s.elements, new Set([...d.base, ...inside]), s.editingGroup);
        // a group is only picked when all its members are inside
        s.selected = new Set([...s.selected].filter(id => { const e = s.get(id)!; if (d.base.has(id)) return true; const gid = outerGroup(e, s.editingGroup); return !gid || s.live().filter(o => o.groupIds.includes(gid)).every(o => boxContains(box, bounds(o))); }));
        s.notify(); return;
      }
      case "erase": this.eraseAt(x, y); return;
    }
  }

  pointerUp(ev: PointerEvent) {
    if (this.pinch.pointer(ev, "end")) return;
    const d = this.drag; this.drag = null;
    const s = this.s; if (!d) return;
    const [x, y] = this.toScene(ev.clientX, ev.clientY);
    switch (d.kind) {
      case "pan": return;
      case "create": {
        const e = s.get(d.id)!;
        if (Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) < DRAG_THRESHOLD) { // a click without a drag makes a default-size shape
          const size = 100; this.patchPreview(d.id, { x: e.x - size / 2, y: e.y - size / 2, width: size, height: size });
        }
        return this.finishCreate(d.id, d.before);
      }
      case "linear": {
        if (!d.moved) { this.multi = d.id; s.notify(); return; } // click-click mode
        return this.finishLinear(d.id, d.before);
      }
      case "freedraw": {
        const e = s.get(d.id) as FreedrawElement;
        if (e.points.length === 1) this.patchPreview(d.id, { points: [[0, 0], [0.5, 0.5]] } as any);
        return this.finishCreate(d.id, d.before);
      }
      case "move": {
        if (!d.moved && !(d.before.elements.length !== s.elements.length)) { s.preview(d.before.elements); s.notify(); return; }
        const ids = new Set(d.originals.keys());
        // an arrow dragged on its own lets go of the shapes it was attached to
        const next = s.elements.map(e => (ids.has(e.id) && isLinear(e) ? unbindUnmoved(e, ids) : e)).map(e => (ids.has(e.id) ? bump(e, {}, s.now()) : e));
        return s.commit(next, d.before);
      }
      case "resize": case "rotate": {
        const ids = new Set(d.originals.keys());
        return s.commit(s.elements.map(e => (ids.has(e.id) ? bump(e, {}, s.now()) : e)), d.before);
      }
      case "point": {
        let e = s.get(d.id) as LinearElement; s.bindHint = null;
        if (e.type === "arrow" && (d.index === 0 || d.index === e.points.length - 1)) e = this.bindEnd(e, d.index === 0 ? "start" : "end", x, y);
        return s.commit(s.elements.map(o => (o.id === e.id ? bump(e, {}, s.now()) : o)), d.before);
      }
      case "box": s.selectionBox = null; s.notify(); return;
      case "erase": {
        const ids = expandToGroups(s.elements, s.eraserMarked, null); s.eraserMarked = new Set();
        if (ids.size) this.deleteIds(ids); else s.notify();
        return;
      }
    }
  }
  pointerCancel(ev: PointerEvent) { if (!this.pinch.pointer(ev, "end")) this.cancelDrag(); }
  cancelDrag() {
    const d = this.drag; this.drag = null; const s = this.s;
    if (d && "before" in d) { s.elements = d.before.elements; }
    s.selectionBox = null; s.eraserMarked = new Set(); s.bindHint = null; s.notify();
  }
  wheel(ev: WheelEvent) {
    ev.preventDefault();
    if (this.pinch.navigating) return;
    const s = this.s;
    if (ev.ctrlKey || ev.metaKey) {
      this.zoomAt(wheelZoom(s.view.zoom, ev.deltaY), ev.clientX - this.rect.left, ev.clientY - this.rect.top); return;
    }
    const dx = ev.shiftKey && !ev.deltaX ? ev.deltaY : ev.deltaX, dy = ev.shiftKey && !ev.deltaX ? 0 : ev.deltaY;
    s.setView({ scrollX: s.view.scrollX - dx / s.view.zoom, scrollY: s.view.scrollY - dy / s.view.zoom });
  }

  // ---------- creating ----------
  private patchPreview(id: string, patch: Partial<Element>) { this.s.preview(this.s.elements.map(e => (e.id === id ? ({ ...e, ...patch } as Element) : e))); }
  private finishCreate(id: string, before: Snap) {
    const s = this.s;
    s.commit(s.elements, before);
    // freehand drawing stays on the Draw tool, like the lock; other tools go back to Selection
    if (!s.toolLocked && s.tool !== "freedraw") { s.tool = "selection"; s.select([id], false); } else s.notify();
  }
  private updateLinearEnd(id: string, x: number, y: number, shift: boolean) {
    const s = this.s; const e = s.get(id) as LinearElement; if (!e) return;
    const g = this.gridOn(); const pts = e.points.map(p => [...p] as Point);
    const prev = pts[pts.length - 2];
    let nx = snap(x, g) - e.x, ny = snap(y, g) - e.y;
    if (shift) { // lock to 15° steps
      const a = Math.round(Math.atan2(ny - prev[1], nx - prev[0]) / (Math.PI / 12)) * (Math.PI / 12); const len = Math.hypot(nx - prev[0], ny - prev[1]);
      nx = prev[0] + len * Math.cos(a); ny = prev[1] + len * Math.sin(a);
    }
    pts[pts.length - 1] = [nx, ny];
    s.bindHint = e.type === "arrow" ? bindTarget(s.live(), x, y, this.tol(), new Set([id]))?.id ?? null : null;
    this.patchPreview(id, normalizeLinear({ ...e, points: pts }));
  }
  private addMultiPoint(x: number, y: number, dbl: boolean) {
    const e = this.s.get(this.multi!) as LinearElement;
    const last = e.points[e.points.length - 2];
    const close = Math.hypot(e.x + last[0] - x, e.y + last[1] - y) < LINE_CONFIRM / this.s.view.zoom;
    if (dbl || close) return this.finishMulti();
    this.patchPreview(e.id, { points: [...e.points, e.points[e.points.length - 1]] } as any);
  }
  finishMulti() {
    const s = this.s; const id = this.multi; if (!id) return; this.multi = null;
    const e = s.get(id) as LinearElement;
    // drop the point that follows the pointer
    const pts = e.points.slice(0, -1);
    if (pts.length < 2) { s.elements = s.elements.filter(o => o.id !== id); s.bindHint = null; s.notify(); return; }
    this.patchPreview(id, normalizeLinear({ ...e, points: pts }));
    const before = { ...s.snap(), elements: s.elements.filter(o => o.id !== id) };
    this.finishLinear(id, before);
  }
  private finishLinear(id: string, before: Snap) {
    const s = this.s; let e = s.get(id) as LinearElement; s.bindHint = null;
    if (e.type === "arrow") {
      const n = e.points.length;
      e = this.bindEnd(e, "start", e.x + e.points[0][0], e.y + e.points[0][1]);
      e = this.bindEnd(e, "end", e.x + e.points[n - 1][0], e.y + e.points[n - 1][1]);
    }
    s.elements = s.elements.map(o => (o.id === id ? e : o));
    this.finishCreate(id, before);
  }
  /** Attach an arrow end to the shape under it (or let go if there is none) and snap it to the outline. */
  private bindEnd(e: LinearElement, end: "start" | "end", x: number, y: number): LinearElement {
    const s = this.s;
    const target = bindTarget(s.live(), x, y, this.tol(), new Set([e.id]));
    const key = end === "start" ? "startBinding" : "endBinding";
    const other = end === "start" ? e.endBinding : e.startBinding;
    if (!target || other?.elementId === target.id && e.points.length === 2) return { ...e, [key]: null };
    const bound = { ...e, [key]: { elementId: target.id, fixedPoint: fixedPointOf(target, x, y), mode: "orbit" as const } };
    return placeBoundEnds(bound, new Map(s.elements.map(o => [o.id, o] as const)));
  }
  createText(x: number, y: number) {
    const s = this.s;
    const e = newElement("text", x, y, s.style, s.now(), { lineHeight: LINE_HEIGHT(s.style.fontFamily) } as any) as TextElement;
    const h = e.fontSize * e.lineHeight;
    const placed = { ...e, y: y - h / 2, height: h, width: 1 };
    s.selected.clear(); s.preview([...s.elements, placed]);
    this.hooks.openText(placed.id);
  }
  /** Called by the text box when editing ends. Empty text removes the element. */
  finishText(id: string, text: string, before: Snap) {
    const s = this.s; const e = s.get(id) as TextElement; s.editingText = null;
    if (!e) return s.notify();
    const clean = text.replace(/\r\n?/g, "\n");
    if (!clean.trim()) {
      const existed = before.elements.some(o => o.id === id && !o.isDeleted);
      if (!existed) { s.elements = s.elements.filter(o => o.id !== id); s.notify(); return; }
      return s.commit(s.elements.map(o => (o.id === id ? bump(o, { isDeleted: true }, s.now()) : o)), before);
    }
    const m = measureText(clean, e.fontSize, e.fontFamily, e.lineHeight);
    // keep the anchor edge in place for centre/right aligned text
    const dx = e.textAlign === "center" ? (e.width - m.width) / 2 : e.textAlign === "right" ? e.width - m.width : 0;
    const was = before.elements.find(o => o.id === id) as TextElement | undefined;
    const fixed = was && !was.isDeleted ? { x: e.x + (e.width > 1 ? dx : 0) } : {};
    s.commit(s.elements.map(o => (o.id === id ? bump(e, { text: clean, originalText: clean, width: m.width, height: m.height, ...fixed }, s.now()) : o)), before);
    if (!s.toolLocked) s.tool = "selection";
    s.select([id], false);
  }

  // ---------- resize ----------
  private resizeTo(d: Extract<Drag, { kind: "resize" }>, px: number, py: number, shift: boolean) {
    const s = this.s; const h = d.handle; const g = this.gridOn();
    const { x1, y1, x2, y2 } = d.box; const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    // move the grabbed edges by how far the pointer moved (in the element's own frame)
    const [lx, ly] = d.angle ? rotate(px, py, cx, cy, -d.angle) : [px, py];
    const [l0x, l0y] = d.angle ? rotate(d.sx, d.sy, cx, cy, -d.angle) : [d.sx, d.sy];
    const ddx = lx - l0x, ddy = ly - l0y;
    const sn = (v: number) => (d.angle ? v : snap(v, g));
    let nx1 = x1, ny1 = y1, nx2 = x2, ny2 = y2;
    if (h.includes("w")) nx1 = Math.min(sn(x1 + ddx), x2 - 1); if (h.includes("e")) nx2 = Math.max(sn(x2 + ddx), x1 + 1);
    if (h === "n" || h === "nw" || h === "ne") ny1 = Math.min(sn(y1 + ddy), y2 - 1);
    if (h === "s" || h === "sw" || h === "se") ny2 = Math.max(sn(y2 + ddy), y1 + 1);
    const single = d.originals.size === 1 ? [...d.originals.values()][0] : null;
    const keepRatio = shift || !single || single.type === "image" || single.type === "text";
    const w0 = x2 - x1 || 1, h0 = y2 - y1 || 1;
    if (keepRatio && h.length === 2) {
      const sc = Math.max((nx2 - nx1) / w0, (ny2 - ny1) / h0);
      if (h.includes("w")) nx1 = x2 - w0 * sc; else nx2 = x1 + w0 * sc;
      if (h.includes("n")) ny1 = y2 - h0 * sc; else ny2 = y1 + h0 * sc;
    } else if (keepRatio && !single) {
      // edge handles on a multi-selection scale both ways around the opposite edge's middle
      const sc = h === "e" || h === "w" ? (nx2 - nx1) / w0 : (ny2 - ny1) / h0;
      if (h === "e" || h === "w") { const nh = h0 * sc; ny1 = cy - nh / 2; ny2 = cy + nh / 2; } else { const nw = w0 * sc; nx1 = cx - nw / 2; nx2 = cx + nw / 2; }
    }
    const sx = (nx2 - nx1) / w0, sy = (ny2 - ny1) / h0;
    // the new box centre, back in world space for a rotated single element
    const [ncx, ncy] = d.angle ? rotate((nx1 + nx2) / 2, (ny1 + ny2) / 2, cx, cy, d.angle) : [(nx1 + nx2) / 2, (ny1 + ny2) / 2];
    const next = s.elements.map(e => {
      const o = d.originals.get(e.id); if (!o) return e;
      if (single) return scaleElement(o, ncx - (o.width * sx) / 2, ncy - (o.height * sy) / 2, sx, sy, (ncx - (nx2 - nx1) / 2), (ncy - (ny2 - ny1) / 2));
      // multi: scale each element's box about the fixed origin of the selection box
      const ob = localBox(o);
      const nX = nx1 + (ob.x1 - x1) * sx, nY = ny1 + (ob.y1 - y1) * sy;
      return scaleElement(o, nX, nY, sx, sy, nX, nY);
    });
    s.preview(this.withBindings(next, new Set(d.originals.keys())));
  }
  /** Bound arrows follow shapes that moved. */
  private withBindings(els: Element[], changed: Set<string>) { return updateBoundArrows(els, changed, this.s.now()); }

  // ---------- erasing / deleting ----------
  private eraseAt(x: number, y: number) {
    const hit = this.hitAt(x, y);
    if (hit && !this.s.eraserMarked.has(hit.id)) { for (const id of expandToGroups(this.s.elements, new Set([hit.id]), null)) this.s.eraserMarked.add(id); this.s.redraw(); }
  }
  deleteIds(ids: Set<string>) {
    const s = this.s; if (!ids.size) return;
    // bound text labels go with their container
    for (const e of s.elements) if (isText(e) && e.containerId && ids.has(e.containerId)) ids.add(e.id);
    s.commit(s.elements.map(e => (ids.has(e.id) && !e.isDeleted ? bump(e, { isDeleted: true }, s.now()) : e)));
    s.selected.clear(); s.editingGroup = null; s.notify();
  }

  // ---------- commands ----------
  selectAll() { const s = this.s; s.editingGroup = null; s.select(s.live().filter(e => !e.locked).map(e => e.id)); }
  duplicateSelection(offset = 10) {
    const s = this.s; const sel = sortByIndex(s.selectedElements()); if (!sel.length) return;
    const gm = new Map<string, string>(); const copies = sel.map(e => duplicate(e, offset, offset, s.now(), gm));
    s.commit([...s.elements, ...copies]); s.select(copies.map(c => c.id), false);
  }
  groupSelection() { const s = this.s; if (s.selected.size < 2) return; const r = group(s.elements, s.selected, s.now()); s.commit(r.elements); s.select(s.selected, false); }
  ungroupSelection() { const s = this.s; if (!s.selected.size) return; s.commit(ungroup(s.elements, s.selected, s.editingGroup, s.now())); }
  zorder(dir: "forward" | "backward" | "front" | "back") { const s = this.s; if (s.selected.size) s.commit(reorder(s.elements, s.selected, dir, s.now())); }
  alignSel(how: Parameters<typeof align>[2]) { const s = this.s; if (s.selected.size > 1) s.commit(this.withBindings(align(s.elements, s.selected, how, s.now()), s.selected)); }
  distributeSel(axis: "x" | "y") { const s = this.s; if (s.selected.size > 2) s.commit(this.withBindings(distribute(s.elements, s.selected, axis, s.now()), s.selected)); }
  flipSel(axis: "h" | "v") { const s = this.s; if (s.selected.size) s.commit(this.withBindings(flip(s.elements, s.selected, axis, s.now()), s.selected)); }
  nudge(dx: number, dy: number) {
    const s = this.s; if (!s.selected.size) return;
    const moved = s.elements.map(e => (s.selected.has(e.id) && !e.locked ? bump(e, { x: e.x + dx, y: e.y + dy }, s.now()) : e));
    s.commit(this.withBindings(moved, s.selected));
  }
  toggleLock() {
    const s = this.s; const sel = s.selectedElements(); if (!sel.length) return;
    const lock = !sel.every(e => e.locked);
    s.commit(s.elements.map(e => (s.selected.has(e.id) ? bump(e, { locked: lock }, s.now()) : e)));
    if (lock) { s.selected.clear(); s.notify(); }
  }
  unlockAll() { const s = this.s; if (s.live().some(e => e.locked)) s.commit(s.elements.map(e => (e.locked && !e.isDeleted ? bump(e, { locked: false }, s.now()) : e))); }
  copyStyles() {
    const e = this.s.selectedElements()[0]; if (!e) return;
    const { strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle, roughness, opacity, roundness } = e;
    this.copiedStyle = { strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle, roughness, opacity, roundness, ...(isText(e) ? { fontSize: e.fontSize, fontFamily: e.fontFamily, textAlign: e.textAlign } : {}), ...(isLinear(e) ? { startArrowhead: e.startArrowhead, endArrowhead: e.endArrowhead } : {}) } as any;
    this.hooks.onToast("Styles copied");
  }
  pasteStyles() {
    const s = this.s; const st = this.copiedStyle; if (!st || !s.selected.size) return;
    s.commit(s.elements.map(e => {
      if (!s.selected.has(e.id)) return e;
      const p: any = { ...st };
      if (!isText(e)) { delete p.fontSize; delete p.fontFamily; delete p.textAlign; }
      if (e.type !== "arrow") { delete p.startArrowhead; delete p.endArrowhead; }
      if (isText(e) || e.type === "ellipse" || isFreedraw(e)) delete p.roundness;
      let next = bump(e, p, s.now());
      if (isText(next)) { const m = measureText(next.text, next.fontSize, next.fontFamily, next.lineHeight); next = { ...next, width: m.width, height: m.height }; }
      return next;
    }));
  }
  /** Change style on the selection (and remember it for new elements). */
  applyStyle(patch: Partial<Style>) {
    const s = this.s; s.style = { ...s.style, ...patch };
    const sel = s.selectedElements(); if (!sel.length) { s.notify(); return; }
    s.commit(s.elements.map(e => s.selected.has(e.id) ? styled(e, patch, s.now()) : e));
  }

  // ---------- keyboard ----------
  keyDown(ev: KeyboardEvent): boolean {
    const s = this.s; const mod = ev.ctrlKey || ev.metaKey; const k = ev.key; const lower = k.toLowerCase();
    if (k === " " && !this.spacePan) { this.spacePan = true; s.notify(); return true; }
    if (k === "Escape") {
      if (this.multi) { this.finishMulti(); return true; }
      if (this.drag) { this.cancelDrag(); return true; }
      if (s.editingGroup) { s.editingGroup = null; s.selected.clear(); s.notify(); return true; }
      if (s.selected.size) { s.selected.clear(); s.notify(); return true; }
      if (s.tool !== "selection") { s.setTool("selection"); return true; }
      return false;
    }
    if (k === "Enter" && this.multi) { this.finishMulti(); return true; }
    // view (allowed when read-only)
    if (mod && (k === "=" || k === "+")) { this.zoomBy(0.1); return true; }
    if (mod && k === "-") { this.zoomBy(-0.1); return true; }
    if (mod && k === "0") { this.zoomAt(1, this.rect.width / 2, this.rect.height / 2); return true; }
    if (ev.shiftKey && ev.code === "Digit1" && !mod) { this.fit(s.live(), 1); return true; }
    if (ev.shiftKey && ev.code === "Digit2" && !mod) { this.fit(s.selected.size ? s.selectedElements() : s.live(), 1); return true; }
    if (ev.altKey && ev.shiftKey && ev.code === "KeyD") { this.hooks.command("toggle-theme"); return true; }
    if (mod && ev.shiftKey && lower === "e") { this.hooks.command("export"); return true; }
    if (k === "?" || (ev.shiftKey && ev.code === "Slash")) { this.hooks.command("help"); return true; }
    if (s.readOnly) { if (lower === "h") { s.setTool("hand"); return true; } return false; }
    if (mod && lower === "z") { ev.shiftKey ? s.redo() : s.undo(); return true; }
    if (mod && lower === "y") { s.redo(); return true; }
    if (mod && lower === "o") { this.hooks.command("open"); return true; }
    if (mod && lower === "s") { this.hooks.command("save"); return true; }
    if (mod && k === "'") { s.setAppState({ gridModeEnabled: !s.appState.gridModeEnabled }); return true; }
    if (mod && lower === "a") { this.selectAll(); return true; }
    if (mod && !ev.altKey && lower === "d") { this.duplicateSelection(); return true; }
    if (mod && lower === "g") { ev.shiftKey ? this.ungroupSelection() : this.groupSelection(); return true; }
    if (mod && ev.shiftKey && lower === "l") { this.toggleLock(); return true; }
    if (mod && ev.altKey && ev.code === "KeyC") { this.copyStyles(); return true; }
    if (mod && ev.altKey && ev.code === "KeyV") { this.pasteStyles(); return true; }
    if (mod && ev.code === "BracketRight") { this.zorder(ev.shiftKey || ev.altKey ? "front" : "forward"); return true; }
    if (mod && ev.code === "BracketLeft") { this.zorder(ev.shiftKey || ev.altKey ? "back" : "backward"); return true; }
    if (mod && ev.shiftKey && k.startsWith("Arrow")) { this.alignSel(({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "bottom" } as const)[k as "ArrowLeft"]); return true; }
    if (!mod && ev.shiftKey && ev.code === "KeyH") { this.flipSel("h"); return true; }
    if (!mod && ev.shiftKey && ev.code === "KeyV") { this.flipSel("v"); return true; }
    if (k === "Delete" || k === "Backspace") { if (s.selected.size) { this.deleteIds(new Set(s.selected)); return true; } return false; }
    if (k.startsWith("Arrow") && s.selected.size && !mod) {
      // Excalidraw's steps: 1 unit, Shift 5; with the grid on, the grid size, Shift 1
      const grid = this.gridOn();
      const step = grid ? (ev.shiftKey ? 1 : grid) : (ev.shiftKey ? 5 : 1);
      const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[k as "ArrowLeft"]!;
      this.nudge(dx, dy); return true;
    }
    if (k === "Enter" && s.selected.size === 1) { const e = s.selectedElements()[0]; if (isText(e)) { this.hooks.openText(e.id); return true; } }
    if (mod || ev.altKey) return false;
    const tools: Record<string, ToolType> = { h: "hand", v: "selection", "1": "selection", r: "rectangle", "2": "rectangle", d: "diamond", "3": "diamond", o: "ellipse", "4": "ellipse", a: "arrow", "5": "arrow", l: "line", "6": "line", p: "freedraw", x: "freedraw", "7": "freedraw", t: "text", "8": "text", "9": "image", e: "eraser", "0": "eraser" };
    if (!ev.shiftKey && tools[lower]) { const t = tools[lower]; if (t === "image") this.hooks.openImagePicker(); else s.setTool(t); return true; }
    if (!ev.shiftKey && lower === "q") { s.toolLocked = !s.toolLocked; s.notify(); return true; }
    return false;
  }
  keyUp(ev: KeyboardEvent) { if (ev.key === " ") { this.spacePan = false; this.s.notify(); } }
}

// ---------- helpers ----------
const normAngle = (a: number) => { const t = Math.PI * 2; return ((a % t) + t) % t; };
function sizeOf(pts: Point[]) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
/** Keep width/height in step with the points. */
export function normalizeLinear<T extends LinearElement>(e: T): T { return { ...e, ...sizeOf(e.points) }; }
function unbindUnmoved(e: LinearElement, moved: Set<string>): LinearElement {
  const s = e.startBinding && !moved.has(e.startBinding.elementId), t = e.endBinding && !moved.has(e.endBinding.elementId);
  return s || t ? { ...e, ...(s ? { startBinding: null } : {}), ...(t ? { endBinding: null } : {}) } : e;
}
/** Scale an element by (sx, sy) and put its box at (x, y). For point-based elements (ox, oy) is where the
 *  box's top-left corner goes. Text scales its font size instead of stretching. */
function scaleElement(o: Element, x: number, y: number, sx: number, sy: number, ox: number, oy: number): Element {
  if (hasPoints(o)) {
    const b = localBox(o); const minX = b.x1 - o.x, minY = b.y1 - o.y;
    const pts = o.points.map(([px, py]) => [(px - minX) * sx, (py - minY) * sy] as Point);
    const p0 = pts[0];
    const base = { ...o, x: ox + p0[0], y: oy + p0[1], points: pts.map(([px, py]) => [px - p0[0], py - p0[1]] as Point), ...sizeOf(pts) } as Element;
    return base;
  }
  if (isText(o)) {
    const sc = Math.max(Math.min(sx, sy), 0.05);
    const fontSize = Math.max(1, o.fontSize * sc);
    return { ...o, x, y, fontSize, width: o.width * sc, height: o.height * sc };
  }
  return { ...o, x, y, width: Math.max(1, o.width * sx), height: Math.max(1, o.height * sy) };
}
function styled(e: Element, patch: Partial<Style>, now: number): Element {
  const p: any = {};
  for (const k of ["strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness", "opacity"] as const) if (patch[k] !== undefined) p[k] = patch[k];
  if (patch.roundness !== undefined && (e.type === "rectangle" || e.type === "diamond" || isLinear(e) || e.type === "image")) p.roundness = patch.roundness === "round" ? { type: e.type === "rectangle" || e.type === "image" ? 3 : 2 } : null;
  if (e.type === "arrow") { if (patch.startArrowhead !== undefined) p.startArrowhead = patch.startArrowhead; if (patch.endArrowhead !== undefined) p.endArrowhead = patch.endArrowhead; }
  if (isText(e)) {
    if (patch.fontSize !== undefined) p.fontSize = patch.fontSize;
    if (patch.fontFamily !== undefined) { p.fontFamily = patch.fontFamily; p.lineHeight = LINE_HEIGHT(patch.fontFamily); }
    if (patch.textAlign !== undefined) p.textAlign = patch.textAlign;
    if (p.fontSize || p.fontFamily) { const m = measureText(e.text, p.fontSize ?? e.fontSize, p.fontFamily ?? e.fontFamily, p.lineHeight ?? e.lineHeight); p.width = m.width; p.height = m.height; }
  }
  if (!Object.keys(p).length) return e;
  return bump(e, p, now);
}
export { boxesIntersect, randomInteger };
