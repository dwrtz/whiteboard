import { test, expect, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { canvasReady, drag, elements, appState, rect, text, menu } from "./helpers";

const FIX = path.resolve("e2e/fixtures");
// listen for file choosers from the start, so interception is on before the first key press
test.beforeEach(async ({ page }) => { page.on("filechooser", () => {}); await page.goto("/"); await canvasReady(page); });
/** A PNG of the given size, drawn in the page. */
async function png(page: Page, w: number, h: number): Promise<Buffer> {
  const url = await page.evaluate(([w, h]) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d")!; const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#4c6ef5"); g.addColorStop(1, "#f08c00"); x.fillStyle = g; x.fillRect(0, 0, w, h); return c.toDataURL("image/png"); }, [w, h]);
  return Buffer.from(url.split(",")[1], "base64");
}

test("R18 export PNG and SVG, with scale, background and selection-only options", async ({ page }) => {
  await rect(page, 400, 200, 600, 300);
  await text(page, 420, 400, "Exported");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Shift+e");
  const dlg = page.getByRole("dialog", { name: "Export image" });
  await expect(dlg.getByRole("img", { name: "Preview of the exported image" })).toBeVisible();
  await dlg.getByRole("radio", { name: "3×" }).click();
  let dl = page.waitForEvent("download");
  await dlg.getByRole("button", { name: "PNG", exact: true }).click();
  let file = await dl; expect(file.suggestedFilename()).toBe("My canvas.png");
  const buf = fs.readFileSync(await file.path());
  expect(buf.subarray(1, 4).toString()).toBe("PNG");
  // width is in the IHDR chunk: (200 + 2*10 padding) * 3
  expect(buf.readUInt32BE(16)).toBe(660);
  await page.keyboard.press("Control+Shift+e");
  await dlg.getByLabel("Background").uncheck();
  dl = page.waitForEvent("download");
  await dlg.getByRole("button", { name: "SVG", exact: true }).click();
  file = await dl; expect(file.suggestedFilename()).toBe("My canvas.svg");
  const svg = fs.readFileSync(await file.path(), "utf8");
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  expect(svg).toContain(">Exported</text>");
  expect(svg).toContain("@font-face"); // the hand-drawn font travels with the file
  expect(svg).not.toContain("<rect x=\"0\" y=\"0\""); // no background
  // with a selection only the selection is exported
  await page.mouse.click(400, 250);
  await page.keyboard.press("Control+Shift+e");
  await expect(dlg.getByText("Only the selected elements are exported.")).toBeVisible();
  await dlg.getByRole("radio", { name: "1×" }).click();
  dl = page.waitForEvent("download"); await dlg.getByRole("button", { name: "PNG", exact: true }).click();
  expect(fs.readFileSync(await (await dl).path()).readUInt32BE(16)).toBe(220);
});

test("R19 save to and open .excalidraw files, keeping them compatible", async ({ page }) => {
  // open a file written by the original app: supported elements come in, frames are left out with a notice
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Control+o");
  await (await chooser).setFiles(path.join(FIX, "sample.excalidraw"));
  await expect(page.getByText("1 element of a kind this app doesn't draw (such as frames or embeds) was left out")).toBeVisible();
  const els = await elements(page);
  expect(els.map(e => e.id)).toEqual(["box-a", "box-b", "arrow-1", "label"]);
  expect(els[2].startBinding.elementId).toBe("box-a");
  expect((await appState(page)).viewBackgroundColor).toBe("#f8f9fa");
  // it can be undone like any change
  await page.keyboard.press("Control+z"); expect(await elements(page)).toHaveLength(0);
  await page.keyboard.press("Control+Shift+z"); expect(await elements(page)).toHaveLength(4);
  // saving writes the same format back
  const dl = page.waitForEvent("download");
  await menu(page, "Save to file…");
  const file = await dl; expect(file.suggestedFilename()).toBe("My canvas.excalidraw");
  const doc = JSON.parse(fs.readFileSync(await file.path(), "utf8"));
  expect(doc).toMatchObject({ type: "excalidraw", version: 2, appState: { viewBackgroundColor: "#f8f9fa", gridSize: 20 } });
  expect(doc.elements.map((e: any) => e.id)).toEqual(["box-a", "box-b", "arrow-1", "label"]);
  expect(doc.elements[3]).toMatchObject({ type: "text", text: "From Excalidraw", fontFamily: 1 });
  // a broken file is refused with a message, and the canvas is untouched
  const c2 = page.waitForEvent("filechooser"); await page.keyboard.press("Control+o");
  await (await c2).setFiles({ name: "broken.excalidraw", mimeType: "application/json", buffer: Buffer.from("{not json") });
  await expect(page.getByText("That file is not valid JSON.")).toBeVisible();
  expect(await elements(page)).toHaveLength(4);
});

