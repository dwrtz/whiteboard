import type { Element, SavedAppState } from "./types";

/** Snapshot undo/redo. Each entry is the element list (and saved app state) before a change.
 *  Undo restores the copy but bumps versions so the restore wins when merged with collaborators. */
export type Snap = { elements: Element[]; appState: SavedAppState; selected: string[] };
export class History {
  private undoStack: Snap[] = [];
  private redoStack: Snap[] = [];
  constructor(private limit = 100) {}
  record(before: Snap) { this.undoStack.push(before); if (this.undoStack.length > this.limit) this.undoStack.shift(); this.redoStack = []; }
  undo(current: Snap): Snap | null { const s = this.undoStack.pop(); if (!s) return null; this.redoStack.push(current); return s; }
  redo(current: Snap): Snap | null { const s = this.redoStack.pop(); if (!s) return null; this.undoStack.push(current); return s; }
  clear() { this.undoStack = []; this.redoStack = []; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
/** Apply a snapshot to the current elements: every element whose content differs gets the snapshot's
 *  content with a version above both copies; elements missing from the snapshot become deleted. */
export function applySnap(current: Element[], snap: Element[], now: number, nonce: () => number): Element[] {
  const cur = new Map(current.map(e => [e.id, e] as const));
  const out: Element[] = []; const inSnap = new Set<string>();
  for (const s of snap) {
    inSnap.add(s.id);
    const c = cur.get(s.id);
    if (c && same(c, s)) { out.push(c); continue; }
    out.push({ ...s, version: Math.max(s.version, c?.version ?? 0) + 1, versionNonce: nonce(), updated: now });
  }
  for (const c of current) if (!inSnap.has(c.id)) out.push(c.isDeleted ? c : { ...c, isDeleted: true, version: c.version + 1, versionNonce: nonce(), updated: now });
  return out;
}
function same(a: Element, b: Element) {
  const strip = (e: Element) => { const { version, versionNonce, updated, ...rest } = e; return JSON.stringify(rest); };
  return strip(a) === strip(b);
}
