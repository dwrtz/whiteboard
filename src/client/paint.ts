import type { Store } from "./store";
import type { Controller } from "./controller";
import { HANDLE } from "./controller";
import { drawElement } from "./render";
import { bounds, localBox, rotate, commonBounds } from "../shared/geometry";
import { isImage } from "../shared/types";
import { settings } from "../shared/settings";

const DARK_FILTER = "invert(93%) hue-rotate(180deg)";
/** Paint the whole canvas: background, grid, elements, then selection and other overlays. */
export function paint(canvas: HTMLCanvasElement, s: Store, c: Controller) {
  const ctx = canvas.getContext("2d")!; const dpr = window.devicePixelRatio || 1;
  const W = canvas.width / dpr, H = canvas.height / dpr; const { zoom, scrollX, scrollY } = s.view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = s.appState.viewBackgroundColor; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.scale(zoom, zoom); ctx.translate(scrollX, scrollY);
  const vx1 = -scrollX, vy1 = -scrollY, vx2 = W / zoom - scrollX, vy2 = H / zoom - scrollY;
  if (s.appState.gridModeEnabled && s.appState.gridSize) {
    const g = s.appState.gridSize; ctx.lineWidth = 1 / zoom;
    for (let x = Math.floor(vx1 / g) * g; x < vx2; x += g) { ctx.strokeStyle = Math.round(x / g) % 5 ? "rgba(0,0,0,.06)" : "rgba(0,0,0,.12)"; ctx.beginPath(); ctx.moveTo(x, vy1); ctx.lineTo(x, vy2); ctx.stroke(); }
    for (let y = Math.floor(vy1 / g) * g; y < vy2; y += g) { ctx.strokeStyle = Math.round(y / g) % 5 ? "rgba(0,0,0,.06)" : "rgba(0,0,0,.12)"; ctx.beginPath(); ctx.moveTo(vx1, y); ctx.lineTo(vx2, y); ctx.stroke(); }
  }
  for (const e of s.elements) {
    if (e.isDeleted || e.id === s.editingText) continue;
    const b = bounds(e); if (b.x2 < vx1 || b.x1 > vx2 || b.y2 < vy1 || b.y1 > vy2) continue;
    if (isImage(e) && s.theme === "dark") ctx.filter = DARK_FILTER; // cancels the page's dark filter for images
    drawElement(ctx, e, s.images, s.eraserMarked.has(e.id) ? 0.25 : 1);
    ctx.filter = "none";
  }
  // overlays (drawn in the accent colour, which the dark filter turns back into roughly itself)
  const accent = settings.accentColor; ctx.lineWidth = 1 / zoom;
  if (s.bindHint) { const e = s.get(s.bindHint); if (e) outline(ctx, e, "#4dabf7", 6 / zoom, 3 / zoom); }
  for (const p of s.collaborators.values()) if (p.selected?.length) for (const id of p.selected) { const e = s.get(id); if (e && !e.isDeleted) outline(ctx, e, p.color, 4 / zoom, 1.5 / zoom); }
  const sel = s.selectedElements();
  if (sel.length && !s.editingText) {
    ctx.strokeStyle = accent; ctx.setLineDash(sel.length > 1 ? [4 / zoom, 4 / zoom] : []);
    for (const e of sel) outline(ctx, e, accent, 4 / zoom, 1 / zoom);
    ctx.setLineDash([]);
    if (sel.length > 1 || (sel[0].groupIds.length && !s.editingGroup)) { const b = commonBounds(sel)!; const p = 8 / zoom; ctx.strokeStyle = accent; ctx.strokeRect(b.x1 - p, b.y1 - p, b.x2 - b.x1 + 2 * p, b.y2 - b.y1 + 2 * p); }
    if (!c.drag || c.drag.kind === "point") {
      const hs = HANDLE / zoom;
      for (const h of c.handles()) {
        ctx.fillStyle = "#fff"; ctx.strokeStyle = accent; ctx.lineWidth = 1.5 / zoom;
        ctx.beginPath();
        if (h.name === "rotate" || h.name.startsWith("p")) ctx.arc(h.x, h.y, hs / 2 + (h.name === "rotate" ? 0 : 1 / zoom), 0, Math.PI * 2);
        else ctx.roundRect(h.x - hs / 2, h.y - hs / 2, hs, hs, 2 / zoom);
        ctx.fill(); ctx.stroke();
      }
    }
  }
  if (s.selectionBox) {
    const b = s.selectionBox; ctx.fillStyle = hexA(accent, 0.08); ctx.strokeStyle = accent; ctx.lineWidth = 1 / zoom;
    ctx.fillRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
  }
  ctx.restore();
}
function outline(ctx: CanvasRenderingContext2D, e: Parameters<typeof localBox>[0], color: string, pad: number, width: number) {
  const b = localBox(e); const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
  const pts = [[b.x1 - pad, b.y1 - pad], [b.x2 + pad, b.y1 - pad], [b.x2 + pad, b.y2 + pad], [b.x1 - pad, b.y2 + pad]].map(([x, y]) => (e.angle ? rotate(x, y, cx, cy, e.angle) : [x, y]));
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke(); ctx.restore();
}
function hexA(hex: string, a: number) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
