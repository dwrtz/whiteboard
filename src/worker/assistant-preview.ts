import { initWasm, Resvg } from "@resvg/resvg-wasm";
import wasm from "@resvg/resvg-wasm/index_bg.wasm";
import font from "./fonts/Kalam-Regular.bin";
import { exportBounds, exportSvg } from "../shared/scene-svg";
import { decryptText, toB64 } from "../shared/crypto";
import { restoreFiles } from "../shared/restore";
import { isImage, hasPoints, type BinaryFiles, type Element } from "../shared/types";

let initialized: Promise<void> | undefined;

export async function renderPreview(elements: Element[], roomId: string, key: string, bucket: R2Bucket) {
  if (elements.length > 300 || elements.reduce((sum, e) => sum + (hasPoints(e) ? e.points.length : 0), 0) > 30000) {
    throw new Error("Select fewer elements for the preview.");
  }
  const box = exportBounds(elements);
  const longest = box ? Math.max(box.x2 - box.x1, box.y2 - box.y1, 1) : 100;
  if (!Number.isFinite(longest) || longest > 100000) {
    throw new Error("Select fewer elements for the preview.");
  }
  const files: BinaryFiles = {};
  let total = 0;
  const missingImages: string[] = [];
  for (const id of new Set(elements.filter(isImage).map(e => e.fileId).filter((v): v is string => !!v))) {
    if (!/^[a-f0-9]{40}$/.test(id)) continue;
    const blob = await bucket.get("rooms/" + roomId + "/" + id);
    if (!blob) { missingImages.push(id); continue; }
    total += blob.size;
    if (total > 6 * 1024 * 1024) throw new Error("Select fewer images for the preview.");
    const data = JSON.parse(await decryptText(key, new Uint8Array(await blob.arrayBuffer())));
    const file = restoreFiles({ [id]: data })[id];
    if (file) files[id] = file;
    else missingImages.push(id);
  }
  initialized ??= initWasm(wasm);
  await initialized;
  const svg = exportSvg(elements, files, { background: true, backgroundColor: "#ffffff", scale: Math.min(1, 960 / longest), dark: false, cachePaths: false });
  const renderer = new Resvg(svg, {font: {fontBuffers: [new Uint8Array(font)], defaultFontFamily: "Kalam", sansSerifFamily: "Kalam"}});
  try {
    const image = renderer.render();
    try { return { data: toB64(image.asPng()), missingImages }; } finally { image.free(); }
  } finally { renderer.free(); }
}
