import { describe, it, expect } from "vitest";
import { el, indexed } from "./helpers";
import { reconcile } from "../src/shared/reconcile";
import { reorder, align, distribute, group, ungroup, flip, expandToGroups } from "../src/shared/actions";
import { sortByIndex, syncIndices, duplicate } from "../src/shared/elements";
import { hitTest, bounds, edgePoint, commonBounds } from "../src/shared/geometry";
import { placeBoundEnds, updateBoundArrows, syncBoundElements, dropDeadBindings, bindTarget } from "../src/shared/binding";
import { History, applySnap } from "../src/shared/history";
import type { LinearElement } from "../src/shared/types";

describe("fractional indices", () => {
  it("gives every element a strictly increasing key and keeps array order", () => {
    const els = indexed([el("rectangle", 0, 0), el("ellipse", 0, 0), el("diamond", 0, 0)]);
    expect(els.map(e => e.index)).toEqual([...els.map(e => e.index)].sort());
    expect(new Set(els.map(e => e.index)).size).toBe(3);
  });
  it("repairs out-of-order keys without touching valid ones", () => {
    const [a, b, c] = indexed([el("rectangle", 0, 0), el("ellipse", 0, 0), el("diamond", 0, 0)]);
    const fixed = syncIndices([a, { ...c, index: a.index }, b]);
    expect(fixed[0].index).toBe(a.index);
    expect(fixed[1].index! > fixed[0].index! && fixed[1].index! < fixed[2].index!).toBe(true);
  });
  it("bumps the version of every element whose key changes, so peers get the new order", () => {
    const [a, b, c] = indexed([el("rectangle", 0, 0), el("ellipse", 0, 0), el("diamond", 0, 0)]);
    const fixed = syncIndices([a, { ...c, index: a.index }, b, { ...el("line", 0, 0), index: null }]);
    expect(fixed[0].version).toBe(a.version);
    expect(fixed[1].version).toBe(c.version + 1);
    expect(fixed[2].version).toBe(b.version);
    expect(typeof fixed[3].index).toBe("string");
  });
});

describe("reconcile", () => {
  it("keeps an element still being drawn (no key yet) on top instead of guessing a key", () => {
    const [a, b] = indexed([el("rectangle", 0, 0), el("ellipse", 0, 0)]);
    const drawing = { ...el("diamond", 0, 0), index: null };
    expect(reconcile([b, drawing], [a, b]).map(e => e.id)).toEqual([a.id, b.id, drawing.id]);
  });
  it("keeps the higher version and breaks ties with the lower versionNonce", () => {
    const [a] = indexed([el("rectangle", 0, 0)]);
    const local = { ...a, x: 1, version: 3, versionNonce: 50 };
    const remoteNewer = { ...a, x: 2, version: 4, versionNonce: 99 };
    expect(reconcile([local], [remoteNewer])[0].x).toBe(2);
    const tieLow = { ...a, x: 3, version: 3, versionNonce: 10 };
    expect(reconcile([local], [tieLow])[0].x).toBe(3);
    const tieHigh = { ...a, x: 4, version: 3, versionNonce: 90 };
    expect(reconcile([local], [tieHigh])[0].x).toBe(1);
  });
  it("lets a newer delete win and keeps elements only one side has", () => {
    const [a, b] = indexed([el("rectangle", 0, 0), el("ellipse", 0, 0)]);
    const out = reconcile([a], [{ ...a, isDeleted: true, version: a.version + 1 }, b]);
    expect(out.find(e => e.id === a.id)!.isDeleted).toBe(true);
    expect(out.some(e => e.id === b.id)).toBe(true);
  });
  it("leaves an element alone while it is being edited here", () => {
    const [a] = indexed([el("text", 0, 0)]);
    const out = reconcile([a], [{ ...a, x: 9, version: 9 }], id => id === a.id);
    expect(out[0].x).toBe(0);
  });
  it("orders the result by index", () => {
    const [a, b] = indexed([el("rectangle", 0, 0), el("ellipse", 0, 0)]);
    expect(reconcile([b], [a]).map(e => e.id)).toEqual([a.id, b.id]);
  });
});

