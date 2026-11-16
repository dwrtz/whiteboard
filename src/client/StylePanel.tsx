import React from "react";
import type { Element, ElementType, FillStyle, StrokeStyle, Arrowhead, TextAlign } from "../shared/types";
import { isText, isLinear, FONT, FONT_SIZES } from "../shared/types";
import type { Style } from "../shared/elements";
import type { Store } from "./store";
import type { Controller } from "./controller";
import { Icon } from "./ui";

export const STROKE_SWATCHES = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"];
export const BG_SWATCHES = ["transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99"];
export const CANVAS_SWATCHES = ["#ffffff", "#f8f9fa", "#f5faff", "#fffce8", "#fdf8f6"];

function Swatches({ label, colors, value, onPick }: { label: string; colors: string[]; value: string; onPick: (c: string) => void }) {
  const custom = !colors.includes(value);
  return (
    <fieldset className="sp-group"><legend>{label}</legend>
      <div className="swatches" role="radiogroup" aria-label={label}>
        {colors.map(c => <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c === "transparent" ? "Transparent" : c} title={c}
          className={`swatch ${c === "transparent" ? "is-transparent" : ""} ${value === c ? "is-active" : ""}`} style={{ background: c === "transparent" ? undefined : c }} onClick={() => onPick(c)} />)}
        <span className="sp-sep" />
        <label className={`swatch custom ${custom ? "is-active" : ""}`} title="Custom colour" style={{ background: custom && value !== "transparent" ? value : undefined }}>
          <input type="color" aria-label={`${label}: custom colour`} value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={e => onPick(e.target.value)} />
        </label>
      </div>
    </fieldset>
  );
}
function Choice<T extends string | number | null>({ label, value, options, onPick }: { label: string; value: T; options: { v: T; label: string; icon?: React.ReactNode; active?: boolean }[]; onPick: (v: T, ev: React.MouseEvent) => void }) {
  return (
    <fieldset className="sp-group"><legend>{label}</legend>
      <div className="choice" role="radiogroup" aria-label={label}>
        {options.map(o => <button key={String(o.v)} type="button" role="radio" aria-checked={o.active ?? value === o.v} title={o.label} aria-label={o.label}
          className={`choice-btn ${(o.active ?? value === o.v) ? "is-active" : ""}`} onClick={ev => onPick(o.v, ev)}>{o.icon ?? o.label}</button>)}
      </div>
    </fieldset>
  );
}
const svg = (d: string, extra: React.SVGProps<SVGPathElement> = {}) => <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeLinecap="round" {...extra} /></svg>;
const ARROWHEADS: { v: Arrowhead | null; label: string }[] = [
  { v: null, label: "None" }, { v: "arrow", label: "Arrow" }, { v: "triangle", label: "Triangle" }, { v: "triangle_outline", label: "Triangle outline" },
  { v: "bar", label: "Bar" }, { v: "circle", label: "Circle" }, { v: "circle_outline", label: "Circle outline" }, { v: "diamond", label: "Diamond" },
];

