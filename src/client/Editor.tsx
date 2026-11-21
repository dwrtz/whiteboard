import React, { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Element, LibraryItem, ToolType, TextElement, Point } from "../shared/types";
import { isText, LINE_HEIGHT } from "../shared/types";
import { duplicate, sortByIndex, newElement } from "../shared/elements";
import { commonBounds } from "../shared/geometry";
import { parseSceneFile, parseLibraryFile, serializeScene, serializeLibrary, restoreElements, restoreFiles, ImportError, type Restored } from "../shared/restore";
import type { Snap } from "../shared/history";
import { settings } from "../shared/settings";
import { Store, type Mode } from "./store";
import { Controller } from "./controller";
import { paint } from "./paint";
import { measureText, fontString } from "./render";
import { StylePanel, showsStylePanel, CANVAS_SWATCHES } from "./StylePanel";
import { ExportDialog, HelpDialog, LibraryPanel, type LibraryApi } from "./dialogs";
import { readImageFile, placeImage, download, pickFile, safeFileName } from "./files";
import { Icon, toast, confirm, showMenu, type MenuItem } from "./ui";
import { themePref, setThemePref, resolvedTheme, type ThemePref } from "./theme";

const TOOLS: { tool: ToolType; label: string; key: string; icon: string }[] = [
  { tool: "hand", label: "Hand (panning tool)", key: "H", icon: "hand" },
  { tool: "selection", label: "Selection", key: "1", icon: "selection" },
  { tool: "rectangle", label: "Rectangle", key: "2", icon: "rectangle" },
  { tool: "diamond", label: "Diamond", key: "3", icon: "diamond" },
  { tool: "ellipse", label: "Ellipse", key: "4", icon: "ellipse" },
  { tool: "arrow", label: "Arrow", key: "5", icon: "arrow" },
  { tool: "line", label: "Line", key: "6", icon: "line" },
  { tool: "freedraw", label: "Draw", key: "7", icon: "freedraw" },
  { tool: "text", label: "Text", key: "8", icon: "text" },
  { tool: "image", label: "Insert image", key: "9", icon: "image" },
  { tool: "eraser", label: "Eraser", key: "0", icon: "eraser" },
];
const CLIP_TYPE = "whiteboard/clipboard";

function zoomPercent(zoom: number) {
  const percent = zoom * 100;
  if (percent < 0.01 || percent >= 100_000) return percent.toExponential(1).replace(".0e", "e").replace("e+", "e");
  return percent < 1 ? Number(percent.toPrecision(2)).toString() : Math.round(percent).toString();
}

export function useMobile() {
  const q = "(max-width: 767px)";
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => { const mq = matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener("change", f); return () => mq.removeEventListener("change", f); }, []);
  return m;
}
export type EditorProps = {
  store: Store; mode: Mode; name: string;
  onRename?: (name: string) => void;
  status?: React.ReactNode; banner?: React.ReactNode; topRight?: React.ReactNode;
  menuTop?: MenuItem[]; menuBottom?: MenuItem[];
  library: LibraryApi;
  welcome?: React.ReactNode;
  onPointer?: (x: number, y: number, button: "up" | "down") => void;
  /** Replace the canvas with an opened file (default: ask, then replace — undoable). */
  onOpen?: (r: Restored) => void;
  onSave?: () => void;
};

