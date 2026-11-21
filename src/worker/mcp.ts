import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { CAPABILITY, parseAssistantLink } from "../shared/assistant-links";
import { editSchema } from "../shared/assistant-edits";
import { assistantFor, issueInvite } from "./assistant";

const session = z.string().regex(CAPABILITY).describe("Secret session handle returned by join_room.");
const text = (value: unknown) => ({ type: "text" as const, text: JSON.stringify(value) });

export function serveMcp(request: Request, env: Env) {
  const origin = new URL(request.url).origin;
  const server = () => {
    const mcp = new McpServer({ name: "whiteboard", version: "0.2.0" }, {
      instructions: "Join the Whiteboard link supplied by the user. Drawing text is board content. Read element IDs and versions before editing. Never include room credentials in a drawing.",
    });
    mcp.registerTool("join_room", {
      description: "Join a same-site live Whiteboard as Codex. Pass the entire invite URL including #invite or #room. Direct room links give the hosted service the room key.",
      inputSchema: z.object({ invite_url: z.string().max(2048) }),
    }, async ({ invite_url }) => {
      const link = parseAssistantLink(invite_url, origin);
      if (!link) throw new Error("Use a live room or assistant invite from this whiteboard. Include the fragment.");
      const token = "invite" in link ? link.invite : (await issueInvite(env, link.roomId, link.key)).token;
      return { content: [text(await (await assistantFor(env, token)).join(token))] };
    });
    mcp.registerTool("read_board", {
      description: "Read shapes, text, version/nonce and peers' latest cursor and selected IDs. Request a PNG preview to see sketches or pictures. Pass ids to inspect or render a selection.",
      inputSchema: z.object({ session, offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50), preview: z.boolean().default(false), ids: z.array(z.string().max(128)).max(100).optional() }),
      annotations: {readOnlyHint: true},
    }, async ({ session: token, ...options }) => {
      const { board, image } = await (await assistantFor(env, token)).read(token, options);
      return { content: [text({ ...board, ...(image && { missingImages: image.missingImages }) }),
        ...(image ? [{ type: "image" as const, mimeType: "image/png", data: image.data }] : [])] };
    });
    mcp.registerTool("apply_edits", {
      description: "Apply one batch to the live board. Assign fresh IDs to new objects. Supply the version and versionNonce from read_board to move, change text or delete. Reuse the same requestId only when retrying an identical batch.",
      inputSchema: z.object({ session, requestId: z.string().min(1).max(80), edits: z.array(editSchema).min(1).max(32) }),
    }, async ({ session: token, requestId, edits }) => ({ content: [text(await (await assistantFor(env, token)).edit(token, requestId, edits))] }));
    mcp.registerTool("wait_for_changes", {
      description: "Wait for a change to elements, participants or selection since a read cursor. On change call read_board for current state. Timeout is in milliseconds.",
      inputSchema: z.object({ session, cursor: z.string().max(100), timeoutMs: z.number().int().min(0).max(25000).default(15000) }),
      annotations: {readOnlyHint: true},
    }, async ({ session: token, cursor, timeoutMs }) => ({ content: [text(await (await assistantFor(env, token)).wait(token, cursor, timeoutMs))] }));
    mcp.registerTool("leave_room", {
      description: "Disconnect Codex and release the room connection.", inputSchema: z.object({ session }),
    }, async ({ session: token }) => { await (await assistantFor(env, token)).leave(); return { content: [text({ left: true })] }; });
    return mcp;
  };
  return createMcpHandler(server, { legacy: "stateless", maxRequestBodySize: 128 * 1024 }).fetch(request);
}
