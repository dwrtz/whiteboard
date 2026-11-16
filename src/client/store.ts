// Editor state. Elements live here (not in React state) so pointer moves can redraw without React work;
// React components subscribe and re-render on `tick`.
import type { Element, SavedAppState, BinaryFiles, ToolType, BinaryFile } from "../shared/types";
import { DEFAULT_STYLE, type Style, sortByIndex, syncIndices, randomInteger } from "../shared/elements";
import { History, applySnap, type Snap } from "../shared/history";
import { syncBoundElements, dropDeadBindings } from "../shared/binding";
import { expandToGroups } from "../shared/actions";
import { loadImages, type ImageCache } from "./render";

export type Mode = "local" | "room" | "copy";
export type View = { scrollX: number; scrollY: number; zoom: number };
export type Collaborator = { id: string; name: string; color: string; x?: number; y?: number; selected?: string[]; idle?: boolean; button?: "up" | "down" };
export const MIN_ZOOM = 0.1, MAX_ZOOM = 30;
export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 1000) / 1000));
export type ChangeKind = "elements" | "appState" | "files" | "remote";

export class Store {
  elements: Element[] = [];
  appState: SavedAppState = { viewBackgroundColor: "#ffffff", gridSize: 20, gridModeEnabled: false };
  view: View = { scrollX: 0, scrollY: 0, zoom: 1 };
  tool: ToolType = "selection";
  toolLocked = false;
  selected = new Set<string>();
  editingGroup: string | null = null;
  editingText: string | null = null;
  style: Style = { ...DEFAULT_STYLE };
  files: BinaryFiles = {};
  images: ImageCache = new Map();
  history = new History();
  readOnly = false;
  theme: "light" | "dark" = "light";
  // transient overlays drawn on the canvas
  selectionBox: { x1: number; y1: number; x2: number; y2: number } | null = null;
  eraserMarked = new Set<string>();
  bindHint: string | null = null;
  collaborators = new Map<string, Collaborator>();
  /** true while a pointer drag is in progress (remote updates leave dragged elements alone) */
  dragging = false;
  tick = 0;
  private listeners = new Set<() => void>();
  private renderListeners = new Set<() => void>();
  onChange: ((kind: ChangeKind) => void) | null = null;
  /** extra listener for live sessions (set by the page) */
  onChangeExtra: ((kind: ChangeKind) => void) | null = null;
  now = () => Date.now();

  subscribe(f: () => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  onRender(f: () => void) { this.renderListeners.add(f); return () => { this.renderListeners.delete(f); }; }
  /** Redraw the canvas only. */
  redraw() { for (const f of this.renderListeners) f(); }
  /** Redraw and update the React UI. */
  notify() { this.tick++; for (const f of this.listeners) f(); this.redraw(); }

  live(): Element[] { return this.elements.filter(e => !e.isDeleted); }
  get(id: string) { return this.elements.find(e => e.id === id); }
  selectedElements(): Element[] { return this.elements.filter(e => this.selected.has(e.id) && !e.isDeleted); }
  snap(): Snap { return { elements: this.elements, appState: this.appState, selected: [...this.selected] }; }

  /** A finished user change: tidy the scene, remember the previous state for undo, save/broadcast. */
  commit(next: Element[], before: Snap = this.snap(), record = true) {
    // array order is the intended stacking order; new elements are appended with index null
    let els = syncIndices(next);
    els = dropDeadBindings(els, this.now());
    els = syncBoundElements(els, this.now());
    if (record) this.history.record(before);
    this.elements = els;
    for (const id of [...this.selected]) { const e = this.get(id); if (!e || e.isDeleted) this.selected.delete(id); }
    this.notify();
    this.onChange?.("elements");
  }
  /** Live preview while dragging; `commit` follows on pointer up. */
  preview(next: Element[]) { this.elements = next; this.redraw(); }
  setAppState(patch: Partial<SavedAppState>, record = true) {
    if (record) this.history.record(this.snap());
    this.appState = { ...this.appState, ...patch }; this.notify(); this.onChange?.("appState");
  }
  /** Replace everything (opening a file or a saved drawing). Undo history is cleared unless `record`. */
  load(elements: Element[], appState: SavedAppState | null, files: BinaryFiles, record = false) {
    if (record) this.history.record(this.snap()); else this.history.clear();
    if (record) {
      // keep tombstones so collaborators and the server see the removals
      const keep = new Set(elements.map(e => e.id));
      const gone = this.elements.filter(e => !keep.has(e.id) && !e.isDeleted).map(e => ({ ...e, isDeleted: true, version: e.version + 1, versionNonce: randomInteger(), updated: this.now() }));
      elements = [...elements, ...gone];
    }
    this.elements = syncIndices(sortByIndex(elements));
    if (appState) this.appState = appState;
    this.selected.clear(); this.editingGroup = null;
    this.addFiles(files, false);
    this.notify();
    if (record) this.onChange?.("elements");
  }
  /** Changes from a collaborator or the server (already merged). Not undoable; saved like any change. */
  applyRemote(elements: Element[]) {
    this.elements = elements;
    for (const id of [...this.selected]) { const e = this.get(id); if (!e || e.isDeleted) this.selected.delete(id); }
    this.notify(); this.onChange?.("remote");
  }
  /** Merge result from the server during a save: update the scene without triggering another save. */
  applyRemoteSilently(elements: Element[]) {
    const cb = this.onChange; this.onChange = null; this.applyRemote(elements); this.onChange = cb;
  }
  addFiles(files: BinaryFiles | BinaryFile[], announce = true) {
    const list = Array.isArray(files) ? files : Object.values(files);
    let added = false;
    for (const f of list) if (!this.files[f.id]) { this.files[f.id] = f; added = true; }
    loadImages(this.files, this.images, () => this.redraw());
    if (added && announce) this.onChange?.("files");
  }
  undo() { const s = this.history.undo(this.snap()); if (s) this.restoreSnap(s); }
  redo() { const s = this.history.redo(this.snap()); if (s) this.restoreSnap(s); }
  private restoreSnap(s: Snap) {
    this.elements = sortByIndex(applySnap(this.elements, s.elements, this.now(), randomInteger));
    this.appState = s.appState;
    this.selected = new Set(s.selected.filter(id => this.get(id) && !this.get(id)!.isDeleted));
    this.notify(); this.onChange?.("elements");
  }
  select(ids: Iterable<string>, expand = true) {
    const set = new Set(ids);
    this.selected = expand ? expandToGroups(this.elements, set, this.editingGroup) : set;
    this.notify();
  }
  setTool(t: ToolType) {
    this.tool = t;
    if (t !== "selection" && t !== "hand") { this.selected.clear(); this.editingGroup = null; }
    this.notify();
  }
  setView(v: Partial<View>) { this.view = { ...this.view, ...v }; this.notify(); }
}
