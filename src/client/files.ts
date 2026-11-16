import type { BinaryFile, ImageElement, Point } from "../shared/types";
import { sha1Hex, toB64, fromB64 } from "../shared/crypto";
import { IMAGE_TYPES, LIMITS } from "../shared/limits";
import { newElement } from "../shared/elements";
import type { Store } from "./store";

export const MAX_IMAGE_SIDE = 1440;
export function dataURLToBytes(u: string): { mime: string; bytes: Uint8Array } {
  const i = u.indexOf(","); return { mime: u.slice(5, u.indexOf(";")), bytes: fromB64(u.slice(i + 1)) };
}
export const bytesToDataURL = (mime: string, b: Uint8Array) => `data:${mime};base64,${toB64(b)}`;
function loadImg(src: string) { return new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That image could not be read")); i.src = src; }); }

/** Read an image file: big photos are scaled down to 1440 px on the long side; the result must be ≤ 4 MB.
 *  The file id is the SHA-1 of the stored bytes. */
export async function readImageFile(file: Blob): Promise<{ file: BinaryFile; width: number; height: number }> {
  const mime = (file.type || "").toLowerCase();
  if (!IMAGE_TYPES.includes(mime)) throw new Error("Only PNG, JPEG, GIF, WebP, SVG, BMP and AVIF images can be added");
  let bytes = new Uint8Array(await file.arrayBuffer()); let outMime = mime;
  let img = await loadImg(bytesToDataURL(mime, bytes));
  let w = img.naturalWidth || 300, h = img.naturalHeight || 150;
  if (mime !== "image/svg+xml" && mime !== "image/gif" && Math.max(w, h) > MAX_IMAGE_SIDE) {
    const sc = MAX_IMAGE_SIDE / Math.max(w, h); w = Math.round(w * sc); h = Math.round(h * sc);
    const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    outMime = mime === "image/jpeg" ? "image/jpeg" : "image/png";
    const blob = await new Promise<Blob>(ok => c.toBlob(b => ok(b!), outMime, 0.9));
    bytes = new Uint8Array(await blob.arrayBuffer());
  }
  if (bytes.length > LIMITS.fileBytes) throw new Error("Images can be up to 4 MB");
  const id = await sha1Hex(bytes);
  return { file: { id, mimeType: outMime, dataURL: bytesToDataURL(outMime, bytes), created: Date.now() }, width: w, height: h };
}
/** Put an image on the canvas centred at `at`, no bigger than half the visible area. */
export function placeImage(s: Store, f: BinaryFile, width: number, height: number, at: Point, viewW: number, viewH: number): ImageElement {
  const max = Math.min(viewW, viewH) / s.view.zoom / 2;
  const sc = Math.min(1, max / Math.max(width, height));
  const w = Math.max(1, width * sc), h = Math.max(1, height * sc);
  return newElement("image", at[0] - w / 2, at[1] - h / 2, s.style, s.now(), { fileId: f.id, status: "saved", width: w, height: h, roundness: null } as any) as ImageElement;
}
export function download(name: string, data: Blob | string, mime = "application/octet-stream") {
  const blob = typeof data === "string" ? new Blob([data], { type: mime }) : data;
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
export function pickFile(accept: string): Promise<File | null> {
  return new Promise(ok => {
    const i = document.createElement("input"); i.type = "file"; i.accept = accept; i.style.display = "none";
    i.onchange = () => { ok(i.files?.[0] ?? null); i.remove(); };
    i.addEventListener("cancel", () => { ok(null); i.remove(); });
    document.body.appendChild(i); i.click();
  });
}
export const safeFileName = (n: string) => (n.replace(/[\\/:*?"<>|]+/g, " ").trim() || "drawing").slice(0, 80);
