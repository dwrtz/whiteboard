import { test, expect } from "@playwright/test";
import { canvasReady, drag, elements, appState, rect, text } from "./helpers";

test.beforeEach(async ({ page }) => { await page.goto("/"); await canvasReady(page); });
const panel = (page: any) => page.locator(".style-panel");

test("R13 R8 the style panel changes the selection and the next shape", async ({ page }) => {
  await rect(page, 400, 200, 550, 320);
  await panel(page).getByRole("radiogroup", { name: "Stroke" }).getByRole("radio", { name: "#1971c2" }).click();
  await panel(page).getByRole("radiogroup", { name: "Background" }).getByRole("radio", { name: "#ffec99" }).click();
  await panel(page).getByRole("radio", { name: "Cross-hatch" }).click();
  await panel(page).getByRole("radio", { name: "Extra bold" }).click();
  await panel(page).getByRole("radio", { name: "Dashed" }).click();
  await panel(page).getByRole("radio", { name: "Architect" }).click();
  await panel(page).getByRole("radio", { name: "Sharp" }).click();
  await panel(page).getByRole("slider", { name: "Opacity" }).fill("60");
  const r = (await elements(page))[0];
  expect(r).toMatchObject({ strokeColor: "#1971c2", backgroundColor: "#ffec99", fillStyle: "cross-hatch", strokeWidth: 4, strokeStyle: "dashed", roughness: 0, roundness: null, opacity: 60 });
  // like Excalidraw, Alt-clicking Hachure when it is already hachure switches to zigzag
  await panel(page).getByRole("radio", { name: "Hachure (Alt-Click)" }).click();
  await panel(page).getByRole("radio", { name: "Hachure (Alt-Click)" }).click({ modifiers: ["Alt"] });
  expect((await elements(page))[0].fillStyle).toBe("zigzag");
  await expect(panel(page).getByRole("radio", { name: "Zigzag (Alt-Click)" })).toHaveAttribute("aria-checked", "true");
  await panel(page).getByRole("radio", { name: "Cross-hatch" }).click();

  await panel(page).getByLabel("Stroke: custom colour").fill("#123456");
  expect((await elements(page))[0].strokeColor).toBe("#123456");
  // the next shape uses the same style
  // (focus is still in the colour input, so pick the next tool with the toolbar)
  await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Ellipse" }).click(); await drag(page, 700, 200, 800, 300);
  expect((await elements(page))[1]).toMatchObject({ type: "ellipse", backgroundColor: "#ffec99", strokeWidth: 4, opacity: 60 });
  // text options and arrowheads only show for those elements
  await expect(panel(page).getByRole("radiogroup", { name: "Font family" })).toHaveCount(0);
  await text(page, 400, 500, "Label");
  await page.mouse.click(410, 500);
  await panel(page).getByRole("radio", { name: "XL" }).click();
  await panel(page).getByRole("radio", { name: "Code" }).click();
  const t = (await elements(page))[2]; expect(t).toMatchObject({ fontSize: 36, fontFamily: 3 });
  await page.keyboard.press("a"); await drag(page, 900, 500, 1000, 600);
  await panel(page).getByLabel("Start arrowhead").selectOption("triangle");
  await panel(page).getByLabel("End arrowhead").selectOption("null");
  expect((await elements(page))[3]).toMatchObject({ startArrowhead: "triangle", endArrowhead: null });
});

