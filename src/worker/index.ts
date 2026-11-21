// Room traffic and R2 blobs are encrypted. Explicitly invited MCP guests decrypt their room.
import { LIMITS } from "../shared/limits";
import { HttpError, Router, json } from "./http";
import { serveMcp } from "./mcp";
import { assistantFor, issueInvite } from "./assistant";
import { CAPABILITY, ROOM } from "../shared/assistant-links";
export { AssistantSession } from "./assistant";
export { Room } from "./room";

const LINK_ID = /^[A-Za-z0-9_-]{22}$/;
const ROOM_ID = /^[a-f0-9]{20}$/;
const FILE_ID = /^[a-f0-9]{40}$/;
// Stored bytes are opaque ciphertext; never let a browser treat them as a page.
const BLOB_HEADERS = { "content-type": "application/octet-stream", "content-security-policy": "default-src 'none'; sandbox", "x-content-type-options": "nosniff" };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      if (req.method !== "GET" && req.method !== "HEAD" || req.headers.get("upgrade") === "websocket") {
        const origin = req.headers.get("origin");
        if (origin && origin !== url.origin) throw new HttpError(403, "Cross-site request refused");
      }
      if (url.pathname === "/api/mcp") {
        if (url.search) throw new HttpError(400, "Use the MCP endpoint without query parameters");
        await limit(env.ASSISTANT_LIMIT, req, "assistant requests");
        const result = await serveMcp(req, env);
        const headers = new Headers(result.headers); headers.set("cache-control", "no-store");
        return new Response(result.body, { status: result.status, headers });
      }
      return await routes(env, req).handle(req);
    } catch (e: any) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, e.status === 429 ? { "retry-after": "60" } : {});
      console.error("unexpected error", e?.stack || e);
      return json({ error: "Something went wrong on our side. Try again." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

/** Per-address rate limits (Workers Rate Limiting binding). */
async function limit(rl: RateLimit, req: Request, what: string) {
  const ip = req.headers.get("cf-connecting-ip") || "local";
  const { success } = await rl.limit({ key: ip });
  if (!success) throw new HttpError(429, `Too many ${what} from your address. Wait a minute and try again.`);
}
async function readBytes(req: Request, max: number, tooBig: string): Promise<Uint8Array> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > max) throw new HttpError(413, tooBig);
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length > max) throw new HttpError(413, tooBig);
  return buf;
}
const b64url = (n: number) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function routes(env: Env, req: Request) {
  const r = new Router();
  r.on("GET", "/api/health", async () => json({ ok: true }));

  r.on("POST", "/api/assistant-invites", async q => {
    const bytes = await readBytes(q, 2048, "Invite request is too large");
    let value;
    try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, "Send a room ID and key"); }
    if (typeof value?.roomId !== "string" || !ROOM.test(value.roomId) || typeof value.key !== "string" || !CAPABILITY.test(value.key)) throw new HttpError(400, "Invalid room credentials");
    await limit(env.ASSISTANT_LIMIT, q, "assistant requests");
    try { return json(await issueInvite(env, value.roomId, value.key), 201); }
    catch { throw new HttpError(400, "Could not open the saved room with this key. Wait until connected and try again."); }
  });
  r.on("DELETE", "/api/assistant-invites", async q => {
    const bytes = await readBytes(q, 2048, "Invite request is too large");
    let value;
    try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, "Invalid revocation request"); }
    if (typeof value?.token !== "string" || typeof value?.revokeSecret !== "string" || !CAPABILITY.test(value.token) || !CAPABILITY.test(value.revokeSecret)) throw new HttpError(400, "Invalid invite credentials");
    await limit(env.ASSISTANT_LIMIT, q, "assistant requests");
    if (!await (await assistantFor(env, value.token)).revoke(value.revokeSecret)) throw new HttpError(403, "Invalid revocation credential");
    return json({ revoked: true });
  });

  // ---------- Encrypted share links ----------
  r.on("POST", "/api/links", async (q) => {
    // every rejection runs before the rate limit, so a refused request never spends a slot
    const bytes = await readBytes(q, LIMITS.encryptedLinkBytes, `This drawing is too big to share as a link (limit ${LIMITS.encryptedLinkBytes / 1024 / 1024} MB)`);
    if (bytes.length < 29) throw new HttpError(400, "Send the encrypted drawing");
    await limit(env.LINK_LIMIT, q, "share links");
    const id = b64url(16);
    await env.FILES.put(`links/${id}`, bytes, { httpMetadata: { contentType: "application/octet-stream" } });
    return json({ id }, 201);
  });
  r.on("GET", "/api/links/:id", async (_q, p) => {
    const obj = LINK_ID.test(p.id) ? await env.FILES.get(`links/${p.id}`) : null;
    if (!obj) throw new HttpError(404, "This link doesn't exist");
    return new Response(obj.body, { headers: { ...BLOB_HEADERS, "cache-control": "public, max-age=31536000, immutable" } });
  });

  // ---------- Live sessions ----------
  const room = (id: string) => { if (!ROOM_ID.test(id)) throw new HttpError(404, "Not a session link"); return id; };
  r.on("GET", "/api/rooms/:id/ws", async (q, p) => {
    const id = room(p.id);
    if (q.headers.get("upgrade") !== "websocket") throw new HttpError(426, "Expected a WebSocket upgrade");
    await limit(env.ROOM_LIMIT, q, "session connections");
    return env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(new Request(`https://room/${id}`, q));
  });
  r.on("PUT", "/api/rooms/:id/files/:fileId", async (q, p) => {
    const id = room(p.id);
    if (!FILE_ID.test(p.fileId)) throw new HttpError(400, "Bad file id");
    const bytes = await readBytes(q, LIMITS.roomFileBytes, "Images can be up to 4 MB");
    const key = `rooms/${id}/${p.fileId}`;
    if (await env.FILES.head(key)) return json({ id: p.fileId });
    const l = await env.FILES.list({ prefix: `rooms/${id}/`, limit: LIMITS.roomFiles });
    if (l.objects.length >= LIMITS.roomFiles) throw new HttpError(413, `A session can hold up to ${LIMITS.roomFiles} images`);
    await limit(env.FILE_LIMIT, q, "image uploads");
    await env.FILES.put(key, bytes, { httpMetadata: { contentType: "application/octet-stream" } });
    // the room deletes its images when it expires
    await env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(new Request(`https://room/${id}/touch`, { method: "POST" }));
    return json({ id: p.fileId }, 201);
  });
  r.on("GET", "/api/rooms/:id/files/:fileId", async (_q, p) => {
    const id = room(p.id);
    const obj = FILE_ID.test(p.fileId) ? await env.FILES.get(`rooms/${id}/${p.fileId}`) : null;
    if (!obj) throw new HttpError(404, "Image not found");
    return new Response(obj.body, { headers: { ...BLOB_HEADERS, "cache-control": "private, max-age=86400" } });
  });
  return r;
}
