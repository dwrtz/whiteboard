import { test, expect, Page, Browser } from "@playwright/test";
import { canvasReady, drag, elements, rect } from "./helpers";

async function guest(browser: Browser, link: string, name?: string) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  if (name) await ctx.addInitScript(n => localStorage.setItem("whiteboard:name", n), name);
  const p = await ctx.newPage(); await p.goto(link); await canvasReady(p); return { ctx, p };
}
async function startSession(page: Page) {
  await page.getByRole("button", { name: "Share" }).click();
  const dlg = page.getByRole("dialog", { name: "Share" });
  await dlg.getByRole("button", { name: "Start session" }).click();
  const link = await dlg.getByRole("textbox", { name: "Session link" }).inputValue();
  await page.keyboard.press("Escape");
  return link;
}
const status = (p: Page) => p.getByTestId("room-status");

test("R25 live collaboration: anyone with the link joins, edits and cursors flow both ways, people leave", async ({ page, browser }) => {
  await page.goto("/"); await canvasReady(page);
  await rect(page, 400, 200, 500, 300);
  const link = await startSession(page);
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:3210\/#room=[a-f0-9]{20},[A-Za-z0-9_-]{22}$/);
  await expect(status(page)).toContainText("Live · 1 here");

  const a = await guest(browser, link, "Gus");
  await expect(status(a.p)).toContainText("Live · 2 here");
  await expect(status(page)).toContainText("Live · 2 here");
  await expect.poll(async () => (await elements(a.p)).map(e => e.type)).toEqual(["rectangle"]);
  // guest → host
  await a.p.keyboard.press("o"); await drag(a.p, 700, 200, 800, 300);
  await expect.poll(async () => (await elements(page)).map(e => e.type)).toEqual(["rectangle", "ellipse"]);
  // host → guest: move the rectangle
  const before = (await elements(page))[0].y;
  await page.keyboard.press("Escape"); await drag(page, 450, 200, 450, 400);
  const after = (await elements(page))[0].y; expect(after).toBeGreaterThan(before + 100);
  await expect.poll(async () => (await elements(a.p)).find(e => e.type === "rectangle")?.y).toBe(after);
  // cursors, with names
  await a.p.mouse.move(900, 500);
  await expect.poll(() => page.evaluate(() => [...(window as any).__whiteboard.store.collaborators.values()].map((c: any) => [c.name, Math.round(c.x) > 0]))).toEqual([["Gus", true]]);
  // a late joiner gets the whole scene at once
  const b = await guest(browser, link);
  await expect.poll(async () => (await elements(b.p)).map(e => e.type).sort()).toEqual(["ellipse", "rectangle"]);
  await expect(status(page)).toContainText("Live · 3 here");
  await expect(page.locator(".peer-count")).toHaveText("2");
  // deletes travel as tombstones
  // (the late joiner's view is fitted to the drawing, so pick the ellipse through the store)
  await b.p.evaluate(() => { const w = (window as any).__whiteboard; w.store.select([w.getElements().find((e: any) => e.type === "ellipse").id]); });
  await b.p.keyboard.press("Delete");
  await expect.poll(async () => (await elements(page)).map(e => e.type)).toEqual(["rectangle"]);
  // the guest leaves; the others see it
  await b.ctx.close();
  await expect(status(page)).toContainText("Live · 2 here");
  // the host stops: they leave the session and keep their drawing; the guest stays in it
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByRole("dialog", { name: "Share" }).getByRole("button", { name: "Stop session" }).click();
  await page.getByRole("dialog", { name: "Stop the session?" }).getByRole("button", { name: "Stop session" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3210/");
  await expect(status(page)).toHaveCount(0);
  await expect(status(a.p)).toContainText("Live · 1 here");
  expect(await elements(page)).toHaveLength(1);
  await page.reload(); await canvasReady(page);
  expect(await elements(page)).toHaveLength(1); // the host's drawing stayed in the browser
  // the guest leaves and can keep a copy
  await a.p.getByRole("button", { name: "Share" }).click();
  await a.p.getByRole("dialog", { name: "Share" }).getByRole("button", { name: "Leave session" }).click();
  await expect(a.p.getByText("You left the live session.")).toBeVisible();
  // (leaving already set the address to "/"; keeping the copy reloads the page)
  await Promise.all([a.p.waitForEvent("load"), a.p.getByRole("button", { name: "Keep a copy in this browser" }).click()]);
  await canvasReady(a.p);
  expect((await elements(a.p)).map(e => e.type)).toEqual(["rectangle"]);
  // the room keeps the latest encrypted scene for whoever opens the link next
  // (nobody is in it now; a new tab opens the link)
  const later = await a.ctx.newPage(); await later.goto(link); await canvasReady(later);
  await expect(status(later)).toContainText("Live · 1 here");
  await expect.poll(async () => (await elements(later)).map(e => e.type)).toEqual(["rectangle"]);
  await a.ctx.close();
});

test("R25 images travel encrypted to everyone in the session", async ({ page, browser }) => {
  await page.goto("/"); await canvasReady(page);
  const png = Buffer.from(await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 40; c.height = 30; const x = c.getContext("2d")!; x.fillStyle = "#e03131"; x.fillRect(0, 0, 40, 30); return c.toDataURL("image/png").split(",")[1]; }), "base64");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Insert image" }).click();
  await (await chooser).setFiles({ name: "dot.png", mimeType: "image/png", buffer: png });
  await expect.poll(async () => (await elements(page)).map(e => e.type)).toEqual(["image"]);
  const link = await startSession(page);
  const id = /#room=([a-f0-9]{20}),/.exec(link)![1];
  const a = await guest(browser, link, "Ida");
  await expect.poll(async () => (await elements(a.p)).map(e => e.type)).toEqual(["image"]);
  const fileId = (await elements(a.p))[0] as any;
  await expect.poll(() => a.p.evaluate(fid => !!(window as any).__whiteboard.store.files[fid], fileId.fileId)).toBe(true);
  // the server holds only ciphertext
  const stored = await page.request.get(`/api/rooms/${id}/files/${fileId.fileId}`);
  expect(stored.status()).toBe(200);
  expect(Buffer.from(await stored.body()).toString("latin1")).not.toContain("data:image/png");
  await a.ctx.close();
});

test("R25 R26 sessions need no account; malformed session links are refused", async ({ page }) => {
  await page.goto("/"); await canvasReady(page);
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("dialog", { name: "Share" }).getByRole("button", { name: "Start session" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Share" })).toContainText("anyone with the link can join");
  await page.keyboard.press("Escape");
  expect((await page.request.get("/api/rooms/NOT-A-ROOM/ws", { headers: { upgrade: "websocket" } })).status()).toBe(404);
  const plain = await page.request.get("/api/rooms/0123456789abcdef0123/ws");
  expect(plain.status()).toBe(426); expect(await plain.json()).toEqual({ error: "Expected a WebSocket upgrade" });
});