test("R10 R11 R12 group, align, distribute, z-order and flip", async ({ page }) => {
  await rect(page, 400, 200, 450, 250); await rect(page, 520, 260, 600, 300); await rect(page, 700, 230, 720, 300);
  await page.keyboard.press("Control+a");
  await panel(page).getByRole("button", { name: "Align top" }).click();
  let els = await elements(page); expect(els.map(e => e.y)).toEqual([200, 200, 200]);
  await panel(page).getByRole("button", { name: "Distribute horizontally" }).click();
  els = await elements(page);
  expect((els[1].x - (els[0].x + els[0].width))).toBeCloseTo(els[2].x - (els[1].x + els[1].width), 5);
  // group the first two: a click on one selects both; double-click enters the group
  await page.keyboard.press("Escape");
  await page.mouse.click(425, 200); await page.keyboard.down("Shift"); await page.mouse.click(els[1].x + 20, 200); await page.keyboard.up("Shift");
  await page.keyboard.press("Control+g");
  els = await elements(page); expect(els[0].groupIds).toHaveLength(1); expect(els[0].groupIds).toEqual(els[1].groupIds);
  await page.keyboard.press("Escape"); await page.mouse.click(425, 200);
  expect((await appState(page)).selected).toHaveLength(2);
  await page.waitForTimeout(500);
  await page.mouse.dblclick(425, 200);
  expect((await appState(page)).selected).toEqual([els[0].id]);
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await page.mouse.click(425, 200); await page.keyboard.press("Control+Shift+g");
  expect((await elements(page)).every(e => e.groupIds.length === 0)).toBe(true);
  // z-order
  await page.keyboard.press("Escape"); await page.mouse.click(425, 200);
  await page.keyboard.press("Control+Shift+]");
  els = await elements(page); expect(els.at(-1)!.x).toBe(400);
  await panel(page).getByRole("button", { name: "Send to back" }).click();
  els = await elements(page); expect(els[0].x).toBe(400);
  await page.keyboard.press("Control+]");
  els = await elements(page); expect(els[1].x).toBe(400);
  // flip a pair horizontally
  await page.keyboard.press("Control+a"); const before = await elements(page);
  await page.keyboard.press("Shift+H");
  const after = await elements(page);
  expect(after.find(e => e.id === before[0].id)!.x).not.toBe(before[0].x);
});

test("R14 duplicate, Alt-drag, copy and paste, copy styles, lock", async ({ page }) => {
  await rect(page, 400, 200, 500, 300);
  await panel(page).getByRole("radiogroup", { name: "Stroke" }).getByRole("radio", { name: "#e03131" }).click();
  await page.keyboard.press("Control+d");
  let els = await elements(page); expect(els).toHaveLength(2); expect([els[1].x, els[1].y]).toEqual([410, 210]);
  expect((await appState(page)).selected).toEqual([els[1].id]);
  await page.keyboard.press("Escape");
  await page.keyboard.down("Alt"); await drag(page, 395, 250, 395, 450); await page.keyboard.up("Alt");
  els = await elements(page); expect(els).toHaveLength(3); expect(els[0].y).toBe(200); expect(els[2].y).toBe(400);
  // clipboard: copy, move the pointer, paste there
  await page.keyboard.press("Control+c");
  await page.mouse.move(900, 600); await page.keyboard.press("Control+v");
  els = await elements(page); expect(els).toHaveLength(4);
  expect(els[3].x + els[3].width / 2).toBeCloseTo(900, 0); expect(els[3].strokeColor).toBe("#e03131");
  // plain text pastes as a text element
  await page.evaluate(() => navigator.clipboard.writeText("pasted words"));
  await page.mouse.move(800, 150); await page.keyboard.press("Control+v");
  els = await elements(page); expect(els.at(-1)).toMatchObject({ type: "text", text: "pasted words" });
  // copy styles from a red rectangle onto an ellipse
  await page.keyboard.press("o"); await drag(page, 700, 300, 780, 380);
  await page.keyboard.press("Escape"); await page.mouse.click(400, 250);
  await page.keyboard.press("Control+Alt+c");
  const ell = (await elements(page)).find(e => e.type === "ellipse")!;
  await page.mouse.click(ell.x + 1, ell.y + ell.height / 2);
  await page.keyboard.press("Control+Alt+v");
  expect((await elements(page)).find(e => e.type === "ellipse")!.strokeColor).toBe("#e03131");
  // locked elements can't be selected by clicking until unlocked from the context menu
  await page.keyboard.press("Control+Shift+l");
  await page.mouse.click(ell.x + 1, ell.y + ell.height / 2);
  expect((await appState(page)).selected).toEqual([]);
  await page.mouse.click(1100, 700, { button: "right" });
  await page.getByRole("menuitem", { name: "Unlock all" }).click();
  await page.mouse.click(ell.x + 1, ell.y + ell.height / 2);
  expect((await appState(page)).selected).toHaveLength(1);
  // the context menu acts on the selection
  await page.mouse.click(ell.x + 1, ell.y + ell.height / 2, { button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  expect((await elements(page)).some(e => e.type === "ellipse")).toBe(false);
});
