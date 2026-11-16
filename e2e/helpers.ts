import { expect, Page } from "@playwright/test";
export const BASE = "http://127.0.0.1:3210";
export async function api(page: Page, path: string, init: { method?: string; body?: unknown } = {}) {
  return page.evaluate(async ([path, init]) => {
    const r = await fetch(path, { method: (init as any).method || ((init as any).body ? "POST" : "GET"), headers: { "content-type": "application/json" }, body: (init as any).body ? JSON.stringify((init as any).body) : undefined });
    return { status: r.status, data: await r.json().catch(() => null) };
  }, [path, init] as const);
}
export type El = { id: string; type: string; x: number; y: number; width: number; height: number; angle: number; text?: string; groupIds: string[]; index: string; strokeColor: string; backgroundColor: string; [k: string]: any };
export const elements = (page: Page): Promise<El[]> => page.evaluate(() => (window as any).__whiteboard.getElements());
export const appState = (page: Page): Promise<any> => page.evaluate(() => (window as any).__whiteboard.getAppState());
export async function canvasReady(page: Page) { await expect(page.getByTestId("canvas")).toBeVisible(); await page.waitForFunction(() => !!(window as any).__whiteboard); }
/** Drag on the canvas from (x1, y1) to (x2, y2) in page pixels. */
export async function drag(page: Page, x1: number, y1: number, x2: number, y2: number, opts: { steps?: number } = {}) {
  await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move(x2, y2, { steps: opts.steps ?? 6 }); await page.mouse.up();
}
export async function tool(page: Page, name: string) { await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name, exact: true }).click(); }
export async function rect(page: Page, x1: number, y1: number, x2: number, y2: number) { await page.keyboard.press("r"); await drag(page, x1, y1, x2, y2); }
export async function text(page: Page, x: number, y: number, value: string) {
  await page.keyboard.press("t"); await page.mouse.click(x, y);
  const ta = page.getByRole("textbox", { name: "Text" }); await expect(ta).toBeFocused();
  await page.keyboard.type(value); await page.keyboard.press("Escape"); await expect(ta).toHaveCount(0);
}
export async function menu(page: Page, item: string | RegExp) {
  await page.getByTestId("main-menu").click();
  await page.getByRole("menuitem", { name: item }).click();
}
