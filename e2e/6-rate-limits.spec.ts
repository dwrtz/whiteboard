import { test, expect } from "@playwright/test";

// Runs last: it uses up this address's share-link allowance for the next minute.
test("R26 rate limits: share links are limited per address per minute; refused requests do not count", async ({ request }) => {
  // a fresh address for this test, so links made by earlier tests don't count
  const H = { "content-type": "application/octet-stream", "cf-connecting-ip": `198.51.100.${Date.now() % 250}` };
  // refused requests run their checks first and never spend a slot
  for (let i = 0; i < 12; i++) expect((await request.post("/api/links", { data: Buffer.alloc(8), headers: H })).status()).toBe(400);
  for (let i = 0; i < 2; i++) expect((await request.post("/api/links", { data: Buffer.alloc(10 * 1024 * 1024 + 1), headers: H })).status()).toBe(413);
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) {
    const r = await request.post("/api/links", { data: Buffer.alloc(64, i), headers: H });
    statuses.push(r.status());
    if (r.status() === 429) { expect((await r.json()).error).toBe("Too many share links from your address. Wait a minute and try again."); expect(r.headers()["retry-after"]).toBe("60"); }
  }
  expect(statuses.slice(0, 10)).toEqual(Array(10).fill(201)); // the 14 refused requests above did not count
  expect(statuses.filter(s => s === 201).length).toBeLessThanOrEqual(10);
  expect(statuses).toContain(429);
});