test("R7 images: insert from a file, large ones are scaled down, they survive a reload", async ({ page }) => {
  const big = await png(page, 3000, 1500);
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("9");
  await (await chooser).setFiles({ name: "photo.png", mimeType: "image/png", buffer: big });
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const img = (await elements(page))[0];
  expect(img.type).toBe("image"); expect(img.fileId).toMatch(/^[a-f0-9]{40}$/);
  expect(img.width / img.height).toBeCloseTo(2, 1);
  const file = await page.evaluate(id => (window as any).__whiteboard.store.files[id], img.fileId);
  const dims = await page.evaluate(u => new Promise<number[]>(ok => { const i = new Image(); i.onload = () => ok([i.naturalWidth, i.naturalHeight]); i.src = u; }), file.dataURL);
  expect(dims).toEqual([1440, 720]);
  await page.waitForTimeout(600);
  await page.reload(); await canvasReady(page);
  await expect.poll(() => page.evaluate(id => !!(window as any).__whiteboard.store.files[id], img.fileId)).toBe(true);
  // a file that isn't an image is refused
  const c2 = page.waitForEvent("filechooser"); await page.keyboard.press("9");
  await (await c2).setFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByText("Only PNG, JPEG, GIF, WebP, SVG, BMP and AVIF images can be added")).toBeVisible();
});

test("R20 the library: add the selection, insert it, import and export library files", async ({ page }) => {
  await rect(page, 400, 200, 500, 300);
  await page.getByRole("button", { name: "Library" }).click();
  const lib = page.getByRole("complementary", { name: "Library" });
  await expect(lib.getByText("No items yet.")).toBeVisible();
  await lib.getByRole("button", { name: "Add selection" }).click();
  await expect(lib.getByRole("button", { name: "Insert library item" })).toHaveCount(1);
  await lib.getByRole("button", { name: "Insert library item" }).click();
  let els = await elements(page); expect(els).toHaveLength(2); expect(els[1].id).not.toBe(els[0].id);
  const chooser = page.waitForEvent("filechooser");
  await lib.getByRole("button", { name: "Import" }).click();
  await (await chooser).setFiles(path.join(FIX, "servers.excalidrawlib"));
  await expect(lib.getByRole("button", { name: "Insert Server" })).toBeVisible();
  await lib.getByRole("button", { name: "Insert Server" }).click();
  els = await elements(page); expect(els.at(-1)).toMatchObject({ backgroundColor: "#b2f2bb", width: 60, height: 80 });
  // kept in this browser across reloads
  await page.reload(); await canvasReady(page);
  await page.getByRole("button", { name: "Library" }).click();
  await expect(lib.getByRole("listitem")).toHaveCount(2);
  const dl = page.waitForEvent("download");
  await lib.getByRole("button", { name: "Export" }).click();
  const doc = JSON.parse(fs.readFileSync(await (await dl).path(), "utf8"));
  expect(doc).toMatchObject({ type: "excalidrawlib", version: 2 }); expect(doc.libraryItems).toHaveLength(2);
  // "Add to library" in the context menu adds the selection straight away
  await page.getByRole("button", { name: "Close library" }).click();
  await page.keyboard.press("Control+a");
  const box = (await elements(page))[0];
  await page.mouse.click(box.x + 1 + 0, box.y + box.height / 2, { button: "right" }).catch(() => {});
  await page.getByRole("menuitem", { name: "Add to library" }).click();
  await expect(lib.getByRole("listitem")).toHaveCount(3);
  await lib.getByRole("listitem").first().hover();
  await lib.getByRole("button", { name: "Remove from library" }).first().click();
  await expect(lib.getByRole("listitem")).toHaveCount(2);
});
void drag;
