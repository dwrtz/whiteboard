import type { Element } from "./types";
import { sortByIndex } from "./elements";

/** Which copy of an element wins: the higher version; on a tie the lower versionNonce (every client
 *  picks the same one). Deleted elements are kept as tombstones (isDeleted) so a delete wins over an
 *  older edit. Elements only one side has are kept. The result is ordered by `index`; elements with no key yet come last. */
export function reconcile(local: Element[], remote: Element[], keepLocal?: (id: string) => boolean): Element[] {
  const byId = new Map<string, Element>();
  for (const e of local) byId.set(e.id, e);
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l) { byId.set(r.id, r); continue; }
    if (keepLocal?.(r.id)) continue; // being edited here right now
    if (r.version > l.version || (r.version === l.version && r.versionNonce < l.versionNonce)) byId.set(r.id, r);
  }
  // Elements without a key yet (one being drawn here right now) stay on top, in their local order;
  // syncIndices gives them keys when the drawing is committed.
  const all = [...byId.values()];
  return [...sortByIndex(all.filter(e => e.index)), ...all.filter(e => !e.index)];
}
/** Elements whose version differs from (or are missing in) the previous copy: what to send to others. */
export function changedSince(prev: Map<string, number>, els: Element[]): Element[] {
  return els.filter(e => prev.get(e.id) !== e.version);
}
export const versionsOf = (els: Element[]) => new Map(els.map(e => [e.id, e.version] as const));
