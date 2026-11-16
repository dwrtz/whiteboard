import React, { useEffect, useMemo, useState } from "react";
import type { Element, LibraryItem } from "../shared/types";
import { Modal, toast, Icon } from "./ui";
import type { Store } from "./store";
import { exportCanvas, exportSvg } from "./render";
import { download, safeFileName } from "./files";
import { isText, fontStack } from "../shared/types";
import kalamUrl from "@fontsource/kalam/files/kalam-latin-400-normal.woff2?url";

let kalamCss: Promise<string> | null = null;
/** The hand-drawn font as an embeddable @font-face rule, so exported SVGs look the same elsewhere. */
function fontCss(): Promise<string> {
  kalamCss ??= fetch(kalamUrl).then(r => r.arrayBuffer()).then(b => {
    let s = ""; const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return `@font-face{font-family:"Kalam";src:url(data:font/woff2;base64,${btoa(s)}) format("woff2");}`;
  }).catch(() => "");
  return kalamCss;
}

export function ExportDialog({ s, name, onClose }: { s: Store; name: string; onClose: () => void }) {
  const selOnly = s.selected.size > 0;
  const els = useMemo(() => (selOnly ? s.selectedElements() : s.live()), []);
  const [bg, setBg] = useState(true); const [dark, setDark] = useState(s.theme === "dark"); const [scale, setScale] = useState(2);
  const [preview, setPreview] = useState<string>("");
  const opts = { background: bg, backgroundColor: s.appState.viewBackgroundColor, dark, scale };
  useEffect(() => { if (els.length) setPreview(exportCanvas(els, s.images, { ...opts, scale: 1 }).toDataURL("image/png")); }, [bg, dark]);
  const file = safeFileName(name);
  const png = () => new Promise<Blob>(ok => exportCanvas(els, s.images, opts).toBlob(b => ok(b!), "image/png"));
  const svgText = async () => exportSvg(els, s.files, { ...opts, fontCss: els.some(e => isText(e) && fontStack(e.fontFamily).startsWith("Kalam")) ? await fontCss() : undefined });
  if (!els.length) return <Modal title="Export image" onClose={onClose}><p className="modal-text">There is nothing to export yet. Draw something first.</p></Modal>;
  return (
    <Modal title="Export image" onClose={onClose} wide>
      <div className="export">
        <div className="export-preview checker">{preview && <img src={preview} alt="Preview of the exported image" />}</div>
        <div className="export-opts">
          {selOnly && <p className="muted">Only the selected elements are exported.</p>}
          <label className="switch"><input type="checkbox" checked={bg} onChange={e => setBg(e.target.checked)} /> Background</label>
          <label className="switch"><input type="checkbox" checked={dark} onChange={e => setDark(e.target.checked)} /> Dark mode</label>
          <div className="field"><span>Scale</span><div className="choice" role="radiogroup" aria-label="Scale">{[1, 2, 3].map(n => <button key={n} role="radio" aria-checked={scale === n} className={`choice-btn ${scale === n ? "is-active" : ""}`} onClick={() => setScale(n)}>{n}×</button>)}</div></div>
          <div className="export-actions">
            <button className="btn primary" onClick={async () => { download(`${file}.png`, await png()); onClose(); }}><Icon name="download" /> PNG</button>
            <button className="btn primary" onClick={async () => { download(`${file}.svg`, await svgText(), "image/svg+xml"); onClose(); }}><Icon name="download" /> SVG</button>
            <button className="btn" onClick={async () => {
              try { await navigator.clipboard.write([new ClipboardItem({ "image/png": png() })]); toast("Image copied"); onClose(); }
              catch { toast("This browser would not copy an image; download it instead"); }
            }}><Icon name="copy" /> Copy PNG</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export const SHORTCUTS: [string, [string, string][]][] = [
  ["Tools", [["Hand (panning)", "H"], ["Selection", "V or 1"], ["Rectangle", "R or 2"], ["Diamond", "D or 3"], ["Ellipse", "O or 4"], ["Arrow", "A or 5"], ["Line", "L or 6"], ["Draw", "P, X or 7"], ["Text", "T or 8"], ["Insert image", "9"], ["Eraser", "E or 0"], ["Keep the tool active after drawing", "Q"]]],
  ["View", [["Zoom in", "Ctrl + +"], ["Zoom out", "Ctrl + -"], ["Reset zoom", "Ctrl + 0"], ["Zoom to fit all", "Shift + 1"], ["Zoom to selection", "Shift + 2"], ["Pan", "Space + drag, or scroll"], ["Toggle grid", "Ctrl + '"], ["Toggle dark mode", "Alt + Shift + D"], ["Help", "?"]]],
  ["Editor", [["Undo", "Ctrl + Z"], ["Redo", "Ctrl + Shift + Z"], ["Select all", "Ctrl + A"], ["Delete", "Delete"], ["Duplicate", "Ctrl + D, or Alt + drag"], ["Copy / cut / paste", "Ctrl + C / X / V"], ["Copy styles", "Ctrl + Alt + C"], ["Paste styles", "Ctrl + Alt + V"], ["Group", "Ctrl + G"], ["Ungroup", "Ctrl + Shift + G"], ["Bring forward / send backward", "Ctrl + ] / ["], ["Bring to front / send to back", "Ctrl + Shift + ] / ["], ["Align left / right / top / bottom", "Ctrl + Shift + arrows"], ["Flip horizontal / vertical", "Shift + H / Shift + V"], ["Lock / unlock", "Ctrl + Shift + L"], ["Move by 1 (or grid step)", "Arrows (Shift + arrows)"], ["Edit text", "Enter or double-click"], ["Export image", "Ctrl + Shift + E"], ["Open file", "Ctrl + O"], ["Save", "Ctrl + S"], ["Finish a line", "Enter, Escape or double-click"]]],
];
export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} wide className="help">
      <div className="help-cols">{SHORTCUTS.map(([g, list]) => <section key={g}><h3>{g}</h3><dl>{list.map(([a, k]) => <div key={a} className="help-row"><dt>{a}</dt><dd><kbd>{k}</kbd></dd></div>)}</dl></section>)}</div>
      <p className="muted small">On a Mac, Ctrl is ⌘ Cmd.</p>
    </Modal>
  );
}

