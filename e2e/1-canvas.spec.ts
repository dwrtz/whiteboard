import { test, expect } from "@playwright/test";
import { canvasReady, drag, elements, appState, rect, text, tool, menu } from "./helpers";

test.beforeEach(async ({ page }) => { await page.goto("/"); await canvasReady(page); });

test("R23 the canvas lives in this browser and survives a reload", async ({ page }) => {
  await expect(page.getByText("Your drawing is saved in this browser.")).toBeVisible();
  await rect(page, 300, 300, 450, 400);
  await expect(page.getByText("Your drawing is saved in this browser.")).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.reload(); await canvasReady(page);
  const els = await elements(page);
  expect(els).toHaveLength(1);
  expect(els[0]).toMatchObject({ type: "rectangle", width: 150, height: 100 });
  // the drawing is in localStorage; there is nothing to sign in to
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("whiteboard:local")!));
  expect(stored.elements.map((e: any) => e.id)).toEqual([els[0].id]);
  await page.getByTestId("main-menu").click();
  await expect(page.getByRole("menuitem", { name: "Save to file…" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Sign in|My drawings|Account/ })).toHaveCount(0);
});

test("R2 shapes: drag to draw, Shift for squares, a click makes a default shape, Q keeps the tool", async ({ page }) => {
  await rect(page, 300, 200, 400, 260);
  await page.keyboard.press("d"); await page.keyboard.down("Shift"); await drag(page, 500, 200, 620, 260); await page.keyboard.up("Shift");
  await page.keyboard.press("o"); await page.mouse.click(700, 300);
  let els = await elements(page);
  expect(els.map(e => e.type)).toEqual(["rectangle", "diamond", "ellipse"]);
  expect(els[1].width).toBe(els[1].height);
  expect([els[2].width, els[2].height]).toEqual([100, 100]);
  // after drawing, the tool goes back to selection and the new shape is selected
  expect((await appState(page)).tool).toBe("selection");
  expect((await appState(page)).selected).toEqual([els[2].id]);
  await page.keyboard.press("q"); await page.keyboard.press("r");
  await drag(page, 300, 500, 350, 550); await drag(page, 400, 500, 450, 550);
  expect((await appState(page)).tool).toBe("rectangle");
  await expect(page.getByRole("button", { name: "Keep selected tool active after drawing" })).toHaveAttribute("aria-pressed", "true");
  els = await elements(page); expect(els).toHaveLength(5);
});

test("R3 R4 arrows and lines: two-point drags, multi-point clicks, binding that follows shapes", async ({ page }) => {
  await rect(page, 300, 300, 400, 400);
  await rect(page, 700, 300, 800, 400);
  await page.keyboard.press("a"); await drag(page, 360, 350, 750, 350);
  let els = await elements(page);
  const [a, b, arrow] = els;
  expect(arrow.type).toBe("arrow");
  expect(arrow.startBinding.elementId).toBe(a.id); expect(arrow.endBinding.elementId).toBe(b.id);
  expect(arrow.endArrowhead).toBe("arrow");
  // the ends sit on the outlines, not inside the shapes
  expect(arrow.x).toBeGreaterThan(400); expect(arrow.x + arrow.points[1][0]).toBeLessThan(700);
  expect(a.boundElements).toEqual([{ id: arrow.id, type: "arrow" }]);
  // moving a shape drags the bound end along
  await page.keyboard.press("Escape");
  await drag(page, 750, 302, 750, 502);
  els = await elements(page);
  const moved = els.find(e => e.id === arrow.id)!;
  expect(moved.y + moved.points[1][1]).toBeGreaterThan(450);
  // line with three points by clicking, finished with Enter
  await page.keyboard.press("l");
  await page.mouse.click(300, 600); await page.mouse.move(400, 650); await page.mouse.click(400, 650); await page.mouse.move(500, 600); await page.mouse.click(500, 600);
  await page.keyboard.press("Enter");
  els = await elements(page);
  const line = els.at(-1)!;
  expect(line.type).toBe("line"); expect(line.points).toHaveLength(3);
  expect(line.endArrowhead).toBeNull();
});