describe("z-order", () => {
  const scene = () => indexed([el("rectangle", 0, 0), el("ellipse", 50, 50), el("diamond", 60, 60), el("rectangle", 500, 500)]);
  it("brings to front and sends to back", () => {
    const s = scene();
    expect(sortByIndex(reorder(s, new Set([s[0].id]), "front", 1)).at(-1)!.id).toBe(s[0].id);
    expect(sortByIndex(reorder(s, new Set([s[3].id]), "back", 1))[0].id).toBe(s[3].id);
  });
  it("moves forward past the next element, overlapping or not (Excalidraw)", () => {
    const s = scene();
    const out = sortByIndex(reorder(s, new Set([s[0].id]), "forward", 1)).map(e => e.id);
    expect(out).toEqual([s[1].id, s[0].id, s[2].id, s[3].id]);
    const far = sortByIndex(reorder(s, new Set([s[2].id]), "forward", 1)).map(e => e.id);
    expect(far).toEqual([s[0].id, s[1].id, s[3].id, s[2].id]); // s[3] is far away but still passed
  });
  it("steps past a whole group at once", () => {
    const s = scene().map((e, i) => (i === 1 || i === 2 ? { ...e, groupIds: ["g"] } : e));
    const out = sortByIndex(reorder(s, new Set([s[0].id]), "forward", 1)).map(e => e.id);
    expect(out).toEqual([s[1].id, s[2].id, s[0].id, s[3].id]);
  });
  it("moves backward and bumps only the moved element's version", () => {
    const s = scene();
    const out = reorder(s, new Set([s[2].id]), "backward", 1);
    expect(sortByIndex(out).map(e => e.id)).toEqual([s[0].id, s[2].id, s[1].id, s[3].id]);
    expect(out.find(e => e.id === s[2].id)!.version).toBe(s[2].version + 1);
    expect(out.find(e => e.id === s[1].id)!.version).toBe(s[1].version);
  });
});

describe("align, distribute, group, flip", () => {
  it("aligns left and centres", () => {
    const s = indexed([el("rectangle", 10, 0, 50, 50), el("rectangle", 100, 80, 20, 20)]);
    const ids = new Set(s.map(e => e.id));
    expect(align(s, ids, "left", 1).map(e => e.x)).toEqual([10, 10]);
    const c = align(s, ids, "vcenter", 1); const mid = (e: any) => e.y + e.height / 2;
    expect(mid(c[0])).toBeCloseTo(mid(c[1]));
  });
  it("moves a group as one unit when aligning", () => {
    const s = indexed([el("rectangle", 0, 0, 10, 10, { groupIds: ["g"] }), el("rectangle", 50, 0, 10, 10, { groupIds: ["g"] }), el("rectangle", 200, 100, 10, 10)]);
    const out = align(s, new Set(s.map(e => e.id)), "right", 1);
    expect(out[1].x - out[0].x).toBe(50);
    expect(out[1].x + 10).toBe(210);
  });
  it("distributes with equal gaps", () => {
    const s = indexed([el("rectangle", 0, 0, 10, 10), el("rectangle", 15, 0, 10, 10), el("rectangle", 100, 0, 10, 10)]);
    const out = distribute(s, new Set(s.map(e => e.id)), "x", 1);
    expect(out[1].x).toBeCloseTo(50);
  });
  it("groups, expands a click to the group, and ungroups", () => {
    const s = indexed([el("rectangle", 0, 0), el("ellipse", 0, 0), el("diamond", 0, 0)]);
    const { elements, groupId } = group(s, new Set([s[0].id, s[2].id]), 1);
    expect(elements.filter(e => e.groupIds.includes(groupId)).length).toBe(2);
    expect([...expandToGroups(elements, new Set([s[0].id]))].sort()).toEqual([s[0].id, s[2].id].sort());
    // grouped members sit together in z-order
    const order = sortByIndex(elements).map(e => e.id);
    expect(Math.abs(order.indexOf(s[0].id) - order.indexOf(s[2].id))).toBe(1);
    const un = ungroup(elements, new Set([s[0].id]), null, 1);
    expect(un.every(e => e.groupIds.length === 0)).toBe(true);
  });
  it("flips horizontally around the selection centre", () => {
    const s = indexed([el("rectangle", 0, 0, 10, 10), el("rectangle", 90, 0, 10, 10)]);
    const out = flip(s, new Set(s.map(e => e.id)), "h", 1);
    expect(out[0].x).toBe(90); expect(out[1].x).toBe(0);
  });
  it("flips an image's pixels through the sign of its scale", () => {
    const [img] = indexed([el("image", 0, 0, 40, 20, { scale: [1, 1], fileId: "f" })]);
    expect((flip([img], new Set([img.id]), "h", 1)[0] as any).scale).toEqual([-1, 1]);
    expect((flip([img], new Set([img.id]), "v", 1)[0] as any).scale).toEqual([1, -1]);
  });
  it("duplicates with new ids and new group ids", () => {
    const [a] = indexed([el("rectangle", 0, 0, 10, 10, { groupIds: ["g1"] })]);
    const d = duplicate(a, 10, 10, 1, new Map());
    expect(d.id).not.toBe(a.id); expect(d.groupIds[0]).not.toBe("g1"); expect(d.x).toBe(10);
  });
});

