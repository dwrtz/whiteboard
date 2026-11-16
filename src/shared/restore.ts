import type { Element, SceneFile, SavedAppState, BinaryFiles, LibraryItem, ElementType } from "./types";
import { ELEMENT_TYPES } from "./types";
import { randomId, randomInteger, syncIndices } from "./elements";

const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
const COLOR = /^(transparent|#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([\d\s.,%]+\))$/;
const color = (v: unknown, d: string) => (typeof v === "string" && COLOR.test(v.trim()) ? v.trim() : d);

const ARROWHEADS = ["arrow", "triangle", "triangle_outline", "bar", "circle", "circle_outline", "diamond", "diamond_outline"];
export type Restored = { elements: Element[]; appState: SavedAppState; files: BinaryFiles; skipped: number };

/** Turn any parsed JSON that claims to be a scene into a clean scene: unknown element types are left out
 *  (counted in `skipped`), every field gets a valid value, deleted elements are dropped, indices are made valid. */
export function restoreElements(raw: unknown[], keepDeleted = false): { elements: Element[]; skipped: number } {
  let skipped = 0; const out: Element[] = []; const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") { skipped++; continue; }
    const o = r as Record<string, any>;
    if (!ELEMENT_TYPES.includes(o.type)) { if (!o.isDeleted) skipped++; continue; }
    if (o.isDeleted && !keepDeleted) continue;
    const type = o.type as ElementType;
    let id = str(o.id, "") || randomId(); if (seen.has(id)) id = randomId(); seen.add(id);
    const base: any = {
      id, type, x: num(o.x, 0), y: num(o.y, 0), width: num(o.width, 0), height: num(o.height, 0), angle: num(o.angle, 0),
      strokeColor: color(o.strokeColor, "#1e1e1e"), backgroundColor: color(o.backgroundColor, "transparent"),
      fillStyle: ["hachure", "cross-hatch", "solid", "zigzag"].includes(o.fillStyle) ? o.fillStyle : "solid",
      strokeWidth: Math.min(Math.max(num(o.strokeWidth, 2), 0.5), 32), strokeStyle: ["solid", "dashed", "dotted"].includes(o.strokeStyle) ? o.strokeStyle : "solid",
      roughness: Math.min(Math.max(num(o.roughness, 1), 0), 3), opacity: Math.min(Math.max(num(o.opacity, 100), 0), 100),
      roundness: o.roundness && typeof o.roundness === "object" ? { type: num(o.roundness.type, 3), ...(typeof o.roundness.value === "number" ? { value: o.roundness.value } : {}) } : null,
      seed: Number.isInteger(o.seed) ? o.seed : randomInteger(), version: Number.isInteger(o.version) ? o.version : 1,
      versionNonce: Number.isInteger(o.versionNonce) ? o.versionNonce : randomInteger(), index: typeof o.index === "string" ? o.index : null,
      isDeleted: !!o.isDeleted, groupIds: Array.isArray(o.groupIds) ? o.groupIds.filter((g: unknown) => typeof g === "string") : [], frameId: null,
      // kept as they are for other tools: free-form plug-in data (the link is kept below)
      ...(o.customData && typeof o.customData === "object" && !Array.isArray(o.customData) ? { customData: o.customData } : {}),
      boundElements: Array.isArray(o.boundElements) ? o.boundElements.filter((b: any) => b && typeof b.id === "string" && (b.type === "arrow" || b.type === "text")).map((b: any) => ({ id: b.id, type: b.type })) : null,
      updated: num(o.updated, Date.now()), link: typeof o.link === "string" ? o.link.slice(0, 2048) : null, locked: !!o.locked,
    };
    const pts = (p: unknown) => (Array.isArray(p) ? p.filter((q: any) => Array.isArray(q) && isFinite(q[0]) && isFinite(q[1])).map((q: any) => [Number(q[0]), Number(q[1])]) : []);
    if (type === "arrow" || type === "line") {
      const points = pts(o.points); if (points.length < 2) { skipped++; continue; }
      const bind = (b: any) => (b && typeof b.elementId === "string" ? { elementId: b.elementId, fixedPoint: Array.isArray(b.fixedPoint) ? [num(b.fixedPoint[0], 0.5), num(b.fixedPoint[1], 0.5)] : [0.5, 0.5], mode: b.mode === "inside" ? "inside" : "orbit" } : null);
      const head = (h: unknown) => { const v = h === "dot" ? "circle" : h; return typeof v === "string" && ARROWHEADS.includes(v) ? (v as any) : null; };
      out.push({ ...base, points, startBinding: bind(o.startBinding), endBinding: bind(o.endBinding), startArrowhead: head(o.startArrowhead), endArrowhead: head(o.endArrowhead),
        ...(type === "arrow" ? { elbowed: !!o.elbowed } : { polygon: !!o.polygon }) });
    } else if (type === "freedraw") {
      const points = pts(o.points); if (!points.length) { skipped++; continue; }
      out.push({ ...base, roundness: null, points, pressures: Array.isArray(o.pressures) ? o.pressures.map((p: any) => num(p, 0.5)) : [], simulatePressure: o.simulatePressure !== false });
    } else if (type === "text") {
      const text = str(o.text, str(o.originalText, ""));
      out.push({ ...base, text, originalText: str(o.originalText, text), fontSize: Math.min(Math.max(num(o.fontSize, 20), 4), 400), fontFamily: num(o.fontFamily, 5),
        textAlign: ["left", "center", "right"].includes(o.textAlign) ? o.textAlign : "left", verticalAlign: ["top", "middle", "bottom"].includes(o.verticalAlign) ? o.verticalAlign : "top",
        containerId: typeof o.containerId === "string" ? o.containerId : null, lineHeight: num(o.lineHeight, 1.25), autoResize: o.autoResize !== false });
    } else if (type === "image") {
      out.push({ ...base, fileId: typeof o.fileId === "string" ? o.fileId : null, status: "saved", scale: Array.isArray(o.scale) ? [num(o.scale[0], 1), num(o.scale[1], 1)] : [1, 1], crop: null });
    } else out.push(base);
  }
  // Keep the file's order: sort by valid index first, then fix missing/invalid ones.
  const ordered = out.every(e => e.index) ? out.slice().sort((a, b) => (a.index! < b.index! ? -1 : a.index! > b.index! ? 1 : 0)) : out;
  return { elements: syncIndices(ordered), skipped };
}

