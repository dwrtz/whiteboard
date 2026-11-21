import type { Point } from "../shared/types";
import { clampZoom, type Store } from "./store";

type Contact = { id: number; x: number; y: number };
type Anchor = { zoom: number; scene: Point };
type Pair = { ids: [number, number]; anchor: Anchor; span: number; lastSpan: number; center: Point };
type Scale = {
  anchor: Anchor; base: number; last: number; center: Point; needsCenter: boolean;
  spanRevision: number; measuredZoom?: number;
};
type ScaleEvent = Event & { scale?: number; clientX?: number; clientY?: number };
type ContactSource = "touch" | "pointer";
const samePoint = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
const validScale = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v) && v > 0;
const pageTarget = (target: EventTarget | null) => target === window || target === document || target === document.body || target === document.documentElement;

/** A WebKit embedding may start several input streams, then continue sending movement on just one.
 * Contact identifiers belong to their own stream. The camera follows the measured finger span. */
export class CanvasPinch {
  private pointers = new Map<number, Contact>();
  private receivedPointerDown = false;
  private touchIds = new Set<number>();
  private pairs: Partial<Record<ContactSource, Pair>> = {};
  private active = false;
  private center?: Point;
  private gesture?: Scale;
  private touchScale?: Scale;
  private spanRevision = 0;

  constructor(private store: Store, private rect: () => DOMRect, private cancelTool: () => void) {}

  get navigating() { return this.active; }

  private begin() {
    if (!this.active) this.cancelTool();
    this.active = true;
  }

  private reset() {
    this.pointers.clear(); this.receivedPointerDown = false; this.touchIds.clear(); this.pairs = {};
    this.active = false; this.center = undefined; this.gesture = undefined; this.touchScale = undefined;
    this.spanRevision = 0;
  }

  private anchor([x, y]: Point): Anchor {
    const rect = this.rect(), { zoom, scrollX, scrollY } = this.store.view;
    return { zoom, scene: [(x - rect.left) / zoom - scrollX, (y - rect.top) / zoom - scrollY] };
  }

  private update(anchor: Anchor, [x, y]: Point, magnification: number) {
    const rect = this.rect(), zoom = clampZoom(magnification);
    const scrollX = (x - rect.left) / zoom - anchor.scene[0], scrollY = (y - rect.top) / zoom - anchor.scene[1];
    const old = this.store.view;
    if (zoom !== old.zoom || scrollX !== old.scrollX || scrollY !== old.scrollY) this.store.setView({ zoom, scrollX, scrollY });
  }

  private contacts(source: ContactSource, points: Contact[]) {
    if (points.length < 2) { delete this.pairs[source]; return; }
    this.begin();
    const pair = this.pairs[source];
    const a = points.find(p => p.id === pair?.ids[0]) ?? points[0];
    const b = points.find(p => p.id === pair?.ids[1] && p.id !== a.id) ?? points.find(p => p.id !== a.id)!;
    const mid: Point = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    const span = Math.hypot(a.x - b.x, a.y - b.y);
    if (this.gesture?.needsCenter) {
      this.gesture.anchor = this.anchor(mid); this.gesture.center = mid; this.gesture.needsCenter = false;
    }
    if (!pair || pair.ids[0] !== a.id || pair.ids[1] !== b.id || pair.span < 1) {
      this.pairs[source] = { ids: [a.id, b.id], anchor: this.anchor(mid), span, lastSpan: span, center: mid };
      this.center = mid;
      if (source === "touch") this.touchScale = undefined;
      return;
    }
    const resized = span !== pair.lastSpan;
    if (!resized && samePoint(mid, pair.center)) return;
    if (resized) this.spanRevision++;
    this.update(pair.anchor, mid, resized ? pair.anchor.zoom * span / pair.span : this.store.view.zoom);
    pair.lastSpan = span; pair.center = mid; this.center = mid;
  }

  private startScale(value: number, center: Point, needsCenter = false): Scale {
    return { anchor: this.anchor(center), base: value, last: value, center, needsCenter, spanRevision: this.spanRevision };
  }

  private scale(g: Scale, value: number, center: Point, hasCenter: boolean) {
    if (g.needsCenter && hasCenter) {
      g.anchor = this.anchor(center); g.needsCenter = false;
    }
    if (g.spanRevision !== this.spanRevision) {
      // Finger coordinates moved since this stream's last report. Their measured zoom wins,
      // even when the corresponding scale event arrives a frame later.
      g.measuredZoom = this.store.view.zoom;
      g.anchor.scene = this.anchor(this.center ?? center).scene;
      g.spanRevision = this.spanRevision;
    } else if (value !== g.last) {
      const previous = g.anchor.zoom * g.last / g.base;
      const next = g.anchor.zoom * value / g.base;
      const target = g.measuredZoom;
      const catchingUp = target !== undefined && next > Math.min(previous, target) && next < Math.max(previous, target);
      if (!catchingUp) {
        // If the scale reverses before catching up, continue from the zoom already on screen.
        if (target !== undefined && (next - previous) * (target - previous) < 0) {
          g.anchor = this.anchor(g.center); g.base = g.last;
        }
        this.update(g.anchor, center, g.anchor.zoom * value / g.base);
        g.measuredZoom = undefined;
      }
    } else if (!samePoint(center, g.center)) {
      this.update(g.anchor, center, this.store.view.zoom);
    }
    g.last = value; g.center = center;
  }