test("R5 R6 freehand drawing and text", async ({ page }) => {
  await page.keyboard.press("p");
  await page.mouse.move(300, 200); await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(300 + i * 10, 200 + Math.sin(i / 2) * 40);
  await page.mouse.up();
  await text(page, 400, 500, "Hello\nboard");
  let els = await elements(page);
  expect(els[0].type).toBe("freedraw"); expect(els[0].points.length).toBeGreaterThan(15);
  expect(els[1]).toMatchObject({ type: "text", text: "Hello\nboard", fontFamily: 5, fontSize: 20 });
  expect(els[1].height).toBeGreaterThan(40);
  // double-click edits; emptying the text removes it
  await page.keyboard.press("Escape");
  await page.mouse.dblclick(els[1].x + 10, els[1].y + 10);
  const ta = page.getByRole("textbox", { name: "Text" });
  await expect(ta).toHaveValue("Hello\nboard");
  await page.keyboard.press("Control+a"); await page.keyboard.press("Delete"); await page.keyboard.press("Escape");
  els = await elements(page); expect(els.map(e => e.type)).toEqual(["freedraw"]);
  // double-click on empty canvas starts text too
  await page.mouse.dblclick(600, 600); await expect(ta).toBeFocused(); await page.keyboard.type("Second"); await page.mouse.click(900, 200);
  els = await elements(page); expect(els.at(-1)!.text).toBe("Second");
});

test("R9 selection: click, Shift-click, box select, move with arrow keys, resize, rotate, delete", async ({ page }) => {
  await rect(page, 400, 200, 500, 300);
  await rect(page, 600, 200, 700, 300);
  await page.keyboard.press("Escape");
  await page.mouse.click(400, 250);
  expect((await appState(page)).selected).toHaveLength(1);
  await page.keyboard.down("Shift"); await page.mouse.click(600, 250); await page.keyboard.up("Shift");
  expect((await appState(page)).selected).toHaveLength(2);
  await page.keyboard.press("Escape");
  await drag(page, 350, 150, 750, 350);
  expect((await appState(page)).selected).toHaveLength(2);
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("Shift+ArrowDown");
  let els = await elements(page);
  expect([els[0].x, els[0].y]).toEqual([401, 205]); // 1 unit, Shift 5 (grid off)
  // drag the second shape by its edge
  await page.keyboard.press("Escape");
  await drag(page, 601, 260, 651, 310);
  els = await elements(page); expect([els[1].x, els[1].y]).toEqual([651, 255]);
  // resize from the bottom-right handle of a single selection
  await page.mouse.click(401, 270);
  const before = (await elements(page))[0];
  await drag(page, 401 + 100 + 4, 205 + 100 + 4, 401 + 150 + 4, 205 + 140 + 4);
  els = await elements(page);
  expect(els[0].width).toBeCloseTo(before.width + 50, 0); expect(els[0].height).toBeCloseTo(before.height + 40, 0);
  // rotate with the handle above the shape
  const r = els[0]; const cx = r.x + r.width / 2;
  await drag(page, cx, r.y - 4 - 20, r.x + r.width + 100, r.y + r.height / 2);
  els = await elements(page); expect(els[0].angle).toBeGreaterThan(1.2); expect(els[0].angle).toBeLessThan(1.9);
  await page.keyboard.press("Delete");
  expect(await elements(page)).toHaveLength(1);
  await page.keyboard.press("Control+a"); expect((await appState(page)).selected).toHaveLength(1);
});

test("R15 undo and redo, from the keyboard and the buttons", async ({ page }) => {
  await rect(page, 400, 200, 500, 300);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Control+z");
  expect((await elements(page))[0].x).toBe(400);
  await page.keyboard.press("Control+z");
  expect(await elements(page)).toHaveLength(0);
  await page.getByRole("button", { name: "Redo" }).click();
  expect(await elements(page)).toHaveLength(1);
  await page.keyboard.press("Control+Shift+z");
  expect((await elements(page))[0].x).toBe(401);
  await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();
  await page.getByRole("button", { name: "Undo" }).click();
  expect((await elements(page))[0].x).toBe(400);
});

