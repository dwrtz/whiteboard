import { test, expect, devices, Page } from "@playwright/test";
import { canvasReady, elements, appState } from "./helpers";

// R22 (with R6): on a phone the toolbar and menus stay on screen while text is edited — typing past the
// screen's edge, the on-screen keyboard shrinking the viewport, rotating, pinching. Excalidraw pans
// the canvas to follow the caret; the app's UI never scrolls.
const phone = (name: string) => { const { defaultBrowserType, ...d } = devices[name] as any; return d; };

/** Where the fixed UI is, and whether anything scrolled or zoomed the page. */
async function ui(page: Page) {
  return page.evaluate(async () => {
    // scroll events are dispatched with the next frame
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const box = (sel: string) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, r: r.right, b: r.bottom }; };
    const ed = document.querySelector(".editor") as HTMLElement; const tb = document.querySelector(".text-editor-box") as HTMLElement | null;
    return { w: innerWidth, h: innerHeight, scale: visualViewport?.scale ?? 1, editorScroll: [ed.scrollLeft, ed.scrollTop], boxScroll: tb ? [tb.scrollLeft, tb.scrollTop] : [0, 0], page: [scrollX, scrollY],
      toolbar: box('[role=toolbar][aria-label="Tools"]'), menu: box('[data-testid="main-menu"]'), text: box(".text-editor") };
  });
}
async function expectUiOnScreen(page: Page) {
  const u = await ui(page);
  expect(u.editorScroll, "editor root never scrolls").toEqual([0, 0]);
  expect(u.boxScroll, "text editor box is put back").toEqual([0, 0]);
  expect(u.page, "page is not scrolled").toEqual([0, 0]);
  expect(u.scale, "page is not zoomed").toBe(1);
  for (const k of ["toolbar", "menu"] as const) {
    const b = u[k]!; expect(b, k).toBeTruthy();
    expect(b.x, `${k} left`).toBeGreaterThanOrEqual(0); expect(b.y, `${k} top`).toBeGreaterThanOrEqual(0);
    expect(b.r, `${k} right`).toBeLessThanOrEqual(u.w); expect(b.b, `${k} bottom`).toBeLessThanOrEqual(u.h);
  }
  await expect(page.getByRole("toolbar", { name: "Tools" })).toBeInViewport();
  await expect(page.getByTestId("main-menu")).toBeInViewport();
  return u;
}
/** Tap empty canvas next to the text being edited (above it, or below when it is near the top). */
async function tapAway(page: Page) {
  const u = await ui(page); const t = u.text!;
  const y = t.y > 140 ? t.y - 40 : Math.min(t.b + 40, u.h - 140);
  await page.touchscreen.tap(Math.round(u.w / 2), Math.round(y));
}
/** Two-finger pinch through real touch input (Chromium DevTools protocol). */
async function pinch(page: Page, cx: number, cy: number, from: number, to: number) {
  const cdp = await page.context().newCDPSession(page);
  const pts = (d: number) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(from) });
  for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(from + ((to - from) * i) / 8) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

for (const name of ["iPhone 13", "Pixel 7"]) {
  test.describe(`R22 R6 mobile text editing (${name})`, () => {
    test.use(phone(name));
    test.beforeEach(async ({ page }) => { await page.goto("/"); await canvasReady(page); });

    test("the UI stays on screen while typing, with the keyboard up, and after", async ({ page }) => {
      const vp = page.viewportSize()!;
      await expect(page.locator(".editor")).toHaveClass(/is-mobile/);
      await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Text", exact: true }).tap();
      await page.touchscreen.tap(Math.round(vp.width * 0.6), Math.round(vp.height * 0.75));
      const ta = page.getByRole("textbox", { name: "Text" }); await expect(ta).toBeFocused();
      await expectUiOnScreen(page);
      const before = await appState(page);
      // a line longer than the screen: the canvas pans left to follow the caret
      const line = "The quick brown fox jumps over the lazy dog again";
      await page.keyboard.type(line);
      let u = await expectUiOnScreen(page);
      expect((await appState(page)).scrollX).toBeLessThan(before.scrollX);
      // the caret end of the line is on screen (the field's right edge carries ~12px of slack past the caret)
      expect(u.text!.r).toBeLessThanOrEqual(u.w + 12); expect(u.text!.r).toBeGreaterThan(u.w / 2);
      // the on-screen keyboard takes the bottom half of the screen
      await page.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.5) });
      await expectUiOnScreen(page);
      for (let i = 2; i <= 8; i++) { await page.keyboard.press("Enter"); await page.keyboard.type(`line ${i}`); }
      u = await expectUiOnScreen(page);
      expect(u.text!.b, "the caret's line is above the keyboard").toBeLessThanOrEqual(u.h + 12);
      // keyboard down, tap away: the text is kept and the UI is where it was
      await page.setViewportSize(vp);
      await tapAway(page);
      await expect(ta).toHaveCount(0);
      await expectUiOnScreen(page);
      const els = await elements(page);
      expect(els).toHaveLength(1);
      expect(els[0].text).toBe([line, ...[2, 3, 4, 5, 6, 7, 8].map(i => `line ${i}`)].join("\n"));
    });

    test("double-tap to edit, rotate and pinch keep the UI on screen", async ({ page }) => {
      const vp = page.viewportSize()!;
      await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Text", exact: true }).tap();
      await page.touchscreen.tap(60, 200);
      await page.keyboard.type("Hello");
      await page.touchscreen.tap(vp.width - 40, vp.height * 0.45);
      await expect(page.getByRole("textbox", { name: "Text" })).toHaveCount(0);
      // double-tap the text with the selection tool to edit it again
      const st = await appState(page); const el = (await elements(page))[0];
      const sx = (el.x + el.width / 2 + st.scrollX) * st.zoom, sy = (el.y + el.height / 2 + st.scrollY) * st.zoom;
      await page.touchscreen.tap(sx, sy); await page.waitForTimeout(60); await page.touchscreen.tap(sx, sy);
      const ta = page.getByRole("textbox", { name: "Text" }); await expect(ta).toBeFocused();
      await expectUiOnScreen(page);
      await page.keyboard.press("End"); await page.keyboard.type(" world, this is a longer line of text");
      await expectUiOnScreen(page);
      // rotate to landscape and back while editing
      await page.setViewportSize({ width: vp.height, height: vp.width }); await expectUiOnScreen(page);
      await page.setViewportSize(vp); await expectUiOnScreen(page);
      await tapAway(page); await expect(ta).toHaveCount(0);
      expect((await elements(page))[0].text).toBe("Hello world, this is a longer line of text");
      // a two-finger pinch zooms the canvas, not the page
      const z0 = (await appState(page)).zoom;
      await pinch(page, vp.width / 2, vp.height / 2, 80, 240);
      expect((await appState(page)).zoom).toBeGreaterThan(z0);
      await expectUiOnScreen(page);
    });
  });
}
