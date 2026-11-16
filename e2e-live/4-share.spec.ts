import { test, expect } from "@playwright/test";
import { canvasReady, elements, rect } from "./helpers";

test("R24 shareable links: the server stores only ciphertext; the key in the fragment opens it", async ({ page, browser }) => {
  await page.goto("/"); await canvasReady(page);
  await rect(page, 400, 200, 500, 300);
  await page.getByRole("button", { name: "Share" }).click();
  const dlg = page.getByRole("dialog", { name: "Share" });
  await dlg.getByRole("button", { name: "Create encrypted link" }).click();
  const link = await dlg.getByRole("textbox", { name: "Encrypted link" }).inputValue();
  const m = /^https:\/\/whiteboard\.beef-able\.com\/#json=([A-Za-z0-9_-]{22}),([A-Za-z0-9_-]{22})$/.exec(link)!;
  expect(m).not.toBeNull();
  const res = await page.request.get(`/api/links/${m[1]}`);
  expect(res.headers()["content-type"]).toBe("application/octet-stream");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  const stored = Buffer.from(await res.body());
  expect(stored.toString("latin1")).not.toContain("rectangle");
  const guest = await browser.newContext({ viewport: { width: 1360, height: 860 } }); const g = await guest.newPage();
  await g.goto(link); await canvasReady(g);
  await expect(g.getByText("Opened from an encrypted link — not saved yet.")).toBeVisible();
  expect((await elements(g)).map(e => e.type)).toEqual(["rectangle"]);
  await g.getByRole("button", { name: "Keep in this browser" }).click();
  await expect(g).toHaveURL("https://whiteboard.beef-able.com/"); await canvasReady(g);
  expect(await elements(g)).toHaveLength(1);
  // a wrong key can't open it, and an unknown id says so
  await g.goto(`/#json=${m[1]},${"A".repeat(22)}`);
  await expect(g.getByText("Couldn't decrypt this drawing: the key in the link is wrong.")).toBeVisible();
  await g.goto(`/#json=${"B".repeat(22)},${m[2]}`);
  await expect(g.getByText("This link doesn't exist or was mistyped.")).toBeVisible();
  await guest.close();
});

test("R26 limits: oversized links, cross-site requests and bad ids are refused", async ({ page }) => {
  await page.goto("/"); await canvasReady(page);
  const big = await page.request.post("/api/links", { data: Buffer.alloc(10 * 1024 * 1024 + 1), headers: { "content-type": "application/octet-stream" } });
  expect(big.status()).toBe(413); expect((await big.json()).error).toContain("10 MB");
  const xsite = await page.request.post("/api/links", { data: Buffer.alloc(64), headers: { "content-type": "application/octet-stream", origin: "https://evil.example" } });
  expect(xsite.status()).toBe(403);
  expect((await page.request.get("/api/links/not-an-id")).status()).toBe(404);
  expect((await page.request.get("/api/rooms/xyz/files/" + "a".repeat(40))).status()).toBe(404);
  expect((await page.request.put("/api/rooms/0123456789abcdef0123/files/" + "a".repeat(40), { data: Buffer.alloc(4 * 1024 * 1024 + 100) })).status()).toBe(413);
  const ws = await page.evaluate(() => new Promise<string>(ok => { const w = new WebSocket(`wss://${location.host}/api/rooms/not-a-room/ws`); w.onopen = () => ok("open"); w.onerror = () => ok("refused"); }));
  expect(ws).toBe("refused");
});
