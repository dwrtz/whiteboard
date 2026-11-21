import { devices, expect, test } from "@playwright/test";
import { appState, canvasReady, elements } from "./helpers";

export function mobilePinchTests() {
  test.describe("mobile canvas pinch", () => {
    const { defaultBrowserType, ...phone } = devices["iPhone 13"];
    test.use(phone);
    test.beforeEach(async ({ page }) => {
      await page.goto("/");
      await canvasReady(page);
    });

    test("continues after pointer delivery stops and follows the moving midpoint", async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "Real multi-contact injection uses the Chromium input protocol");
      const cdp = await page.context().newCDPSession(page);
      const touches = (cx: number, cy: number, span: number) => [
        { id: 1, x: cx - span / 2, y: cy }, { id: 2, x: cx + span / 2, y: cy },
      ];
      const before = await appState(page);
      const anchor = { x: 160 / before.zoom - before.scrollX, y: 300 / before.zoom - before.scrollY };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touches(160, 300, 80) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touches(161, 300, 84) });
      // Embedded browsers can stop reporting Pointer Events once they recognize a pinch.
      // The same physical contacts continue moving and generating native Touch Events.
      await page.evaluate(() => {
        const swallow = (event: Event) => event.stopImmediatePropagation();
        document.addEventListener("pointermove", swallow, true);
        document.addEventListener("touchend", () => document.removeEventListener("pointermove", swallow, true), { once: true });
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touches(177, 318, 160) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touches(192, 336, 240) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();

      const after = await appState(page);
      expect(after.zoom).toBeCloseTo(before.zoom * 3, 2);
      expect((anchor.x + after.scrollX) * after.zoom).toBeCloseTo(192, 0);
      expect((anchor.y + after.scrollY) * after.zoom).toBeCloseTo(336, 0);
      expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);
      expect(await elements(page)).toHaveLength(0);
    });

    test("uses WebKit gesture scale once and releases the gesture cleanly", async ({ page }) => {
      const before = await appState(page);
      const prevented = await page.evaluate(() => {
        const canvas = document.querySelector("canvas")!;
        // The embedding view can deliver the initial contacts but only gestureend on release.
        for (const [pointerId, clientX] of [[81, 120], [82, 200]]) {
          canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", pointerId, clientX, clientY: 300 }));
        }
        function gesture(type: string, scale: number, x: number, y: number) {
          const e = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { scale, clientX: x, clientY: y });
          (type === "gesturestart" ? canvas : document).dispatchEvent(e);
          return e.defaultPrevented;
        }
        return [
          gesture("gesturestart", 1, 160, 300),
          gesture("gesturechange", 1.4, 175, 312),
          gesture("gesturechange", 2, 190, 330),
          gesture("gesturechange", 2, 190, 330),
          gesture("gestureend", 1, 190, 330),
        ];
      });
      const after = await appState(page);
      expect(after.zoom).toBeCloseTo(before.zoom * 2, 3);
      const x = 160 / before.zoom - before.scrollX, y = 300 / before.zoom - before.scrollY;
      expect((x + after.scrollX) * after.zoom).toBeCloseTo(190, 1);
      expect((y + after.scrollY) * after.zoom).toBeCloseTo(330, 1);
      expect(prevented).toEqual([true, true, true, true, true]);
      await page.getByRole("button", { name: "Rectangle", exact: true }).tap();
      await page.touchscreen.tap(160, 300);
      await expect.poll(async () => (await elements(page)).map(e => e.type)).toEqual(["rectangle"]);
    });

    test("overlapping touch and scale reports keep one zoom and a replacement finger rebases", async ({ page }) => {
      const levels = await page.evaluate(() => {
        const canvas = document.querySelector("canvas")!;
        const zoom = () => (window as any).__whiteboard.getAppState().zoom;
        const contacts = (type: string, xs: [number, number][]) => {
          const targetTouches = xs.map(([identifier, clientX]) => ({ identifier, clientX, clientY: 310 }));
          canvas.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { targetTouches }));
        };
        const gesture = (type: string, scale: number) => canvas.dispatchEvent(Object.assign(
          new Event(type, { bubbles: true, cancelable: true }), { scale, clientX: 160, clientY: 310 },
        ));
        const initial = zoom(), sample = () => zoom() / initial;
        contacts("touchstart", [[1, 120], [2, 200]]);
        gesture("gesturestart", 1);
        contacts("touchmove", [[1, 80], [2, 240]]);
        gesture("gesturechange", 2);
        const doubled = sample();
        contacts("touchmove", [[1, 40], [2, 280]]);
        gesture("gesturechange", 2); // late duplicate from the other event stream
        const tripled = sample();
        gesture("gestureend", 1);
        contacts("touchstart", [[1, 40], [2, 280], [3, 140]]);
        contacts("touchend", [[2, 280], [3, 140]]);
        const switched = sample();
        contacts("touchmove", [[2, 245], [3, 175]]);
        contacts("touchend", []);
        return [doubled, tripled, switched, sample()];
      });
      expect(levels).toEqual([2, 3, 3, 1.5]);
      expect(await elements(page)).toHaveLength(0);
    });
  });
}