export function restoreAppState(raw: any): SavedAppState {
  const a = raw && typeof raw === "object" ? raw : {};
  return { viewBackgroundColor: color(a.viewBackgroundColor, "#ffffff"), gridSize: a.gridSize === null ? null : num(a.gridSize, 20), gridModeEnabled: !!a.gridModeEnabled };
}
const DATA_URL = /^data:(image\/(png|jpeg|gif|webp|svg\+xml|bmp|avif));base64,[A-Za-z0-9+/=]+$/;
export function restoreFiles(raw: any): BinaryFiles {
  const out: BinaryFiles = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, f] of Object.entries<any>(raw)) {
    if (f && typeof f.dataURL === "string" && DATA_URL.test(f.dataURL)) out[k] = { id: k, mimeType: f.dataURL.slice(5, f.dataURL.indexOf(";")), dataURL: f.dataURL, created: num(f.created, Date.now()) };
  }
  return out;
}

export class ImportError extends Error {}
/** Parse a .excalidraw-style JSON text. Throws ImportError with a message for the person. */
export function parseSceneFile(text: string): Restored {
  let data: any;
  try { data = JSON.parse(text); } catch { throw new ImportError("That file is not valid JSON."); }
  if (data?.type === "excalidrawlib") throw new ImportError("That is a library file. Open it from the library panel.");
  if (!data || (data.type !== undefined && data.type !== "excalidraw") || !Array.isArray(data.elements)) throw new ImportError("That file is not a drawing this app can open.");
  const { elements, skipped } = restoreElements(data.elements);
  return { elements, appState: restoreAppState(data.appState), files: restoreFiles(data.files), skipped };
}
export function parseLibraryFile(text: string): LibraryItem[] {
  let data: any;
  try { data = JSON.parse(text); } catch { throw new ImportError("That file is not valid JSON."); }
  if (data?.type !== "excalidrawlib") throw new ImportError("That file is not a library file.");
  // version 1 kept a list of element lists under `library`
  const items: any[] = Array.isArray(data.libraryItems) ? data.libraryItems : Array.isArray(data.library) ? data.library.map((els: any) => ({ elements: els })) : [];
  return items.map(it => ({ id: typeof it.id === "string" ? it.id : randomId(), status: (it.status === "published" ? "published" : "unpublished") as LibraryItem["status"],
    elements: restoreElements(Array.isArray(it.elements) ? it.elements : []).elements, created: num(it.created, Date.now()), ...(typeof it.name === "string" ? { name: it.name } : {}) }))
    .filter(it => it.elements.length > 0);
}
export function serializeScene(elements: Element[], appState: SavedAppState, files: BinaryFiles, source: string): string {
  const live = elements.filter(e => !e.isDeleted);
  const used = new Set(live.map(e => (e as any).fileId).filter(Boolean));
  const f: BinaryFiles = {}; for (const [k, v] of Object.entries(files)) if (used.has(k)) f[k] = v;
  const doc: SceneFile = { type: "excalidraw", version: 2, source, elements: live, appState: { gridSize: appState.gridSize, gridModeEnabled: !!appState.gridModeEnabled, viewBackgroundColor: appState.viewBackgroundColor }, files: f };
  return JSON.stringify(doc, null, 2);
}
export function serializeLibrary(items: LibraryItem[], source: string): string {
  return JSON.stringify({ type: "excalidrawlib", version: 2, source, libraryItems: items }, null, 2);
}
