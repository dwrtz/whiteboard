import { expect, type Page } from "@playwright/test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { canvasReady, rect, elements } from "./helpers";

export async function assistantRoundTrip(page: Page, origin: string) {
  const client = new Client({ name: "whiteboard-acceptance", version: "1" });
  const call = (name: string, args: Record<string, unknown>) => client.callTool({name, arguments: args});
  const data = async (name: string, args: Record<string, unknown>) => {
    const result = await call(name, args);
    const item = result.content[0];
    if (result.isError || item?.type !== "text") throw new Error(name + " failed: " + (item?.type === "text" ? item.text : "no text"));
    return JSON.parse(item.text);
  };
  await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", origin)));
  try {
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(expect.arrayContaining(["join_room","read_board","apply_edits","wait_for_changes","leave_room"]));
    await page.goto("/"); await canvasReady(page); await rect(page, 400, 200, 550, 300);
    await page.getByRole("button", {name: "Share", exact: true}).click();
    const dialog = page.getByRole("dialog", {name: "Share"});
    await dialog.getByRole("button", {name: "Start session"}).click();
    const raw = await dialog.getByLabel("Session link").inputValue();
    await dialog.getByRole("button", {name: "Invite assistant"}).click();
    const invite = await dialog.getByLabel("Assistant invite").inputValue();
    expect(new URL(invite).pathname).toBe("/mcp/");
    const landing = await page.context().newPage();
    await landing.goto(invite);
    await expect(landing.getByLabel("MCP endpoint")).toHaveValue(new URL("/api/mcp", origin).href);
    await landing.close();
    await expect(page.getByTestId("room-status")).toContainText("1 here");
    await page.keyboard.press("Escape");
    await page.getByTestId("canvas").focus();
    await page.keyboard.press("Control+a");
    const {session} = await data("join_room", {invite_url: invite});
    await expect(page.getByTestId("room-status").getByTitle("Codex")).toBeVisible();
    const board = () => data("read_board", {session});
    const [shape] = (await board()).elements;
    expect(shape.type).toBe("rectangle");
    const selected = async () => (await board()).peers.some((p: {selected?: string[]}) => p.selected?.includes(shape.id));
    await expect.poll(selected).toBe(true);
    await page.mouse.move(405, 245);
    await page.getByTestId("canvas").focus(); await page.keyboard.press("Escape");
    await expect.poll(selected).toBe(false);
    await page.keyboard.press("Control+a");
    await expect.poll(selected).toBe(true);
    const preview = await call("read_board", {session, ids:[shape.id], preview:true});
    const image = preview.content.find(c => c.type === "image");
    if (image?.type !== "image") throw new Error("Expected a rendered PNG: " + JSON.stringify(preview.content[0]));
    expect(image.mimeType).toBe("image/png");
    const pixelCount = await page.evaluate(async (base64: string) => {
      const bitmap = await createImageBitmap(await (await fetch("data:image/png;base64," + base64)).blob());
      const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data.filter((value, index) => index % 4 === 0 && value < 200).length;
    }, image.data);
    expect(pixelCount).toBeGreaterThan(10);
    const move = {op:"move", id:shape.id, version:shape.version, versionNonce:shape.versionNonce, x:shape.x+60, y:shape.y};
    const args = {session, requestId:crypto.randomUUID(), edits:[move, {op:"add_text", id:"label-one", x:shape.x, y:shape.y+120, text:"Reviewed"}]};
    const applied = await data("apply_edits", args);
    expect((await data("apply_edits", args)).applied).toEqual(applied.applied);
    await expect.poll(async () => (await elements(page)).find(e => e.id === shape.id)?.x).toBe(move.x);
    expect((await elements(page)).filter(e => e.id === "label-one")).toHaveLength(1);
    expect((await call("apply_edits", {session, requestId:crypto.randomUUID(), edits:[move]})).isError).toBe(true);
    let cursor = (await board()).cursor;
    expect((await data("wait_for_changes",{session,cursor,timeoutMs:25})).changed).toBe(false);
    const pending = data("wait_for_changes", {session,cursor,timeoutMs:8000});
    await page.keyboard.press("ArrowDown"); expect((await pending).changed).toBe(true);
    await expect.poll(async () => (await board()).elements.find((e: {id:string}) => e.id === shape.id).y).toBeGreaterThan(shape.y);
    await page.getByRole("button", {name:/^Share/}).click();
    cursor = (await board()).cursor;
    const revokedWait = call("wait_for_changes", {session,cursor,timeoutMs:8000});
    await dialog.getByRole("button",{name:"Revoke invite"}).click();
    expect((await revokedWait).isError).toBe(true);
    await expect(page.getByTestId("room-status")).toContainText("1 here");
    expect((await call("read_board",{session})).isError).toBe(true);
    expect((await call("join_room",{invite_url:invite})).isError).toBe(true);
    for (const link of [raw, raw.replace("/#room=", "/mcp/#room=")]) {
      const joined = await data("join_room", {invite_url:link});
      expect((await data("read_board",{session:joined.session})).elements.some((e:{id:string})=>e.id==="label-one")).toBe(true);
      await data("leave_room",{session:joined.session});
      expect((await call("read_board",{session:joined.session})).isError).toBe(true);
    }
    const wrong = raw.slice(0, raw.indexOf(",") + 1) + "AAAAAAAAAAAAAAAAAAAAAA";
    expect((await call("join_room", {invite_url:wrong})).isError).toBe(true);
    expect((await call("join_room", {invite_url:origin + "/#json=fixed"})).isError).toBe(true);
  } finally { await client.close(); }
}