describe("geometry", () => {
  it("hits filled shapes inside and outlines only near the stroke", () => {
    const filled = el("rectangle", 0, 0, 100, 100, { backgroundColor: "#ffc9c9" });
    const hollow = el("rectangle", 0, 0, 100, 100);
    expect(hitTest(filled, 50, 50, 5)).toBe(true);
    expect(hitTest(hollow, 50, 50, 5)).toBe(false);
    expect(hitTest(hollow, 1, 50, 5)).toBe(true);
    expect(hitTest(hollow, 150, 50, 5)).toBe(false);
  });
  it("hits ellipses, diamonds and lines by their real shape", () => {
    const e = el("ellipse", 0, 0, 100, 100, { backgroundColor: "#000" });
    expect(hitTest(e, 50, 50, 1)).toBe(true); expect(hitTest(e, 3, 3, 1)).toBe(false);
    const d = el("diamond", 0, 0, 100, 100);
    expect(hitTest(d, 50, 1, 3)).toBe(true); expect(hitTest(d, 2, 2, 3)).toBe(false);
    const l = el("line", 0, 0, 100, 100, { points: [[0, 0], [100, 100]] });
    expect(hitTest(l, 50, 51, 3)).toBe(true); expect(hitTest(l, 80, 20, 3)).toBe(false);
  });
  it("accounts for rotation in bounds and hits", () => {
    const r = { ...el("rectangle", 0, 0, 100, 20, { backgroundColor: "#000" }), angle: Math.PI / 2 };
    const b = bounds(r);
    expect(b.y2 - b.y1).toBeCloseTo(100); expect(b.x2 - b.x1).toBeCloseTo(20);
    expect(hitTest(r, 50, 55, 1)).toBe(true); expect(hitTest(r, 95, 10, 1)).toBe(false);
  });
  it("finds edge points on boxes and ellipses", () => {
    const r = el("rectangle", 0, 0, 100, 100);
    const p = edgePoint(r, [500, 50], 0); expect(p[0]).toBeCloseTo(100); expect(p[1]).toBeCloseTo(50);
    const e = el("ellipse", 0, 0, 100, 100);
    const q = edgePoint(e, [50, 500], 0); expect(q[1]).toBeCloseTo(100);
    // diamond: the rhombus outline, not its box; the gap is added along the ray
    const d = el("diamond", 0, 0, 100, 100);
    const c = edgePoint(d, [100, 100], 0); expect(c[0]).toBeCloseTo(75); expect(c[1]).toBeCloseTo(75);
    const g = edgePoint(d, [100, 100], 4); expect(Math.hypot(g[0] - c[0], g[1] - c[1])).toBeCloseTo(4);
    const eg = edgePoint(el("ellipse", 0, 0, 200, 100), [100, 500], 4); expect(eg[1]).toBeCloseTo(104);
    expect(commonBounds([r, el("rectangle", 200, 200, 10, 10)])).toEqual({ x1: 0, y1: 0, x2: 210, y2: 210 });
  });
});

