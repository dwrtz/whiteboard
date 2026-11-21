import type { Point } from "../shared/types";
import { clampZoom, type Store } from "./store";

type Contact = { id: number; x: number; y: number };
type Anchor = { zoom: number; scene: Point };
type Pair = { ids: [number, number]; span: number; lastSpan: number; anchor: Anchor };
type ScaleEvent = Event & { scale: number; clientX?: number; clientY?: number };

/** Raw touch snapshots survive a mobile browser taking over the pointer stream.
 * WebKit can also report magnification as an absolute scale from gesturestart. */
export class CanvasPinch {
  private pointers = new Map<number, Contact>();
  private nativeTouches = false;
  private active = false;
  private pair?: Pair;
  private center?: Point;
  private gesture?: { anchor: Anchor; initialScale: number; lastScale: number; center: Point; needsCenter: boolean };

  constructor(private store: Store, private rect: () => DOMRect, private cancelTool: () => void) {}

  get navigating() { return this.active; }

  private begin() {
    if (!this.active) this.cancelTool();
    this.active = true;
  }

  private reset() {
    this.pointers.clear(); this.nativeTouches = false; this.active = false;
    this.pair = undefined; this.center = undefined; this.gesture = undefined;
  }

  private anchor([x, y]: Point): Anchor {
    const rect = this.rect(), { zoom, scrollX, scrollY } = this.store.view;
    return { zoom, scene: [(x - rect.left) / zoom - scrollX, (y - rect.top) / zoom - scrollY] };
  }

  private update(anchor: Anchor, [x, y]: Point, ratio: number) {
    const rect = this.rect(), zoom = clampZoom(anchor.zoom * ratio);
    const scrollX = (x - rect.left) / zoom - anchor.scene[0], scrollY = (y - rect.top) / zoom - anchor.scene[1];
    const old = this.store.view;
    if (zoom !== old.zoom || scrollX !== old.scrollX || scrollY !== old.scrollY) this.store.setView({ zoom, scrollX, scrollY });
  }

  private contacts(points: Contact[]) {
    if (points.length < 2) { this.pair = undefined; return; }
    this.begin();
    // Keep the same pair if a third finger lands. Rebase when a tracked finger is replaced.
    const a = points.find(p => p.id === this.pair?.ids[0]) ?? points[0];
    const b = points.find(p => p.id === this.pair?.ids[1] && p.id !== a.id) ?? points.find(p => p.id !== a.id)!;
    const mid: Point = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    const span = Math.hypot(a.x - b.x, a.y - b.y);
    if (this.gesture?.needsCenter) {
      this.gesture.anchor = this.anchor(mid); this.gesture.center = mid; this.gesture.needsCenter = false;
    }
    if (!this.pair || this.pair.ids[0] !== a.id || this.pair.ids[1] !== b.id || this.pair.span < 1) {
      this.pair = { ids: [a.id, b.id], span, lastSpan: span, anchor: this.anchor(mid) };
    } else if (this.pair.lastSpan !== span || this.center?.[0] !== mid[0] || this.center?.[1] !== mid[1]) {
      const ratio = span !== this.pair.lastSpan ? span / this.pair.span : this.store.view.zoom / this.pair.anchor.zoom;
      this.update(this.pair.anchor, mid, ratio);
      this.pair.lastSpan = span;
    }
    this.center = mid;
  }

  /** Pointer-only devices use the same transform. A native touch sequence owns both axes once it starts. */
  pointer(ev: PointerEvent, phase: "down" | "move" | "end"): boolean {
    const wasActive = this.active;
    if (ev.pointerType === "touch") {
      if (phase === "end") this.pointers.delete(ev.pointerId);
      else if (phase === "down" || this.pointers.has(ev.pointerId)) {
        this.pointers.set(ev.pointerId, { id: ev.pointerId, x: ev.clientX, y: ev.clientY });
      }
      if (!this.nativeTouches && !this.gesture) {
        this.contacts([...this.pointers.values()]);
        if (!this.pointers.size) { this.active = false; this.center = undefined; }
      }
    }
    return wasActive || this.active;
  }

  bind(canvas: HTMLCanvasElement) {
    const touch = (ev: TouchEvent) => {
      const points = Array.from(ev.targetTouches, t => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
      if (!this.nativeTouches && points.length < 2) return;
      if (ev.cancelable) ev.preventDefault();
      if (!this.nativeTouches) this.pair = undefined;
      this.nativeTouches = points.length > 0;
      this.contacts(points);
      if (!points.length) {
        this.pointers.clear();
        if (!this.gesture) { this.active = false; this.center = undefined; }
      }
    };
    const webkit = (event: Event) => {
      const e = event as ScaleEvent;
      if (!this.gesture && event.target !== canvas) {
        // An embedded WebKit view may target the page after a gesture starts on the canvas.
        const pageTarget = event.target === window || event.target === document || event.target === document.body || event.target === document.documentElement;
        if (!pageTarget || !(this.active || this.pointers.size || document.elementFromPoint(e.clientX ?? -1, e.clientY ?? -1) === canvas)) return;
      }
      if (event.cancelable) event.preventDefault();
      if (event.type === "gestureend") {
        // WebKit may end its gesture without delivering the corresponding pointerup events.
        this.reset();
        return;
      }
      const r = this.rect();
      const hasPosition = Number.isFinite(e.clientX) && Number.isFinite(e.clientY) && !!(e.clientX || e.clientY);
      const position: Point = hasPosition ? [e.clientX!, e.clientY!] : this.center ?? [r.left + r.width / 2, r.top + r.height / 2];
      if (event.type === "gesturestart") {
        this.begin();
        const initialScale = Number.isFinite(e.scale) && e.scale > 0 ? e.scale : 1;
        this.gesture = { anchor: this.anchor(position), initialScale, lastScale: initialScale, center: position, needsCenter: !hasPosition && !this.center };
      } else if (this.gesture && Number.isFinite(e.scale) && e.scale > 0) {
        const g = this.gesture;
        if (g.needsCenter && hasPosition) {
          g.anchor = this.anchor(position); g.center = position; g.needsCenter = false;
        }
        // A browser may deliver both streams. Ignore duplicates and use absolute magnification.
        if (g.lastScale === e.scale && g.center[0] === position[0] && g.center[1] === position[1]) return;
        const ratio = g.lastScale !== e.scale ? e.scale / g.initialScale : this.store.view.zoom / g.anchor.zoom;
        this.update(g.anchor, position, ratio);
        g.lastScale = e.scale; g.center = position;
      }
    };
    const touchEvents = ["touchstart", "touchmove", "touchend", "touchcancel"] as const;
    const gestureEvents = ["gesturestart", "gesturechange", "gestureend"] as const;
    for (const type of touchEvents) canvas.addEventListener(type, touch, { passive: false });
    for (const type of gestureEvents) window.addEventListener(type, webkit, { capture: true, passive: false });
    return () => {
      for (const type of touchEvents) canvas.removeEventListener(type, touch);
      for (const type of gestureEvents) window.removeEventListener(type, webkit, true);
      this.reset();
    };
  }
}
