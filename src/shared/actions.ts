import type { Element } from "./types";
import { hasPoints } from "./types";
import { bump, keysBetween, randomId, sortByIndex } from "./elements";
import { bounds, commonBounds } from "./geometry";

/** A selection grows to whole groups: picking one member of a group picks the outermost group. */
export function expandToGroups(els: Element[], ids: Set<string>, editingGroup: string | null = null): Set<string> {
  const out = new Set(ids);
  for (const e of els) if (ids.has(e.id)) {
    const g = outerGroup(e, editingGroup);
    if (g) for (const o of els) if (!o.isDeleted && o.groupIds.includes(g)) out.add(o.id);
  }
  return out;
}
/** The outermost group of e that is inside the group being edited (or null). */
export function outerGroup(e: Element, editingGroup: string | null): string | null {
  if (!e.groupIds.length) return null;
  if (!editingGroup) return e.groupIds[e.groupIds.length - 1];
  const i = e.groupIds.indexOf(editingGroup);
  return i > 0 ? e.groupIds[i - 1] : null;
}

// ---- z-order. Moves change only `index` (and version), so they merge cleanly with other people's edits.
type Z = "forward" | "backward" | "front" | "back";
export function reorder(all: Element[], ids: Set<string>, dir: Z, now: number): Element[] {
  const live = sortByIndex(all.filter(e => !e.isDeleted));
  const sel = live.filter(e => ids.has(e.id));
  if (!sel.length) return all;
  const rest = live.filter(e => !ids.has(e.id));
  let order: Element[];
  if (dir === "front") order = [...rest, ...sel];
  else if (dir === "back") order = [...sel, ...rest];
  else {
    // Excalidraw's rule: forward/backward step past the next unselected element above/below the
    // selection, overlapping or not; if that element is in a group, past its whole (outermost) group.
    const top = live.indexOf(sel[sel.length - 1]), bottom = live.indexOf(sel[0]);
    const span = (t: Element) => {
      const g = t.groupIds.at(-1);
      const members = g ? rest.filter(e => e.groupIds.includes(g)) : [t];
      return [rest.indexOf(members[0]), rest.indexOf(members[members.length - 1])] as const;
    };
    if (dir === "forward") {
      const target = live.slice(top + 1).find(e => !ids.has(e.id));
      if (!target) return all;
      const ti = span(target)[1]; order = [...rest.slice(0, ti + 1), ...sel, ...rest.slice(ti + 1)];
    } else {
      const target = live.slice(0, bottom).reverse().find(e => !ids.has(e.id));
      if (!target) return all;
      const ti = span(target)[0]; order = [...rest.slice(0, ti), ...sel, ...rest.slice(ti)];
    }
  }
  // give the selected elements new keys between their new neighbours
  const result = new Map(all.map(e => [e.id, e] as const));
  let i = 0;
  while (i < order.length) {
    if (!ids.has(order[i].id)) { i++; continue; }
    let j = i; while (j < order.length && ids.has(order[j].id)) j++;
    const lo = i > 0 ? order[i - 1].index : null, hi = j < order.length ? order[j].index : null;
    const keys = keysBetween(lo, hi, j - i);
    for (let k = i; k < j; k++) { const e = bump(order[k], { index: keys[k - i] }, now); order[k] = e; result.set(e.id, e); }
    i = j;
  }
  return sortByIndex([...result.values()]);
}