describe("arrow binding", () => {
  const setup = () => {
    const a = el("rectangle", 0, 0, 100, 100); const b = el("rectangle", 300, 0, 100, 100);
    const arrow = { ...el("arrow", 100, 50, 200, 0, { points: [[0, 0], [200, 0]] }), startBinding: { elementId: a.id, fixedPoint: [1, 0.5] as [number, number], mode: "orbit" as const }, endBinding: { elementId: b.id, fixedPoint: [0, 0.5] as [number, number], mode: "orbit" as const } } as LinearElement;
    return { a, b, arrow };
  };
  it("places bound ends on the outlines", () => {
    const { a, b, arrow } = setup();
    const placed = placeBoundEnds(arrow, new Map([[a.id, a], [b.id, b]]));
    expect(placed.x).toBeCloseTo(104); expect(placed.x + placed.points[1][0]).toBeCloseTo(296);
  });
  it("follows a moved shape and keeps the target's boundElements in step", () => {
    const { a, b, arrow } = setup();
    const moved = { ...b, y: 200 };
    const out = updateBoundArrows([a, moved, arrow], new Set([b.id]), 1);
    const ar = out[2] as LinearElement;
    expect(ar.y + ar.points[1][1]).toBeGreaterThan(150);
    expect(ar.version).toBe(arrow.version + 1);
    const synced = syncBoundElements(out, 1);
    expect(synced[0].boundElements).toEqual([{ id: arrow.id, type: "arrow" }]);
  });
  it("drops bindings to deleted shapes and finds bind targets", () => {
    const { a, b, arrow } = setup();
    const out = dropDeadBindings([a, { ...b, isDeleted: true }, arrow], 1);
    expect((out[2] as LinearElement).endBinding).toBeNull();
    expect(bindTarget([a, b], 302, 50, 5, new Set())!.id).toBe(b.id);
    expect(bindTarget([a, b], 200, 50, 5, new Set())).toBeNull();
  });
});

describe("undo history", () => {
  it("restores a snapshot with versions above both copies and tombstones new elements", () => {
    const [a] = indexed([el("rectangle", 0, 0)]);
    const b = el("ellipse", 0, 0);
    const before = [a]; const now = [{ ...a, x: 50, version: a.version + 1 }, b];
    const back = applySnap(now, before, 1, () => 7);
    expect(back.find(e => e.id === a.id)!.x).toBe(0);
    expect(back.find(e => e.id === a.id)!.version).toBe(a.version + 2);
    expect(back.find(e => e.id === b.id)!.isDeleted).toBe(true);
    const h = new History(2);
    h.record({ elements: [], appState: {} as any, selected: [] }); h.record({ elements: [a], appState: {} as any, selected: [] }); h.record({ elements: [a, b], appState: {} as any, selected: [] });
    expect(h.undo({ elements: [], appState: {} as any, selected: [] })!.elements.length).toBe(2);
    expect(h.undo({ elements: [], appState: {} as any, selected: [] })!.elements.length).toBe(1);
    expect(h.undo({ elements: [], appState: {} as any, selected: [] })).toBeNull(); // limited to 2
    expect(h.canRedo).toBe(true);
  });
});