test("R1 R16 zoom, pan, fit, the eraser, and the shortcuts help", async ({ page }) => {
  await rect(page, 600, 400, 700, 500);
  await page.keyboard.press("Control+=");
  await expect(page.getByRole("button", { name: "Reset zoom" })).toHaveText("110%");
  await page.getByRole("button", { name: "Zoom out" }).click(); await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(page.getByRole("button", { name: "Reset zoom" })).toHaveText("91%");
  await page.keyboard.press("Control+0");
  await expect(page.getByRole("button", { name: "Reset zoom" })).toHaveText("100%");
  // Ctrl+wheel zooms around the pointer; wheel pans
  await page.mouse.move(650, 450); await page.keyboard.down("Control"); await page.mouse.wheel(0, -100); await page.keyboard.up("Control");
  const z = (await appState(page)).zoom; expect(z).toBeCloseTo(1.1, 5); // one wheel event: at most 10 %
  await page.keyboard.press("Control+0");
  const sx = (await appState(page)).scrollX; await page.mouse.wheel(120, 0);
  expect((await appState(page)).scrollX).toBeCloseTo(sx - 120);
  // hand tool and space-drag pan
  await page.keyboard.press("h"); const before = await appState(page);
  await drag(page, 500, 500, 600, 550);
  const after = await appState(page); expect(after.scrollX - before.scrollX).toBeCloseTo(100); expect(after.scrollY - before.scrollY).toBeCloseTo(50);
  await page.keyboard.press("v");
  await page.keyboard.press("Shift+1"); expect((await appState(page)).zoom).toBe(1);
  // eraser
  const el = (await elements(page))[0]; const [ex, ey] = await page.evaluate(([x, y]) => { const s = (window as any).__whiteboard.getAppState(); return [(x + s.scrollX) * s.zoom, (y + s.scrollY) * s.zoom]; }, [el.x, el.y + 50]);
  await page.keyboard.press("e"); await drag(page, ex - 20, ey, ex + 20, ey);
  expect(await elements(page)).toHaveLength(0);
  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toContainText("Bring to front / send to back"); await expect(help).toContainText("Ctrl + Shift + ] / [");
  await page.keyboard.press("Escape"); await expect(help).toHaveCount(0);
});

test("R1 recovering the origin and a drawing spread millions of units apart", async ({ page }) => {
  const canvas = page.getByTestId("canvas");
  const box = (await canvas.boundingBox())!;
  await rect(page, 480, 280, 580, 350);
  await canvas.dispatchEvent("wheel", { deltaX: 4_000_000, deltaY: -2_000_000 });
  await rect(page, 640, 300, 700, 380);
  await page.keyboard.press("Escape");
  const before = await elements(page);
  expect(before[1].x - before[0].x).toBeGreaterThan(3_999_000);
  await canvas.dispatchEvent("wheel", { deltaX: -9_000_000, deltaY: 8_000_000 });
  await page.getByRole("button", { name: "Fit drawing" }).click();
  const fit = await appState(page);
  expect(fit.zoom).toBeLessThan(0.001);
  for (const el of before) {
    expect((el.x + fit.scrollX) * fit.zoom).toBeGreaterThanOrEqual(39);
    expect((el.y + fit.scrollY) * fit.zoom).toBeGreaterThanOrEqual(39);
    expect((el.x + el.width + fit.scrollX) * fit.zoom).toBeLessThanOrEqual(box.width - 39);
    expect((el.y + el.height + fit.scrollY) * fit.zoom).toBeLessThanOrEqual(box.height - 39);
    const x = (el.x + el.width / 2 + fit.scrollX) * fit.zoom;
    const y = (el.y + el.height / 2 + fit.scrollY) * fit.zoom;
    await expect.poll(() => canvas.evaluate((cv: HTMLCanvasElement, [x, y]) => {
      return cv.getContext("2d")!.getImageData(Math.floor(x * devicePixelRatio), Math.floor(y * devicePixelRatio), 1, 1).data[0];
    }, [x, y])).toBeLessThan(200);
  }
  await page.getByRole("button", { name: "Go to origin" }).click();
  expect(await appState(page)).toMatchObject({ zoom: 1, scrollX: box.width / 2, scrollY: box.height / 2 });
  expect(await elements(page)).toEqual(before);
  await page.keyboard.press("Shift+1");
  expect(await appState(page)).toMatchObject({ zoom: fit.zoom, scrollX: fit.scrollX, scrollY: fit.scrollY });
});

