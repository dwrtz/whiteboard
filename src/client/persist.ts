// Where a drawing is kept: this browser (local canvas), the server (saved drawings), nowhere (copies/view).
import type { Element, SavedAppState, BinaryFiles, BinaryFile } from "../shared/types";
import { restoreElements, restoreAppState } from "../shared/restore";
import { reconcile } from "../shared/reconcile";
import { dataURLToBytes, bytesToDataURL } from "./files";
import type { Store } from "./store";
import { exportCanvas } from "./render";

// ---------- this browser ----------
const LOCAL_KEY = "whiteboard:local";
const DB_NAME = "whiteboard-files";
function idb(): Promise<IDBDatabase> {
  return new Promise((ok, bad) => { const r = indexedDB.open(DB_NAME, 1); r.onupgradeneeded = () => r.result.createObjectStore("files"); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
}
async function idbAll(): Promise<BinaryFile[]> {
  const db = await idb(); return new Promise((ok, bad) => { const r = db.transaction("files").objectStore("files").getAll(); r.onsuccess = () => ok(r.result as BinaryFile[]); r.onerror = () => bad(r.error); });
}
async function idbPut(files: BinaryFile[]) {
  if (!files.length) return; const db = await idb();
  await new Promise<void>((ok, bad) => { const t = db.transaction("files", "readwrite"); for (const f of files) t.objectStore("files").put(f, f.id); t.oncomplete = () => ok(); t.onerror = () => bad(t.error); });
}
async function idbKeep(ids: Set<string>) {
  const db = await idb();
  await new Promise<void>((ok) => { const t = db.transaction("files", "readwrite"); const st = t.objectStore("files"); const r = st.getAllKeys(); r.onsuccess = () => { for (const k of r.result) if (!ids.has(String(k))) st.delete(k); }; t.oncomplete = () => ok(); t.onerror = () => ok(); });
}
export function readLocal(): { elements: Element[]; appState: SavedAppState } {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
    if (raw) return { elements: restoreElements(raw.elements || []).elements, appState: restoreAppState(raw.appState) };
  } catch {}
  return { elements: [], appState: restoreAppState(null) };
}
export async function readLocalFiles(): Promise<BinaryFiles> {
  try { const out: BinaryFiles = {}; for (const f of await idbAll()) out[f.id] = f; return out; } catch { return {}; }
}
export function localIsEmpty() { return readLocal().elements.length === 0; }
/** Save the local canvas. Elements go to localStorage, images to IndexedDB (unused images are removed). */
export async function writeLocal(elements: Element[], appState: SavedAppState, files: BinaryFiles) {
  const live = elements.filter(e => !e.isDeleted);
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ elements: live, appState })); }
  catch { throw new Error("This browser's storage is full; the latest changes were not saved here"); }
  const used = new Set(live.map(e => (e as any).fileId).filter(Boolean) as string[]);
  try { await idbPut(Object.values(files).filter(f => used.has(f.id))); await idbKeep(used); } catch {}
}
export function bindLocal(s: Store, onError: (m: string) => void) {
  let t: any = null;
  s.onChange = () => { clearTimeout(t); t = setTimeout(() => writeLocal(s.elements, s.appState, s.files).catch(e => onError(e.message)), 300); };
  const flush = () => { if (t) { clearTimeout(t); writeLocal(s.elements, s.appState, s.files).catch(() => {}); } };
  window.addEventListener("pagehide", flush);
  return () => { flush(); window.removeEventListener("pagehide", flush); s.onChange = null; };
}

// ---------- library (this browser) ----------
const LIB_KEY = "whiteboard:library";
export function readLocalLibrary(): any[] { try { return JSON.parse(localStorage.getItem(LIB_KEY) || "[]"); } catch { return []; } }
export function writeLocalLibrary(items: any[]) { localStorage.setItem(LIB_KEY, JSON.stringify(items)); }

// ---------- saved drawings ----------