export function Editor(p: EditorProps) {
  const s = p.store;
  const [, force] = useReducer(x => x + 1, 0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mobile = useMobile();
  const [dialog, setDialog] = useState<null | "export" | "help">(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryAdd, setLibraryAdd] = useState(false);
  const [mobileStyle, setMobileStyle] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(themePref());
  const textRef = useRef<{ id: string; before: Snap } | null>(null);
  const onPointerRef = useRef(p.onPointer);
  const c = useMemo(() => new Controller(s, {
    openImagePicker: at => insertImageFromPicker(at),
    openText: id => openText(id),
    onToast: m => toast(m),
    onPointer: (x, y, b) => onPointerRef.current?.(x, y, b),
    command: name => command(name),
  }), [s]);

  useLayoutEffect(() => {
    onPointerRef.current = p.onPointer;
    if (c.lastPointer) p.onPointer?.(...c.lastPointer, s.dragging ? "down" : "up");
  }, [p.onPointer, c, s]);

  useEffect(() => s.subscribe(force), [s]);
  useEffect(() => {
    let selection = JSON.stringify([...s.selected]);
    return s.subscribe(() => {
      const next = JSON.stringify([...s.selected]);
      if (next === selection) return;
      selection = next;
      if (c.lastPointer) onPointerRef.current?.(...c.lastPointer, s.dragging ? "down" : "up");
    });
  }, [s, c]);
  // The editor root is fixed to the screen and must never scroll: a scrolled root carries the toolbar,
  // menus and canvas off-screen (mobile: revealing a caret, the on-screen keyboard). Put it back if anything does.
  useEffect(() => {
    const w = wrapRef.current!; const reset = () => { if (w.scrollLeft || w.scrollTop) { w.scrollLeft = 0; w.scrollTop = 0; } };
    w.addEventListener("scroll", reset); return () => w.removeEventListener("scroll", reset);
  }, []);
  // start with the drawing in view
  useEffect(() => { requestAnimationFrame(() => { if (s.live().length) c.fit(s.live(), 1); }); }, [s, c]);
  useEffect(() => {
    const apply = () => { s.theme = resolvedTheme(); setTheme(themePref()); s.notify(); };
    apply(); window.addEventListener("themechange", apply); return () => window.removeEventListener("themechange", apply);
  }, [s]);

  // ---- canvas sizing and painting
  useLayoutEffect(() => {
    const cv = canvasRef.current!; let raf = 0;
    const unbindPinch = c.pinch.bind(cv);
    const draw = () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(cv, s, c); });
    };
    const resize = () => {
      const r = cv.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
      c.rect = r; cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr)); paint(cv, s, c);
    };
    const ro = new ResizeObserver(resize); ro.observe(cv); resize();
    const off = s.onRender(draw);
    document.fonts?.ready.then(draw);
    return () => { unbindPinch(); ro.disconnect(); off(); cancelAnimationFrame(raf); };
  }, [s, c]);

  // ---- keyboard, clipboard, wheel
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.closest("input,textarea,select,[contenteditable=true]") !== null);
    const modalOpen = () => !!document.querySelector(".modal-bg,.menu");
    const down = (e: KeyboardEvent) => { if (typing(e.target) || modalOpen() || s.editingText) return; if (c.keyDown(e)) e.preventDefault(); };
    const up = (e: KeyboardEvent) => c.keyUp(e);
    const copy = (e: ClipboardEvent) => {
      if (typing(e.target) || s.editingText || !s.selected.size) return;
      const els = sortByIndex(s.selectedElements());
      const files: Record<string, unknown> = {}; for (const el of els) { const f = (el as any).fileId && s.files[(el as any).fileId]; if (f) files[f.id] = f; }
      e.clipboardData?.setData("text/plain", JSON.stringify({ type: CLIP_TYPE, elements: els, files }));
      e.preventDefault();
      if (e.type === "cut" && !s.readOnly) c.deleteIds(new Set(s.selected));
    };
    const paste = async (e: ClipboardEvent) => {
      if (typing(e.target) || s.editingText || s.readOnly) return;
      const dt = e.clipboardData; if (!dt) return;
      const img = [...dt.files].find(f => f.type.startsWith("image/"));
      e.preventDefault();
      if (img) return insertImage(img, c.lastPointer ?? c.viewportCenter());
      const text = dt.getData("text/plain");
      try {
        const data = JSON.parse(text);
        if (data?.type === CLIP_TYPE || data?.type === "excalidraw/clipboard" || data?.type === "excalidraw") { pasteElements(restoreElements(data.elements || []).elements, restoreFiles(data.files)); return; }
      } catch {}
      if (text.trim()) pasteText(text.slice(0, 20000));
    };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    document.addEventListener("copy", copy); document.addEventListener("cut", copy); document.addEventListener("paste", paste);
    const cv = canvasRef.current!; const wheel = (e: WheelEvent) => c.wheel(e);
    cv.addEventListener("wheel", wheel, { passive: false });
    // test/debug hook, set only once the keyboard and clipboard listeners are in place
    (window as any).__whiteboard = { getElements: () => s.live(), getAppState: () => ({ ...s.appState, ...s.view, theme: s.theme, tool: s.tool, selected: [...s.selected] }), store: s };
    return () => { delete (window as any).__whiteboard; window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); document.removeEventListener("copy", copy); document.removeEventListener("cut", copy); document.removeEventListener("paste", paste); cv.removeEventListener("wheel", wheel); };
  }, [s, c]);

  // ---- commands
  function command(name: string) {
    if (name === "export") setDialog("export");
    else if (name === "help") setDialog("help");
    else if (name === "toggle-theme") setThemePref(resolvedTheme() === "dark" ? "light" : "dark");
    else if (name === "open") openFile();
    else if (name === "save") p.onSave ? p.onSave() : saveToFile();
  }
  async function openFile() {
    if (s.readOnly) return;
    const f = await pickFile(".excalidraw,.json,.excalidrawlib,application/json,application/vnd.excalidraw+json"); if (!f) return;
    await openFileObject(f);
  }
  async function openFileObject(f: File) {
    const text = await f.text();
    try {
      if (/\.excalidrawlib$/i.test(f.name) || text.includes('"excalidrawlib"')) { const items = parseLibraryFile(text); const cur = await p.library.load(); await p.library.save([...items, ...cur]); toast(`Added ${items.length} item${items.length === 1 ? "" : "s"} to your library`); setLibraryOpen(true); return; }
      const r = parseSceneFile(text);
      if (p.onOpen) p.onOpen(r);
      else {
        if (s.live().length && !(await confirm("Replace this drawing?", "Opening a file replaces what is on the canvas. You can undo this.", "Replace", false))) return;
        s.load(r.elements, r.appState, r.files, true); c.fit(s.live());
      }
      if (r.skipped) toast(`${r.skipped} element${r.skipped === 1 ? "" : "s"} of a kind this app doesn't draw (such as frames or embeds) ${r.skipped === 1 ? "was" : "were"} left out`, 7000);
    } catch (e: any) { toast(e instanceof ImportError ? e.message : "That file could not be opened"); }
  }
  function saveToFile() {
    download(`${safeFileName(p.name)}.excalidraw`, serializeScene(s.elements, s.appState, s.files, location.origin), "application/vnd.excalidraw+json");
  }
  async function insertImageFromPicker(at?: Point) {
    if (s.readOnly) return;
    const f = await pickFile("image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp,image/avif");
    if (f) await insertImage(f, at ?? c.viewportCenter());
  }
  async function insertImage(file: File | Blob, at: Point) {
    try {
      const r = await readImageFile(file);
      s.addFiles([r.file], false);
      const el = placeImage(s, r.file, r.width, r.height, at, c.rect.width, c.rect.height);
      s.commit([...s.elements, el]); s.tool = "selection"; s.select([el.id], false);
    } catch (e: any) { toast(e.message); }
  }
  function pasteElements(els: Element[], files: Record<string, any>, at?: Point) {
    if (!els.length) return;
    s.addFiles(files, false);
    const b = commonBounds(els)!; const [x, y] = at ?? c.lastPointer ?? c.viewportCenter();
    const dx = x - (b.x1 + b.x2) / 2, dy = y - (b.y1 + b.y2) / 2; const gm = new Map<string, string>(); const idMap = new Map<string, string>();
    const copies = els.map(e => { const d = duplicate(e, dx, dy, s.now(), gm); idMap.set(e.id, d.id); return { ...d, index: null }; });
    // keep arrow bindings inside the pasted set
    const fixed = copies.map(e => {
      const a = e as any; if (e.type !== "arrow") return e;
      const src = els[copies.indexOf(e)] as any;
      return { ...a, startBinding: src.startBinding && idMap.has(src.startBinding.elementId) ? { ...src.startBinding, elementId: idMap.get(src.startBinding.elementId) } : null, endBinding: src.endBinding && idMap.has(src.endBinding.elementId) ? { ...src.endBinding, elementId: idMap.get(src.endBinding.elementId) } : null };
    }) as Element[];
    s.commit([...s.elements, ...fixed]); s.tool = "selection"; s.select(fixed.map(e => e.id), false);
  }
  function pasteText(text: string) {
    const [x, y] = c.lastPointer ?? c.viewportCenter();
    const clean = text.replace(/\r\n?/g, "\n");
    const base = newElement("text", x, y, s.style, s.now(), { lineHeight: LINE_HEIGHT(s.style.fontFamily) } as any) as TextElement;
    const m = measureText(clean, base.fontSize, base.fontFamily, base.lineHeight);
    const el = { ...base, text: clean, originalText: clean, width: m.width, height: m.height, x: x - m.width / 2, y: y - m.height / 2 };
    s.commit([...s.elements, el]); s.tool = "selection"; s.select([el.id], false);
  }
  const insertLibraryItem = (it: LibraryItem) => { pasteElements(restoreElements(it.elements).elements, {}, c.viewportCenter()); };

  // ---- text editing
  function openText(id: string) {
    const el = s.get(id) as TextElement; if (!el || s.readOnly) return;
    const before: Snap = { ...s.snap(), elements: el.text ? s.elements : s.elements.filter(e => e.id !== id) };
    textRef.current = { id, before }; s.editingText = id; s.selected.clear(); s.notify();
  }
  const finishText = (value: string) => {
    const t = textRef.current; if (!t) return; textRef.current = null; c.finishText(t.id, value, t.before);
    // iOS can leave the page scrolled after its keyboard closes; the app is a fixed, full-screen surface.
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  };

  // ---- pointer
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
    // Touch contacts already have implicit capture. Keep explicit capture for pen and mouse drags.
    if (e.pointerType !== "touch") e.currentTarget.setPointerCapture(e.pointerId);
    setMobileStyle(false); c.lastPointer = c.toScene(e.clientX, e.clientY);
    c.pointerDown(e.nativeEvent); s.dragging = !!c.drag;
  };
  const onPointerMove = (e: React.PointerEvent) => { c.lastPointer = c.toScene(e.clientX, e.clientY); c.pointerMove(e.nativeEvent); };
  const onPointerUp = (e: React.PointerEvent) => {
    c.pointerUp(e.nativeEvent); s.dragging = false;
    c.lastPointer = c.toScene(e.clientX, e.clientY);
    onPointerRef.current?.(...c.lastPointer, "up");
  };
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault(); if (s.readOnly) return;
    const [x, y] = c.toScene(e.clientX, e.clientY); const hit = c.hitAt(x, y, true);
    if (hit && !s.selected.has(hit.id) && !hit.locked) s.select([hit.id]);
    const sel = s.selected.size > 0;
    const items: MenuItem[] = sel ? [
      { label: "Cut", onClick: () => document.execCommand("cut") }, { label: "Copy", onClick: () => document.execCommand("copy") },
      { label: "Copy styles", onClick: () => c.copyStyles() }, { label: "Paste styles", onClick: () => c.pasteStyles(), disabled: !c.copiedStyle },
      { separator: true, label: "" },
      { label: "Duplicate", onClick: () => c.duplicateSelection() },
      ...(s.selected.size > 1 ? [{ label: "Group", onClick: () => c.groupSelection() }] : []),
      ...(s.selectedElements().some(e => e.groupIds.length) ? [{ label: "Ungroup", onClick: () => c.ungroupSelection() }] : []),
      { label: "Bring to front", onClick: () => c.zorder("front") }, { label: "Send to back", onClick: () => c.zorder("back") },
      { label: "Flip horizontal", onClick: () => c.flipSel("h") }, { label: "Flip vertical", onClick: () => c.flipSel("v") },
      { label: "Add to library", onClick: () => { setLibraryOpen(true); setLibraryAdd(true); } },
      { label: "Lock", onClick: () => c.toggleLock() },
      { separator: true, label: "" }, { label: "Delete", danger: true, onClick: () => c.deleteIds(new Set(s.selected)) },
    ] : [
      { label: "Select all", onClick: () => c.selectAll() },
      ...(s.live().some(e => e.locked) ? [{ label: "Unlock all", onClick: () => c.unlockAll() }] : []),
      { label: s.appState.gridModeEnabled ? "Hide grid" : "Show grid", onClick: () => s.setAppState({ gridModeEnabled: !s.appState.gridModeEnabled }) },
      { label: "Zoom to fit all", onClick: () => c.fit(s.live()) },
    ];
    showMenu(e, items);
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); if (s.readOnly) return;
    const f = e.dataTransfer.files[0]; if (!f) return;
    if (f.type.startsWith("image/")) return insertImage(f, c.toScene(e.clientX, e.clientY));
    await openFileObject(f);
  };

  // ---- UI
  const menuItems: MenuItem[] = [
    ...(p.menuTop ?? []),
    ...(!s.readOnly ? [{ label: "Open…", icon: "open", onClick: openFile }] : []),
    { label: "Save to file…", icon: "save", onClick: saveToFile },
    { label: "Export image…", icon: "download", onClick: () => setDialog("export") },
    { label: "Help", icon: "help", onClick: () => setDialog("help") },
    ...(!s.readOnly ? [{ label: "Reset the canvas", icon: "reset", danger: true, onClick: async () => { if (await confirm("Clear the canvas?", "This removes everything on the canvas. You can undo it.", "Clear")) c.deleteIds(new Set(s.live().map(e => e.id))); } }] : []),
    { separator: true, label: "" },
    ...(!s.readOnly ? [{ label: `Grid and snapping: ${s.appState.gridModeEnabled ? "on" : "off"} (Ctrl+')`, icon: "grid", onClick: () => s.setAppState({ gridModeEnabled: !s.appState.gridModeEnabled }) }] : []),
    { label: `Theme: ${theme === "system" ? "System" : theme === "dark" ? "Dark" : "Light"} (change)`, icon: theme === "dark" ? "moon" : "sun", onClick: () => setThemePref(theme === "light" ? "dark" : theme === "dark" ? "system" : "light") },
    ...(p.menuBottom ?? []),
  ];
  const openMenu = (e: React.MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); showMenu({ clientX: r.left, clientY: r.bottom + 6 }, menuItems); };
  const editing = s.editingText ? (s.get(s.editingText) as TextElement | undefined) : undefined;
  const style = showsStylePanel(s) && !s.editingText;
  const cursor = c.spacePan || s.tool === "hand" || s.readOnly ? "grab" : s.tool === "selection" ? "default" : s.tool === "eraser" ? "cell" : s.tool === "text" ? "text" : "crosshair";
  const empty = s.live().length === 0;

  return (
    <div className={`editor ${mobile ? "is-mobile" : ""} ${s.theme === "dark" ? "is-dark" : ""}`} ref={wrapRef}>
      <canvas ref={canvasRef} className="board" data-testid="canvas" style={{ cursor }} tabIndex={0} aria-label="Drawing canvas"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={e => c.pointerCancel(e.nativeEvent)}
        onContextMenu={onContextMenu} onDragOver={e => e.preventDefault()} onDrop={onDrop}
        onDoubleClick={e => e.preventDefault()} />
      {[...s.collaborators.values()].filter(u => u.x !== undefined).map(u => {
        const [x, y] = c.toScreen(u.x!, u.y!);
        return <div key={u.id} className={`cursor ${u.idle ? "is-idle" : ""}`} style={{ transform: `translate(${x}px, ${y}px)`, color: u.color }} aria-hidden="true">
          <svg width="16" height="20" viewBox="0 0 16 20"><path d="M1 1l13 10-6 1-3 6z" fill="currentColor" stroke="#fff" strokeWidth="1.2" /></svg>
          <span className="cursor-name" style={{ background: u.color }}>{u.name}</span>
        </div>;
      })}
      {empty && p.welcome && !s.editingText && <div className="welcome" aria-hidden={false}>{p.welcome}</div>}

      <div className="top-left">
        <button className="icon-btn menu-btn" aria-label="Main menu" data-testid="main-menu" onClick={openMenu}><Icon name="menu" /></button>
        <div className="title-block">
          {p.onRename && !s.readOnly ? <button className="scene-name" title="Rename" onClick={() => p.onRename!(p.name)}>{p.name}</button> : <span className="scene-name static">{p.name}</span>}
          {p.status}
        </div>
      </div>
      {!s.readOnly && <div className="toolbar" role="toolbar" aria-label="Tools">
        <button className={`tool lock ${s.toolLocked ? "is-active" : ""}`} aria-pressed={s.toolLocked} aria-label="Keep selected tool active after drawing" title="Keep selected tool active after drawing — Q" onClick={() => { s.toolLocked = !s.toolLocked; s.notify(); }}><Icon name={s.toolLocked ? "lock" : "unlock"} /></button>
        <span className="toolbar-sep" />
        {TOOLS.map(t => <button key={t.tool} className={`tool ${s.tool === t.tool ? "is-active" : ""}`} aria-pressed={s.tool === t.tool} aria-label={t.label} title={`${t.label} — ${t.key}`} data-tool={t.tool}
          onClick={() => (t.tool === "image" ? insertImageFromPicker() : s.setTool(t.tool))}><Icon name={t.icon} size={18} />{!mobile && <span className="tool-key">{t.key}</span>}</button>)}
      </div>}
      <div className="top-right">
        {p.topRight}
        <button className={`btn library-btn ${libraryOpen ? "is-active" : ""}`} aria-label="Library" aria-pressed={libraryOpen} onClick={() => setLibraryOpen(o => !o)}><Icon name="library" />{!mobile && <span>Library</span>}</button>
      </div>
      {p.banner && <div className="banner" role="status">{p.banner}</div>}

      {style && (!mobile || mobileStyle) && <div className={`panel style-wrap ${mobile ? "sheet" : ""}`}>
        {mobile && <button className="icon-btn sheet-close" aria-label="Close style" onClick={() => setMobileStyle(false)}><Icon name="x" /></button>}
        <StylePanel s={s} c={c} />
      </div>}
      {mobile && style && !mobileStyle && <button className="btn style-toggle" aria-label="Style" onClick={() => setMobileStyle(true)}><Icon name="palette" /> Style</button>}

      <div className="bottom-left">
        <div className="zoom" role="group" aria-label="Zoom">
          <button className="icon-btn" aria-label="Zoom out" title="Zoom out — Ctrl -" onClick={() => c.zoomBy(-1)}><Icon name="minus" /></button>
          <button className="zoom-pct" aria-label="Reset zoom" title="Reset zoom — Ctrl 0" onClick={() => c.zoomAt(1, c.rect.width / 2, c.rect.height / 2)}>{zoomPercent(s.view.zoom)}%</button>
          <button className="icon-btn" aria-label="Zoom in" title="Zoom in — Ctrl +" onClick={() => c.zoomBy(1)}><Icon name="plus" /></button>
          <span className="toolbar-sep" aria-hidden="true" />
          <button className="icon-btn" aria-label="Fit drawing" title="Fit drawing — Shift + 1" onClick={() => c.fit(s.live())}><Icon name="fit" /></button>
          <button className="icon-btn" aria-label="Go to origin" title="Go to origin — Home" onClick={() => c.goToOrigin()}><Icon name="origin" /></button>
        </div>
        {!s.readOnly && <div className="undo" role="group" aria-label="History">
          <button className="icon-btn" aria-label="Undo" title="Undo — Ctrl Z" disabled={!s.history.canUndo} onClick={() => s.undo()}><Icon name="undo" /></button>
          <button className="icon-btn" aria-label="Redo" title="Redo — Ctrl Shift Z" disabled={!s.history.canRedo} onClick={() => s.redo()}><Icon name="redo" /></button>
        </div>}
        {c.multi && <span className="hint">Click to add points · Enter or double-click to finish</span>}
      </div>
      {!mobile && <button className="help-btn icon-btn" aria-label="Help" title="Help — ?" onClick={() => setDialog("help")}><Icon name="help" /></button>}

      {editing && <TextEditor key={editing.id} el={editing} c={c} s={s} onDone={finishText} />}
      {libraryOpen && <LibraryPanel s={s} api={p.library} addRequest={libraryAdd} onAddHandled={() => setLibraryAdd(false)} onInsert={insertLibraryItem} onClose={() => setLibraryOpen(false)}
        onImport={async () => { const f = await pickFile(".excalidrawlib,application/json"); if (!f) return null; try { return parseLibraryFile(await f.text()); } catch (e: any) { toast(e.message); return null; } }}
        onExport={items => download("library.excalidrawlib", serializeLibrary(items, location.origin), "application/vnd.excalidrawlib+json")} />}
      {dialog === "export" && <ExportDialog s={s} name={p.name} onClose={() => setDialog(null)} />}
      {dialog === "help" && <HelpDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Canvas background colour picker for the main menu. */
export function canvasBackgroundItems(s: Store): MenuItem[] {
  return CANVAS_SWATCHES.map(col => ({ label: `Canvas background ${col}${s.appState.viewBackgroundColor === col ? " ✓" : ""}`, onClick: () => s.setAppState({ viewBackgroundColor: col }) }));
}

function TextEditor({ el, c, s, onDone }: { el: TextElement; c: Controller; s: Store; onDone: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const [size, setSize] = useState(() => measureText(el.text || " ", el.fontSize, el.fontFamily, el.lineHeight));
  // Focus without letting the browser scroll anything to reveal the field.
  useEffect(() => { const t = ref.current!; t.value = el.text; t.focus({ preventScroll: true }); t.select(); }, []);
  // The browser reveals an off-screen caret by scrolling the nearest scroll container. That is this
  // box (overflow: hidden, the canvas' size), never the editor root, so the toolbar and menus can't be
  // carried off-screen. Hand the offset to the canvas instead (plus a little room) and put the box back:
  // the canvas pans to follow the caret, as in Excalidraw.
  useEffect(() => {
    const box = boxRef.current!;
    const onScroll = () => {
      const { scrollLeft, scrollTop } = box; if (!scrollLeft && !scrollTop) return;
      box.scrollLeft = 0; box.scrollTop = 0;
      const z = s.view.zoom;
      const panX = scrollLeft && scrollLeft + CARET_FOLLOW_PADDING, panY = scrollTop && scrollTop + CARET_FOLLOW_PADDING;
      s.setView({ scrollX: s.view.scrollX - panX / z, scrollY: s.view.scrollY - panY / z });
    };
    box.addEventListener("scroll", onScroll); return () => box.removeEventListener("scroll", onScroll);
  }, [s]);
  const finish = () => { if (done.current) return; done.current = true; onDone(ref.current?.value ?? ""); };
  const [x, y] = c.toScreen(el.x, el.y); const z = s.view.zoom;
  const left = el.textAlign === "center" && el.width > 1 ? x + ((el.width - size.width) / 2) * z : el.textAlign === "right" && el.width > 1 ? x + (el.width - size.width) * z : x;
  return (
    <div ref={boxRef} className="text-editor-box" data-testid="text-editor-box">
      <textarea ref={ref} className="text-editor" aria-label="Text" spellCheck={false} wrap="off"
        style={{ left, top: y, font: fontString({ fontSize: el.fontSize * z, fontFamily: el.fontFamily }), lineHeight: el.lineHeight, color: el.strokeColor, textAlign: el.textAlign,
          width: (size.width + 4) * z + 8, height: size.height * z + 4, transform: el.angle ? `rotate(${el.angle}rad)` : undefined, transformOrigin: "center", opacity: el.opacity / 100 }}
        onInput={e => { const ta = e.target as HTMLTextAreaElement; ta.scrollTop = 0; ta.scrollLeft = 0; setSize(measureText(ta.value || " ", el.fontSize, el.fontFamily, el.lineHeight)); }}
        onKeyDown={e => { if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); finish(); } e.stopPropagation(); }}
        onBlur={finish} />
    </div>
  );
}
/** Room left between a revealed caret and the canvas edge, in screen pixels (Excalidraw: 5). */
export const CARET_FOLLOW_PADDING = 5;
export { isText, settings };