  pointer(ev: PointerEvent, phase: "down" | "move" | "end"): boolean {
    // A fresh primary down also recovers when an embedding omitted the old sequence's final events.
    if (phase === "down" && ev.pointerType === "touch" && ev.isPrimary && this.receivedPointerDown) this.reset();
    const wasActive = this.active;
    if (ev.pointerType === "touch") {
      if (phase === "end") this.pointers.delete(ev.pointerId);
      else if (phase === "down" || this.pointers.has(ev.pointerId)) {
        if (phase === "down") this.receivedPointerDown = true;
        this.pointers.set(ev.pointerId, { id: ev.pointerId, x: ev.clientX, y: ev.clientY });
      }
      this.contacts("pointer", [...this.pointers.values()]);
      if (!this.pointers.size && !this.touchIds.size && !this.gesture) this.reset();
    }
    return wasActive || this.active;
  }

  bind(canvas: HTMLCanvasElement) {
    const touch = (ev: TouchEvent & { scale?: number }) => {
      const touches = Array.from(ev.touches ?? ev.targetTouches);
      // touches includes our two fingers even if their target lists differ or the event is
      // retargeted to the document. A touch that began on a toolbar or text field stays there.
      const onCanvas = (t: Touch) => {
        const target = t.target ?? ev.target;
        return this.touchIds.has(t.identifier) || target === canvas ||
          (ev.type === "touchstart" && pageTarget(target) && document.elementFromPoint(t.clientX, t.clientY) === canvas);
      };
      const points = touches.filter(onCanvas).map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
      if (!points.length && !this.touchIds.size) return;
      if (ev.cancelable && (ev.target === canvas || pageTarget(ev.target))) ev.preventDefault();
      this.touchIds = new Set(points.map(p => p.id));
      this.contacts("touch", points);
      if (!points.length && !this.gesture && (ev.type !== "touchcancel" || !this.pointers.size)) this.reset();
      if (points.length >= 2 && this.center) {
        // iOS also exposes magnification directly on TouchEvent when coordinates stay stationary.
        this.touchScale ??= this.startScale(validScale(ev.scale) ? ev.scale : 1, this.center);
        if (validScale(ev.scale)) this.scale(this.touchScale, ev.scale, this.center, true);
      } else this.touchScale = undefined;
    };
    const webkit = (event: Event) => {
      const e = event as ScaleEvent;
      if (!this.gesture && event.target !== canvas) {
        const overCanvas = () => document.elementFromPoint(e.clientX ?? -1, e.clientY ?? -1) === canvas;
        if (!pageTarget(event.target) || !(this.active || this.touchIds.size || this.pointers.size || overCanvas())) return;
      }
      if (event.cancelable) event.preventDefault();
      if (event.type === "gestureend") {
        this.gesture = undefined;
        if (!this.touchIds.size) this.reset();
        return;
      }
      const hasPosition = Number.isFinite(e.clientX) && Number.isFinite(e.clientY) && !!(e.clientX || e.clientY);
      const rect = this.rect();
      const center: Point = hasPosition ? [e.clientX!, e.clientY!] : this.center ?? [rect.left + rect.width / 2, rect.top + rect.height / 2];
      if (event.type === "gesturestart") {
        this.begin();
        this.gesture = this.startScale(validScale(e.scale) ? e.scale : 1, center, !hasPosition && !this.center);
      } else if (this.gesture && validScale(e.scale)) {
        this.scale(this.gesture, e.scale, center, hasPosition || !!this.center);
      }
    };
    const outsidePointer = (e: PointerEvent) => {
      if (e.target !== canvas && this.pointers.has(e.pointerId)) this.pointer(e, e.type === "pointermove" ? "move" : "end");
    };
    const touchEvents = ["touchstart", "touchmove", "touchend", "touchcancel"] as const;
    const gestureEvents = ["gesturestart", "gesturechange", "gestureend"] as const;
    const pointerEvents = ["pointermove", "pointerup", "pointercancel"] as const;
    for (const type of touchEvents) window.addEventListener(type, touch, { capture: true, passive: false });
    for (const type of gestureEvents) window.addEventListener(type, webkit, { capture: true, passive: false });
    for (const type of pointerEvents) window.addEventListener(type, outsidePointer, true);
    return () => {
      for (const type of touchEvents) window.removeEventListener(type, touch, true);
      for (const type of gestureEvents) window.removeEventListener(type, webkit, true);
      for (const type of pointerEvents) window.removeEventListener(type, outsidePointer, true);
      this.reset();
    };
  }
}