export type LibraryApi = { load: () => Promise<LibraryItem[]>; save: (items: LibraryItem[]) => Promise<void>; where: string };
function itemSvg(els: Element[]) {
  const svg = exportSvg(els, {}, { background: false, backgroundColor: "#fff", dark: false, scale: 1, padding: 6 });
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
export function LibraryPanel({ s, api: lib, onInsert, onClose, onImport, onExport, addRequest = false, onAddHandled }: { s: Store; api: LibraryApi; onInsert: (it: LibraryItem) => void; onClose: () => void; onImport: () => Promise<LibraryItem[] | null>; onExport: (items: LibraryItem[]) => void; addRequest?: boolean; onAddHandled?: () => void }) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  // load once per opening (the api object may be re-created by the page on every render)
  useEffect(() => { lib.load().then(setItems).catch(e => { toast(e.message); setItems([]); }); }, []);
  // "Add to library" from the context menu: add the selection once the items are loaded
  useEffect(() => { if (addRequest && items) { onAddHandled?.(); add(); } }, [addRequest, items]);
  const save = async (next: LibraryItem[]) => { setItems(next); try { await lib.save(next); } catch (e: any) { toast(e.message); } };
  const add = () => {
    const sel = s.selectedElements(); if (!sel.length) return toast("Select something on the canvas first");
    const copy = JSON.parse(JSON.stringify(sel)) as Element[];
    save([{ id: crypto.randomUUID(), status: "unpublished", elements: copy, created: Date.now() }, ...(items ?? [])]);
    toast("Added to library");
  };
  return (
    <aside className="library" aria-label="Library">
      <header><h2>Library</h2><button className="icon-btn" aria-label="Close library" onClick={onClose}><Icon name="x" /></button></header>
      <div className="library-actions">
        <button className="btn small primary" onClick={add} disabled={!s.selected.size}><Icon name="plus" /> Add selection</button>
        <button className="btn small" onClick={async () => { const more = await onImport(); if (more?.length) { save([...more, ...(items ?? [])]); toast(`Added ${more.length} item${more.length > 1 ? "s" : ""}`); } }}><Icon name="upload" /> Import</button>
        <button className="btn small" disabled={!items?.length} onClick={() => items && onExport(items)}><Icon name="download" /> Export</button>
      </div>
      <p className="muted small">{lib.where}</p>
      {!items ? <p className="muted">Loading…</p> : items.length === 0 ? <p className="library-empty">No items yet. Select shapes on the canvas and press “Add selection” to keep them here.</p> :
        <ul className="library-grid">{items.map(it => <li key={it.id}>
          <button className="library-item" title={it.name || "Insert on the canvas"} aria-label={`Insert ${it.name || "library item"}`} onClick={() => onInsert(it)}><img src={itemSvg(it.elements)} alt="" /></button>
          <button className="library-remove" aria-label="Remove from library" title="Remove from library" onClick={() => save(items.filter(x => x.id !== it.id))}><Icon name="x" size={12} /></button>
        </li>)}</ul>}
    </aside>
  );
}