// ---- align and distribute (groups move as one unit)
export type Align = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
function units(els: Element[], ids: Set<string>): Element[][] {
  const map = new Map<string, Element[]>();
  for (const e of els) if (ids.has(e.id) && !e.isDeleted) {
    const key = e.groupIds.length ? "g:" + e.groupIds[e.groupIds.length - 1] : e.id;
    (map.get(key) ?? map.set(key, []).get(key)!).push(e);
  }
  return [...map.values()];
}
function moveAll(all: Element[], moves: Map<string, [number, number]>, now: number): Element[] {
  return all.map(e => { const m = moves.get(e.id); return m && (m[0] || m[1]) ? bump(e, { x: e.x + m[0], y: e.y + m[1] }, now) : e; });
}
export function align(all: Element[], ids: Set<string>, how: Align, now: number): Element[] {
  const us = units(all, ids); if (us.length < 2) return all;
  const box = commonBounds(us.flat())!; const moves = new Map<string, [number, number]>();
  for (const u of us) {
    const b = commonBounds(u)!; let dx = 0, dy = 0;
    if (how === "left") dx = box.x1 - b.x1; if (how === "right") dx = box.x2 - b.x2; if (how === "hcenter") dx = (box.x1 + box.x2) / 2 - (b.x1 + b.x2) / 2;
    if (how === "top") dy = box.y1 - b.y1; if (how === "bottom") dy = box.y2 - b.y2; if (how === "vcenter") dy = (box.y1 + box.y2) / 2 - (b.y1 + b.y2) / 2;
    for (const e of u) moves.set(e.id, [dx, dy]);
  }
  return moveAll(all, moves, now);
}
export function distribute(all: Element[], ids: Set<string>, axis: "x" | "y", now: number): Element[] {
  const us = units(all, ids); if (us.length < 3) return all;
  const items = us.map(u => ({ u, b: commonBounds(u)! }));
  const lo = (b: any) => (axis === "x" ? b.x1 : b.y1), hi = (b: any) => (axis === "x" ? b.x2 : b.y2);
  items.sort((a, c) => (lo(a.b) + hi(a.b)) - (lo(c.b) + hi(c.b)));
  const span = Math.max(...items.map(i => hi(i.b))) - Math.min(...items.map(i => lo(i.b)));
  const total = items.reduce((s, i) => s + hi(i.b) - lo(i.b), 0);
  const gap = (span - total) / (items.length - 1);
  let pos = lo(items[0].b); const moves = new Map<string, [number, number]>();
  for (const { u, b } of items) { const d = pos - lo(b); for (const e of u) moves.set(e.id, axis === "x" ? [d, 0] : [0, d]); pos += hi(b) - lo(b) + gap; }
  return moveAll(all, moves, now);
}

// ---- groups
export function group(all: Element[], ids: Set<string>, now: number): { elements: Element[]; groupId: string } {
  const gid = randomId();
  const sel = all.filter(e => ids.has(e.id) && !e.isDeleted);
  // Grouping also brings members together in z-order, just above the topmost member.
  let elements = all.map(e => (ids.has(e.id) && !e.isDeleted ? bump(e, { groupIds: [...e.groupIds, gid] }, now) : e));
  if (sel.length > 1) {
    const live = sortByIndex(elements.filter(e => !e.isDeleted));
    const top = Math.max(...live.map((e, i) => (ids.has(e.id) ? i : -1)));
    const contiguous = live.slice(live.findIndex(e => ids.has(e.id)), top + 1).every(e => ids.has(e.id));
    if (!contiguous) {
      // move members to sit together just above the topmost one, keeping their order
      const next = live.slice(top + 1)[0]?.index ?? null;
      const order = live.filter(e => ids.has(e.id));
      const keys = keysBetween(live[top].index, next, order.length);
      const m = new Map(order.map((e, i) => [e.id, keys[i]] as const));
      elements = elements.map(e => (m.has(e.id) ? { ...e, index: m.get(e.id)! } : e));
    }
  }
  return { elements: sortByIndex(elements), groupId: gid };
}
export function ungroup(all: Element[], ids: Set<string>, editingGroup: string | null, now: number): Element[] {
  const groups = new Set<string>();
  for (const e of all) if (ids.has(e.id)) { const g = outerGroup(e, editingGroup); if (g) groups.add(g); }
  return all.map(e => (e.groupIds.some(g => groups.has(g)) ? bump(e, { groupIds: e.groupIds.filter(g => !groups.has(g)) }, now) : e));
}

// ---- flip (around the selection's centre)
export function flip(all: Element[], ids: Set<string>, axis: "h" | "v", now: number): Element[] {
  const sel = all.filter(e => ids.has(e.id) && !e.isDeleted); const box = commonBounds(sel); if (!box) return all;
  const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
  return all.map(e => {
    if (!ids.has(e.id) || e.isDeleted) return e;
    if (hasPoints(e)) {
      const pts = e.points.map(([x, y]) => (axis === "h" ? [2 * (cx - e.x) - x, y] : [x, 2 * (cy - e.y) - y]) as [number, number]);
      return bump(e, { points: pts, angle: e.angle ? -e.angle : 0 } as any, now);
    }
    // images also mirror their pixels through the sign of `scale`
    const scale = e.type === "image" ? { scale: axis === "h" ? [-(e as any).scale[0], (e as any).scale[1]] : [(e as any).scale[0], -(e as any).scale[1]] } : {};
    return bump(e, axis === "h" ? { x: 2 * cx - e.x - e.width, angle: e.angle ? -e.angle : 0, ...scale } as any : { y: 2 * cy - e.y - e.height, angle: e.angle ? -e.angle : 0, ...scale } as any, now);
  });
}
