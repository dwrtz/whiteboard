import type { Element, TextElement, ImageElement, BinaryFiles } from "../shared/types";
import { fontStack, isText, isImage } from "../shared/types";
import { localBox } from "../shared/geometry";
import { cornerRadius, roundedRect, shapeOf, exportBounds, EXPORT_PADDING, type ShapePath, type ExportOpts } from "../shared/scene-svg";
export * from "../shared/scene-svg";

// ---------- text ----------
let measureCtx: CanvasRenderingContext2D | null = null;
export function fontString(e: { fontSize: number; fontFamily: number }) { return `${e.fontSize}px ${fontStack(e.fontFamily)}`; }
export function measureText(text: string, fontSize: number, fontFamily: number, lineHeight: number) {
  measureCtx ??= document.createElement("canvas").getContext("2d")!;
  measureCtx.font = fontString({ fontSize, fontFamily });
  const lines = text.split("\n");
  const width = Math.max(...lines.map(l => measureCtx!.measureText(l).width), 1);
  return { width: Math.ceil(width), height: Math.ceil(lines.length * fontSize * lineHeight) };
}

// ---------- canvas ----------
export type ImageCache = Map<string, HTMLImageElement | "loading" | "error">;
export function loadImages(files: BinaryFiles, cache: ImageCache, onLoad: () => void) {
  for (const f of Object.values(files)) {
    if (cache.has(f.id)) continue;
    cache.set(f.id, "loading");
    const img = new Image(); img.onload = () => { cache.set(f.id, img); onLoad(); }; img.onerror = () => { cache.set(f.id, "error"); onLoad(); };
    img.src = f.dataURL;
  }
}
function paintPaths(ctx: CanvasRenderingContext2D, paths: ShapePath[]) {
  for (const p of paths) {
    const path = new Path2D(p.d);
    if (p.fill && p.fill !== "none") { ctx.fillStyle = p.fill; ctx.fill(path, p.fillRule ?? "nonzero"); }
    if (p.stroke && p.stroke !== "none") {
      ctx.strokeStyle = p.stroke; ctx.lineWidth = p.strokeWidth; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.setLineDash(p.dash ?? []); ctx.stroke(path); ctx.setLineDash([]);
    }
  }
}
export function drawElement(ctx: CanvasRenderingContext2D, e: Element, images: ImageCache, opacity = 1) {
  const b = localBox(e); const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
  ctx.save();
  ctx.globalAlpha = (e.opacity / 100) * opacity;
  if (e.angle) { ctx.translate(cx, cy); ctx.rotate(e.angle); ctx.translate(-cx, -cy); }
  ctx.translate(e.x, e.y);
  if (isText(e)) drawText(ctx, e);
  else if (isImage(e)) drawImage(ctx, e, images);
  else paintPaths(ctx, shapeOf(e));
  ctx.restore();
}
function drawText(ctx: CanvasRenderingContext2D, e: TextElement) {
  ctx.font = fontString(e); ctx.fillStyle = e.strokeColor; ctx.textBaseline = "alphabetic";
  const lh = e.fontSize * e.lineHeight; const lines = e.text.split("\n");
  ctx.textAlign = e.textAlign === "center" ? "center" : e.textAlign === "right" ? "right" : "left";
  const x = e.textAlign === "center" ? e.width / 2 : e.textAlign === "right" ? e.width : 0;
  lines.forEach((l, i) => ctx.fillText(l, x, i * lh + lh / 2 + e.fontSize * 0.35));
}
function drawImage(ctx: CanvasRenderingContext2D, e: ImageElement, images: ImageCache) {
  const img = e.fileId ? images.get(e.fileId) : undefined;
  ctx.save();
  if (e.scale[0] < 0 || e.scale[1] < 0) { ctx.translate(e.scale[0] < 0 ? e.width : 0, e.scale[1] < 0 ? e.height : 0); ctx.scale(Math.sign(e.scale[0]) || 1, Math.sign(e.scale[1]) || 1); }
  if (img && typeof img !== "string") {
    if (e.roundness) { const r = cornerRadius(e, Math.min(e.width, e.height)); ctx.clip(new Path2D(roundedRect(0, 0, e.width, e.height, r))); }
    ctx.drawImage(img, 0, 0, e.width, e.height);
  } else {
    ctx.fillStyle = "rgba(128,128,128,.15)"; ctx.fillRect(0, 0, e.width, e.height);
    ctx.strokeStyle = "rgba(128,128,128,.6)"; ctx.setLineDash([6, 6]); ctx.strokeRect(0, 0, e.width, e.height); ctx.setLineDash([]);
    ctx.fillStyle = "rgba(128,128,128,.9)"; ctx.font = "14px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(img === "error" ? "Image could not load" : "Loading image…", e.width / 2, e.height / 2);
  }
  ctx.restore();
}

/** Draw elements to a new canvas cropped to their bounds. Dark mode inverts colours like the editor does. */
export function exportCanvas(els: Element[], images: ImageCache, o: ExportOpts): HTMLCanvasElement {
  const live = els.filter(e => !e.isDeleted);
  const b = exportBounds(live, o.padding ?? EXPORT_PADDING) ?? { x1: 0, y1: 0, x2: 100, y2: 100 };
  const w = Math.max(1, Math.ceil((b.x2 - b.x1) * o.scale)), h = Math.max(1, Math.ceil((b.y2 - b.y1) * o.scale));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  if (o.background) { ctx.fillStyle = o.backgroundColor; ctx.fillRect(0, 0, w, h); }
  ctx.scale(o.scale, o.scale); ctx.translate(-b.x1, -b.y1);
  for (const e of live) drawElement(ctx, e, images);
  if (!o.dark) return c;
  const out = document.createElement("canvas"); out.width = w; out.height = h;
  const octx = out.getContext("2d")!; octx.filter = "invert(93%) hue-rotate(180deg)"; octx.drawImage(c, 0, 0);
  // images keep their colours in dark mode: paint them again without the filter
  octx.filter = "none"; octx.scale(o.scale, o.scale); octx.translate(-b.x1, -b.y1);
  for (const e of live) if (isImage(e)) drawElement(octx, e, images);
  return out;
}
