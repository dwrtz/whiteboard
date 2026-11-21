import React, { useEffect, useMemo, useRef, useState } from "react";
import { newElement } from "../shared/elements";
import type { LibraryItem } from "../shared/types";
import { Editor } from "./Editor";
import { Store } from "./store";

type Position = Pick<Touch, "clientX" | "clientY" | "screenX" | "screenY">;
type Range = { first: number; min: number; max: number; last: number };
const round = (v: number) => Math.round(v * 1000) / 1000;

/** Only runs on the scratch canvas. Keep separations, scales and event counts in this tab. */
function recordPinch(store: Store) {
  const pointers = new Map<number, PointerEvent>();
  let counts: Record<string, number> = {}, ranges: Record<string, Range> = {};
  let targets = new Set<string>(), initialZoom = store.view.zoom, recording = false;
  let touchCount = 0, gesture = false;
  function sample(key: string, value: number) {
    if (!Number.isFinite(value)) return;
    const n = round(value), r = ranges[key] ??= { first: n, min: n, max: n, last: n };
    r.min = Math.min(r.min, n); r.max = Math.max(r.max, n); r.last = n;
  }
  function span(source: string, [a, b]: Position[]) {
    if (!a || !b) return;
    sample(source, Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY));
    sample(source + "Screen", Math.hypot(b.screenX - a.screenX, b.screenY - a.screenY));
  }
  function observe(e: Event) {
    if (e.target instanceof Element && e.target.closest("[data-pinch-result]")) return;
    const pointer = e instanceof PointerEvent ? e : undefined;
    if (pointer && pointer.pointerType !== "touch") return;
    const touch = "touches" in e ? e as TouchEvent : undefined;
    const beginning = e.type === "touchstart" || e.type === "pointerdown" || e.type === "gesturestart";
    if (beginning && !recording) {
      counts = {}; ranges = {}; targets = new Set(); initialZoom = store.view.zoom; recording = true;
      sample("canvas", 1);
    }
    if (!recording) return;
    counts[e.type] = (counts[e.type] ?? 0) + 1;
    if (beginning && e.target instanceof Element) {
      targets.add(e.target.matches("canvas") ? "canvas" : e.target.closest("button") ? "control" : "page");
    }
    if (pointer) {
      if (e.type === "pointerup" || e.type === "pointercancel") pointers.delete(pointer.pointerId);
      else pointers.set(pointer.pointerId, pointer);
      span("pointers", [...pointers.values()]);
    }
    if (touch) { touchCount = touch.touches.length; span("touches", Array.from(touch.touches)); }
    if (e.type === "gesturestart") gesture = true;
    if (e.type === "gestureend") gesture = false;
    const scale = (e as Event & { scale?: number }).scale;
    if (scale !== undefined && (e.type === "gesturechange" || e.type === "touchmove")) {
      sample(touch ? "touchScale" : "gestureScale", scale);
    }
    sample("canvas", store.view.zoom / initialZoom);
    if (!touchCount && !pointers.size && !gesture) recording = false;
  }
  const types = ["pointerdown", "pointermove", "pointerup", "pointercancel", "touchstart", "touchmove", "touchend", "touchcancel", "gesturestart", "gesturechange", "gestureend"];
  for (const type of types) window.addEventListener(type, observe, { capture: true, passive: true });
  const off = store.onRender(() => { if (recording) sample("canvas", store.view.zoom / initialZoom); });
  return {
    result: () => JSON.stringify({ test: "inward-1", targets: [...targets], events: counts, ranges }),
    stop: () => { off(); for (const type of types) window.removeEventListener(type, observe, true); },
  };
}

export default function PinchCheck() {
  const store = useMemo(() => {
    const s = new Store();
    const squares = [1600, 800, 320].map(size => newElement("rectangle", -size / 2, -size / 2, s.style, 0, {
      width: size, height: size, strokeColor: "#364fc7", strokeWidth: 7, roughness: 0,
    }));
    s.load(squares, { ...s.appState, gridModeEnabled: true }, {});
    return s;
  }, []);
  const library = useMemo(() => {
    let items: LibraryItem[] = [];
    return { where: "In this test tab.", load: async () => items, save: async (next: LibraryItem[]) => { items = next; } };
  }, []);
  const trace = useRef<ReturnType<typeof recordPinch>>();
  useEffect(() => { trace.current = recordPinch(store); return () => trace.current?.stop(); }, [store]);
  const [fallback, setFallback] = useState(""), [copied, setCopied] = useState(false);
  async function copy() {
    const result = trace.current?.result();
    if (!result) return;
    try { await navigator.clipboard.writeText(result); setCopied(true); }
    catch { setFallback(result); }
  }
  return <Editor store={store} mode="copy" name="Pinch test" library={library}
    banner={<span>Pinch inward once, then copy the result.</span>}
    topRight={<div data-pinch-result="">
      <button className="btn primary" onClick={copy}>{copied ? "Copied" : "Copy result"}</button>
      {fallback && <textarea aria-label="Pinch result" readOnly value={fallback} autoFocus onFocus={e => e.target.select()} />}
    </div>} />;
}
