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

    for (const stalled of ["pointermove", "touchmove"] as const) {
      test(`continues after ${stalled} delivery stops and follows the moving midpoint`, async ({ page, browserName }) => {
        test.skip(browserName !== "chromium", "Real multi-contact injection uses the Chromium input protocol");
        // Install before the app's listeners. Both streams begin normally, then the host stops one.
        await page.addInitScript(type => window.addEventListener(type, event => {
          if ((window as any).stopPinchStream) event.stopImmediatePropagation();
        }, true), stalled);
        await page.reload();
        await canvasReady(page);
        const cdp = await page.context().newCDPSession(page);
        const touches = (cx: number, cy: number, span: number) => [
          { id: 1, x: cx - span / 2, y: cy }, { id: 2, x: cx + span / 2, y: cy },
        ];
        const before = await appState(page);
        const anchor = { x: 160 / before.zoom - before.scrollX, y: 300 / before.zoom - before.scrollY };
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touches(160, 300, 80) });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touches(161, 300, 84) });
        await page.evaluate(() => { (window as any).stopPinchStream = true; });
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
    }

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

    test("deep pinch and one-tap drawing and origin recovery", async ({ page }) => {
      const canvas = page.getByTestId("canvas");
      const box = (await canvas.boundingBox())!;
      await page.getByRole("button", { name: "Rectangle", exact: true }).tap();
      await page.touchscreen.tap(155, 290);
      const [rectangle] = await elements(page);
      const pinch = async (span: number) => canvas.evaluate((cv, endSpan) => {
        const dispatch = (type: string, span: number) => {
          const targetTouches = span ? [-1, 1].map((side, identifier) => ({ identifier, clientX: 175 + side * span / 2, clientY: 320 })) : [];
          cv.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { targetTouches }));
        };
        for (let i = 0; i < 4; i++) { dispatch("touchstart", 80); dispatch("touchmove", endSpan); dispatch("touchend", 0); }
      }, span);
      await pinch(240);
      expect((await appState(page)).zoom).toBeCloseTo(81, 4);
      await page.getByRole("button", { name: "Go to origin" }).tap();
      expect(await appState(page)).toMatchObject({ zoom: 1, scrollX: box.width / 2, scrollY: box.height / 2 });
      await pinch(20);
      expect((await appState(page)).zoom).toBeCloseTo(1 / 256, 8);
      await page.getByRole("button", { name: "Fit drawing" }).tap();
      const fit = await appState(page);
      expect(fit.zoom).toBe(1);
      expect(rectangle.x + rectangle.width / 2 + fit.scrollX).toBeCloseTo(box.width / 2);
      expect(rectangle.y + rectangle.height / 2 + fit.scrollY).toBeCloseTo(box.height / 2);
      expect(await elements(page)).toEqual([rectangle]);
      expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);
    });

    test("overlapping touch and scale reports keep one zoom and a replacement finger rebases", async ({ page }) => {
      const levels = await page.evaluate(() => {
        const canvas = document.querySelector("canvas")!;
        const zoom = () => (window as any).__whiteboard.getAppState().zoom;
        const contacts = (type: string, xs: [number, number][], scale = 1) => {
          const targetTouches = xs.map(([identifier, clientX]) => ({ identifier, clientX, clientY: 310 }));
          canvas.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { targetTouches, scale }));
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
        contacts("touchstart", [[1, 40], [2, 280], [3, 140]], 3);
        contacts("touchend", [[2, 280], [3, 140]], 3);
        const switched = sample();
        contacts("touchmove", [[2, 245], [3, 175]], 1.5);
        contacts("touchend", []);
        return [doubled, tripled, switched, sample()];
      });
      expect(levels).toEqual([2, 3, 3, 1.5]);
      expect(await elements(page)).toHaveLength(0);
    });

    test("pointer motion continues when the other pinch streams stop after four pixels", async ({ page }) => {
      await page.getByRole("button", { name: "Rectangle", exact: true }).tap();
      await page.touchscreen.tap(160, 300);
      await page.getByRole("button", { name: "Fit drawing" }).tap();
      const original = await elements(page), before = await appState(page);
      const after = await page.evaluate(async () => {
        const cv = document.querySelector("canvas")!;
        const pointer = (type: string, id: number, x: number, y: number, target: EventTarget = cv) => target.dispatchEvent(new PointerEvent(type, {
          bubbles: true, pointerType: "touch", pointerId: id, isPrimary: id === 11, clientX: x, clientY: y,
        }));
        const native = (type: string, xs: number[]) => {
          const touches = xs.map((clientX, i) => ({ identifier: 71 + i, clientX, clientY: 300, target: cv }));
          cv.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { touches, targetTouches: touches }));
        };
        const scale = (type: string, value: number) => cv.dispatchEvent(Object.assign(
          new Event(type, { bubbles: true, cancelable: true }), { scale: value, clientX: 160, clientY: 300 },
        ));
        pointer("pointerdown", 11, 120, 300); pointer("pointerdown", 12, 200, 300);
        native("touchstart", [120, 200]); scale("gesturestart", 1);
        pointer("pointermove", 11, 118, 300); pointer("pointermove", 12, 202, 300);
        native("touchmove", [118, 202]); scale("gesturechange", 1.05);
        for (let i = 1; i <= 5; i++) {
          pointer("pointermove", 11, 118 - 8 * i, 300 + 6 * i, document);
          pointer("pointermove", 12, 202 + 23.2 * i, 300 + 6 * i, document);
          await new Promise(requestAnimationFrame);
        }
        pointer("pointerup", 11, 78, 330); pointer("pointerup", 12, 318, 330);
        // The streams that stalled also omit their final events.
        return (window as any).__whiteboard.getAppState();
      });
      expect(after.zoom / before.zoom).toBeCloseTo(3, 3);
      expect((160 / before.zoom - before.scrollX + after.scrollX) * after.zoom).toBeCloseTo(198, 1);
      expect((300 / before.zoom - before.scrollY + after.scrollY) * after.zoom).toBeCloseTo(330, 1);
      expect(await elements(page)).toEqual(original);
      expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);
      await page.getByRole("button", { name: "Rectangle", exact: true }).tap();
      await page.touchscreen.tap(90, 410);
      expect(await elements(page)).toHaveLength(original.length + 1);
    });

    test("lagging WebKit scale reports cannot unwind an expanding or reversing finger span", async ({ page }) => {
      const samples = await page.evaluate(async () => {
        const cv = document.querySelector("canvas")!;
        const contacts = (type: string, span: number) => {
          const touches = span ? [-1, 1].map((side, identifier) => ({ identifier, clientX: 160 + side * span / 2, clientY: 300, target: cv })) : [];
          cv.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { touches, targetTouches: touches }));
        };
        const gesture = (type: string, scale: number) => cv.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { scale, clientX: 160, clientY: 300 }));
        const zoom = () => (window as any).__whiteboard.getAppState().zoom;
        const initial = zoom(), levels = [];
        contacts("touchstart", 80); gesture("gesturestart", 1);
        for (const [span, scale] of [[84, 1.01], [160, 1.02], [240, 1.03], [120, 1.02], [40, 1.01]]) {
          contacts("touchmove", span);
          await new Promise(requestAnimationFrame);
          gesture("gesturechange", scale);
          levels.push(zoom() / initial);
        }
        contacts("touchend", 0); gesture("gestureend", 1);
        return levels;
      });
      expect(samples).toEqual([1.05, 2, 3, 1.5, 0.5]);
    });

    test("retargeted touches keep their canvas contacts and an iOS scale can finish the pinch", async ({ page }) => {
      const result = await page.evaluate(async () => {
        const canvas = document.querySelector("canvas")!;
        const touch = (target: EventTarget, type: string, xs: number[], scale = 1) => {
          const touches = xs.map((clientX, identifier) => ({ target: canvas, identifier, clientX, clientY: 300 }));
          const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { touches, targetTouches: [], scale });
          target.dispatchEvent(event);
          return event.defaultPrevented;
        };
        const zoom = () => (window as any).__whiteboard.getAppState().zoom;
        const initial = zoom(), blocked = touch(canvas, "touchstart", [120]);
        touch(document, "touchstart", [120, 200]);
        touch(document, "touchmove", [40, 280], 1.02);
        // A delayed scale first catches up with the fingers, then becomes the only moving signal.
        const values = [zoom() / initial];
        for (const scale of [1.1, 2, 3, 3.5, 1.5]) {
          await new Promise(requestAnimationFrame);
          touch(document, "touchmove", [40, 280], scale);
          values.push(zoom() / initial);
        }
        touch(document, "touchend", []);
        const button = document.querySelector("button")!;
        const t = { target: button, identifier: 9, clientX: 120, clientY: 300 };
        const toolbar = Object.assign(new Event("touchstart", { bubbles: true, cancelable: true }), { touches: [t], targetTouches: [t] });
        button.dispatchEvent(toolbar);
        return { values, blocked, toolbarBlocked: toolbar.defaultPrevented };
      });
      expect(result).toEqual({ values: [3, 3, 3, 3, 3.5, 1.5], blocked: true, toolbarBlocked: false });
    });

    test("WebKit can cancel touch delivery and finish with the gesture scale alone", async ({ page }) => {
      const before = await appState(page);
      await page.evaluate(() => {
        const canvas = document.querySelector("canvas")!;
        const emit = (type: string, extra: object) => canvas.dispatchEvent(Object.assign(
          new Event(type, { bubbles: true, cancelable: true }), extra,
        ));
        const contacts = (xs: number[]) => xs.map((clientX, identifier) => ({ target: canvas, identifier, clientX, clientY: 300 }));
        emit("gesturestart", { scale: 1 });
        emit("touchstart", { touches: contacts([120, 200]) });
        emit("touchmove", { touches: contacts([118, 202]) });
        emit("gesturechange", { scale: 1.05 });
        emit("touchcancel", { touches: [] });
        emit("gesturechange", { scale: 3, clientX: 190, clientY: 330 });
        emit("gestureend", { scale: 3 });
      });
      const after = await appState(page);
      expect(after.zoom / before.zoom).toBeCloseTo(3);
      expect((160 / before.zoom - before.scrollX + after.scrollX) * after.zoom).toBeCloseTo(190);
      expect((300 / before.zoom - before.scrollY + after.scrollY) * after.zoom).toBeCloseTo(330);
    });
  });
}