/** Style options for the selection, or for the next element of the active tool. */
export function StylePanel({ s, c }: { s: Store; c: Controller }) {
  const sel = s.selectedElements();
  const types = new Set<ElementType | string>(sel.length ? sel.map(e => e.type) : [s.tool]);
  const first: Element | null = sel[0] ?? null;
  const v = <K extends keyof Style>(k: K): Style[K] => {
    if (first && k in first) {
      if (k === "roundness") return (first.roundness ? "round" : "sharp") as Style[K];
      return (first as any)[k];
    }
    return s.style[k];
  };
  const set = (patch: Partial<Style>) => c.applyStyle(patch);
  const has = (...t: string[]) => t.some(x => types.has(x));
  const shapes = has("rectangle", "diamond", "ellipse", "arrow", "line", "freedraw");
  const fillable = has("rectangle", "diamond", "ellipse", "line", "freedraw");
  const anyText = has("text");
  const textEl = sel.find(isText);
  const arrowEl = sel.find(e => e.type === "arrow");
  return (
    <div className="style-panel" aria-label="Style">
      {(shapes || anyText) && <Swatches label="Stroke" colors={STROKE_SWATCHES} value={v("strokeColor")} onPick={x => set({ strokeColor: x })} />}
      {fillable && <Swatches label="Background" colors={BG_SWATCHES} value={v("backgroundColor")} onPick={x => set({ backgroundColor: x })} />}
      {fillable && v("backgroundColor") !== "transparent" && <Choice<FillStyle> label="Fill" value={v("fillStyle")} onPick={(x, ev) => set({ fillStyle: x === "hachure" && ev.altKey && v("fillStyle") === "hachure" ? "zigzag" : x })} options={[
        // like Excalidraw: Alt-click Hachure (when it is already hachure) switches to zigzag, which shows on the same button
        v("fillStyle") === "zigzag"
          ? { v: "hachure", label: "Zigzag (Alt-Click)", active: true, icon: svg("M3 8l3-3 3 3 3-3 3 3 2-2 M3 14l3-3 3 3 3-3 3 3 2-2") }
          : { v: "hachure", label: "Hachure (Alt-Click)", icon: svg("M3 17L17 3 M3 11L11 3 M9 17l8-8") }, { v: "cross-hatch", label: "Cross-hatch", icon: svg("M3 17L17 3 M3 11L11 3 M9 17l8-8 M3 3l14 14 M9 3l8 8 M3 9l8 8") },
        { v: "solid", label: "Solid", icon: <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2" fill="currentColor" /></svg> },
      ]} />}
      {shapes && <Choice<number> label="Stroke width" value={v("strokeWidth")} onPick={x => set({ strokeWidth: x })} options={[
        { v: 1, label: "Thin", icon: svg("M3 10h14", { strokeWidth: 1 }) }, { v: 2, label: "Bold", icon: svg("M3 10h14", { strokeWidth: 2.5 }) }, { v: 4, label: "Extra bold", icon: svg("M3 10h14", { strokeWidth: 4 }) },
      ]} />}
      {shapes && !types.has("freedraw") && <Choice<StrokeStyle> label="Stroke style" value={v("strokeStyle")} onPick={x => set({ strokeStyle: x })} options={[
        { v: "solid", label: "Solid", icon: svg("M3 10h14", { strokeWidth: 2 }) }, { v: "dashed", label: "Dashed", icon: svg("M3 10h14", { strokeWidth: 2, strokeDasharray: "4 3" }) }, { v: "dotted", label: "Dotted", icon: svg("M3 10h14", { strokeWidth: 2, strokeDasharray: "0.5 3.5" }) },
      ]} />}
      {shapes && !types.has("freedraw") && <Choice<number> label="Sloppiness" value={v("roughness")} onPick={x => set({ roughness: x })} options={[
        { v: 0, label: "Architect", icon: svg("M3 14c4-8 10-8 14 0", { strokeWidth: 1.5 }) }, { v: 1, label: "Artist", icon: svg("M3 14c4-8 10-8 14 0 M3 13c4-7 9-8 14 1", { strokeWidth: 1.2 }) }, { v: 2, label: "Cartoonist", icon: svg("M3 14c3-9 10-7 14 0 M2 12c5-6 10-9 15 2 M4 15c4-8 9-6 12-1", { strokeWidth: 1.1 }) },
      ]} />}
      {has("rectangle", "diamond", "line", "arrow") && <Choice<"sharp" | "round"> label="Edges" value={v("roundness")} onPick={x => set({ roundness: x })} options={[
        { v: "sharp", label: "Sharp", icon: svg("M4 16V4h12", { strokeWidth: 2 }) }, { v: "round", label: "Round", icon: svg("M4 16V10a6 6 0 0 1 6-6h6", { strokeWidth: 2 }) },
      ]} />}
      {has("arrow") && <fieldset className="sp-group"><legend>Arrowheads</legend><div className="arrowheads">
        <label>Start <select aria-label="Start arrowhead" value={String(arrowEl ? (arrowEl as any).startArrowhead : s.style.startArrowhead)} onChange={e => set({ startArrowhead: e.target.value === "null" ? null : (e.target.value as Arrowhead) })}>{ARROWHEADS.map(a => <option key={String(a.v)} value={String(a.v)}>{a.label}</option>)}</select></label>
        <label>End <select aria-label="End arrowhead" value={String(arrowEl ? (arrowEl as any).endArrowhead : s.style.endArrowhead)} onChange={e => set({ endArrowhead: e.target.value === "null" ? null : (e.target.value as Arrowhead) })}>{ARROWHEADS.map(a => <option key={String(a.v)} value={String(a.v)}>{a.label}</option>)}</select></label>
      </div></fieldset>}
      {anyText && <>
        <Choice<number> label="Font size" value={textEl ? textEl.fontSize : s.style.fontSize} onPick={x => set({ fontSize: x })} options={Object.entries(FONT_SIZES).map(([k, n]) => ({ v: n, label: k }))} />
        <Choice<number> label="Font family" value={textEl ? textEl.fontFamily : s.style.fontFamily} onPick={x => set({ fontFamily: x })} options={[
          { v: FONT.hand, label: "Hand-drawn", icon: <span className="ff-hand">Aa</span> }, { v: FONT.normal, label: "Normal", icon: <span className="ff-normal">Aa</span> }, { v: FONT.code, label: "Code", icon: <span className="ff-code">Aa</span> },
        ]} />
        <Choice<TextAlign> label="Text align" value={textEl ? textEl.textAlign : s.style.textAlign} onPick={x => set({ textAlign: x })} options={[
          { v: "left", label: "Left", icon: svg("M3 5h14 M3 10h9 M3 15h12", { strokeWidth: 2 }) }, { v: "center", label: "Center", icon: svg("M3 5h14 M5.5 10h9 M4 15h12", { strokeWidth: 2 }) }, { v: "right", label: "Right", icon: svg("M3 5h14 M8 10h9 M5 15h12", { strokeWidth: 2 }) },
        ]} />
      </>}
      <fieldset className="sp-group"><legend>Opacity</legend>
        <input type="range" min={0} max={100} step={10} aria-label="Opacity" value={v("opacity")} onChange={e => set({ opacity: Number(e.target.value) })} />
      </fieldset>
      {sel.length > 0 && <>
        <fieldset className="sp-group"><legend>Layers</legend><div className="choice">
          <button className="choice-btn" title="Send to back (Ctrl+Shift+[)" aria-label="Send to back" onClick={() => c.zorder("back")}><Icon name="back" /></button>
          <button className="choice-btn" title="Send backward (Ctrl+[)" aria-label="Send backward" onClick={() => c.zorder("backward")}><Icon name="backward" /></button>
          <button className="choice-btn" title="Bring forward (Ctrl+])" aria-label="Bring forward" onClick={() => c.zorder("forward")}><Icon name="forward" /></button>
          <button className="choice-btn" title="Bring to front (Ctrl+Shift+])" aria-label="Bring to front" onClick={() => c.zorder("front")}><Icon name="front" /></button>
        </div></fieldset>
        {sel.length > 1 && <fieldset className="sp-group"><legend>Align</legend><div className="choice wrap">
          {([["left", "alignLeft", "Align left"], ["hcenter", "alignHCenter", "Center horizontally"], ["right", "alignRight", "Align right"], ["top", "alignTop", "Align top"], ["vcenter", "alignVCenter", "Center vertically"], ["bottom", "alignBottom", "Align bottom"]] as const).map(([k, icon, label]) =>
            <button key={k} className="choice-btn" title={label} aria-label={label} onClick={() => c.alignSel(k)}><Icon name={icon} /></button>)}
          {sel.length > 2 && <>
            <button className="choice-btn" title="Distribute horizontally" aria-label="Distribute horizontally" onClick={() => c.distributeSel("x")}><Icon name="distH" /></button>
            <button className="choice-btn" title="Distribute vertically" aria-label="Distribute vertically" onClick={() => c.distributeSel("y")}><Icon name="distV" /></button>
          </>}
        </div></fieldset>}
        <fieldset className="sp-group"><legend>Actions</legend><div className="choice wrap">
          <button className="choice-btn" title="Duplicate (Ctrl+D)" aria-label="Duplicate" onClick={() => c.duplicateSelection()}><Icon name="duplicate" /></button>
          <button className="choice-btn" title="Delete (Delete)" aria-label="Delete" onClick={() => c.deleteIds(new Set(s.selected))}><Icon name="trash" /></button>
          {sel.length > 1 && <button className="choice-btn" title="Group (Ctrl+G)" aria-label="Group" onClick={() => c.groupSelection()}><Icon name="group" /></button>}
          {sel.some(e => e.groupIds.length) && <button className="choice-btn" title="Ungroup (Ctrl+Shift+G)" aria-label="Ungroup" onClick={() => c.ungroupSelection()}><Icon name="ungroup" /></button>}
          <button className="choice-btn" title="Lock (Ctrl+Shift+L)" aria-label="Lock" onClick={() => c.toggleLock()}><Icon name="lock" /></button>
        </div></fieldset>
      </>}
    </div>
  );
}
export const showsStylePanel = (s: Store) => !s.readOnly && (s.selected.size > 0 || !["selection", "hand", "eraser", "image"].includes(s.tool));
void isLinear;