test("R1 deep wheel zoom keeps its anchor with the grid on and Home recovers an empty board", async ({ page }) => {
  const canvas = page.getByTestId("canvas");
  const box = (await canvas.boundingBox())!;
  await page.keyboard.press("Control+'");
  for (const direction of [-1, 1]) {
    await page.keyboard.press("Home");
    const anchor = [345 - box.width / 2, 248 - box.height / 2];
    await canvas.evaluate((cv, sign) => {
      for (let i = 0; i < 160; i++) cv.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: sign * 10, clientX: 345, clientY: 248, cancelable: true }));
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, direction);
    const view = await appState(page);
    if (direction < 0) expect(view.zoom).toBeGreaterThan(1_000_000);
    else expect(view.zoom).toBeLessThan(0.000001);
    expect((anchor[0] + view.scrollX) * view.zoom).toBeCloseTo(345, 3);
    expect((anchor[1] + view.scrollY) * view.zoom).toBeCloseTo(248, 3);
    const label = await page.getByRole("button", { name: "Reset zoom" }).innerText();
    expect(Number(label.replace("%", ""))).toBeGreaterThan(0);
    const previous = view.zoom;
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    expect((await appState(page)).zoom / previous).toBeCloseTo(1.1, 10);
  }
  await page.getByRole("button", { name: "Fit drawing" }).click();
  expect(await appState(page)).toMatchObject({ zoom: 1, scrollX: box.width / 2, scrollY: box.height / 2 });
  expect(await elements(page)).toEqual([]);
});

test("R17 R21 grid snapping, canvas background, and dark mode", async ({ page }) => {
  await page.keyboard.press("Control+'");
  expect((await appState(page)).gridModeEnabled).toBe(true);
  await rect(page, 405, 207, 497, 311);
  const r = (await elements(page))[0]; expect(r.x % 20).toBe(0); expect(r.y % 20).toBe(0); expect(r.width % 20).toBe(0);
  await menu(page, "Grid and snapping: on (Ctrl+')");
  expect((await appState(page)).gridModeEnabled).toBe(false);
  await page.getByTestId("main-menu").click(); await page.getByRole("menuitem", { name: /Canvas background #fffce8/ }).click();
  expect((await appState(page)).viewBackgroundColor).toBe("#fffce8");
  await page.keyboard.press("Alt+Shift+D");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".editor")).toHaveClass(/is-dark/);
  await page.reload(); await canvasReady(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect((await appState(page)).viewBackgroundColor).toBe("#fffce8");
  await page.keyboard.press("Alt+Shift+D");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("R22 phone layout: tools at the bottom, style in a sheet, pinch-free zoom buttons", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); await page.goto("/"); await canvasReady(page);
  const bar = await page.getByRole("toolbar", { name: "Tools" }).boundingBox();
  expect(bar!.y).toBeGreaterThan(650);
  await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Rectangle" }).tap();
  await page.touchscreen.tap(150, 300);
  expect((await elements(page))[0].type).toBe("rectangle");
  await expect(page.locator(".style-panel")).toHaveCount(0);
  await page.getByRole("button", { name: "Style" }).tap();
  await expect(page.locator(".style-panel")).toBeVisible();
  await page.getByRole("radio", { name: "#e03131" }).first().tap();
  expect((await elements(page))[0].strokeColor).toBe("#e03131");
  await page.getByRole("button", { name: "Close style" }).tap();
  await page.getByRole("button", { name: "Zoom in" }).tap();
  await expect(page.getByRole("button", { name: "Reset zoom" })).toHaveText("110%");
  await ctx.close();
});
void tool;
