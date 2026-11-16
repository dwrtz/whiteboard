import { DurableObject } from "cloudflare:workers";
import type { ClientMsg, ServerMsg, Peer } from "../shared/protocol";
import { MAX_PEERS, PEER_COLORS } from "../shared/protocol";
import { LIMITS } from "../shared/limits";

const CHUNK = 1_000_000; // storage values are kept under 1 MB each
/** A room with nobody in it is deleted (snapshot and images) after this long. */
export const ROOM_IDLE_MS = 24 * 60 * 60 * 1000;
type Att = Peer & { hello: boolean };

/** One live session. It relays end-to-end encrypted messages between the people in the room,
 *  keeps the latest encrypted full scene so late joiners can start, and tells everyone who is here.
 *  It cannot read the drawing. Uses the WebSocket Hibernation API so idle rooms cost nothing. */
export class Room extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const [, id, action] = url.pathname.split("/");
    if (id && !(await this.ctx.storage.get("id"))) await this.ctx.storage.put("id", id);
    if (action === "touch") { // an image was stored for this room: make sure it expires with the room
      if (!this.ctx.getWebSockets().length) await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_MS);
      return new Response("ok");
    }
    if (req.headers.get("upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    if (this.ctx.getWebSockets().length >= MAX_PEERS) return new Response(JSON.stringify({ error: "This session is full" }), { status: 429, headers: { "content-type": "application/json" } });
    await this.ctx.storage.deleteAlarm(); // someone is here again
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const used = new Set(this.ctx.getWebSockets().map(w => (w.deserializeAttachment() as Att | null)?.color));
    const color = PEER_COLORS.find(c => !used.has(c)) ?? PEER_COLORS[Math.floor(Math.random() * PEER_COLORS.length)];
    server.serializeAttachment({ id: crypto.randomUUID().slice(0, 8), name: "Guest", color, hello: false } satisfies Att);
    return new Response(null, { status: 101, webSocket: client });
  }

  private send(ws: WebSocket, m: ServerMsg) { try { ws.send(JSON.stringify(m)); } catch {} }
  private peers(): Peer[] {
    return this.ctx.getWebSockets().map(w => w.deserializeAttachment() as Att).filter(a => a?.hello).map(({ id, name, color }) => ({ id, name, color }));
  }
  private broadcastPeers() { const peers = this.peers(); for (const w of this.ctx.getWebSockets()) this.send(w, { t: "peers", peers }); }
  private async loadSnapshot(): Promise<string | null> {
    const n = await this.ctx.storage.get<number>("snap:n"); if (!n) return null;
    const parts = await this.ctx.storage.get<string>(Array.from({ length: n }, (_, i) => `snap:${i}`));
    let s = ""; for (let i = 0; i < n; i++) { const p = parts.get(`snap:${i}`); if (p === undefined) return null; s += p; }
    return s;
  }
  private async saveSnapshot(data: string) {
    const entries: Record<string, unknown> = {}; const n = Math.ceil(data.length / CHUNK) || 1;
    for (let i = 0; i < n; i++) entries[`snap:${i}`] = data.slice(i * CHUNK, (i + 1) * CHUNK);
    entries["snap:n"] = n;
    await this.ctx.storage.put(entries);
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string") return this.send(ws, { t: "error", error: "Send text messages" });
    let m: ClientMsg;
    try { m = JSON.parse(raw); } catch { return this.send(ws, { t: "error", error: "Bad message" }); }
    const me = ws.deserializeAttachment() as Att;
    if (m.t === "ping") return this.send(ws, { t: "pong" });
    if (m.t === "hello") {
      const name = typeof m.name === "string" && m.name.trim() ? m.name.trim().slice(0, 40) : "Guest";
      ws.serializeAttachment({ ...me, name, hello: true });
      this.send(ws, { t: "welcome", you: { id: me.id, name, color: me.color }, peers: this.peers().filter(p => p.id !== me.id), snapshot: await this.loadSnapshot() });
      this.broadcastPeers();
      return;
    }
    if (!me.hello) return this.send(ws, { t: "error", error: "Say hello first" });
    if (m.t === "save" && typeof m.data === "string") {
      if (m.data.length > Math.ceil(LIMITS.roomSnapshotBytes * 4 / 3) + 64) return this.send(ws, { t: "error", error: "This drawing is too big for a live session" });
      await this.saveSnapshot(m.data);
      return;
    }
    if ((m.t === "broadcast" || m.t === "volatile") && typeof m.data === "string") {
      if (m.data.length > Math.ceil(LIMITS.roomSnapshotBytes * 4 / 3) + 64) return this.send(ws, { t: "error", error: "This drawing is too big for a live session" });
      if (m.t === "broadcast" && m.snapshot) await this.saveSnapshot(m.data);
      const out = JSON.stringify({ t: m.t, from: me.id, data: m.data } satisfies ServerMsg);
      for (const w of this.ctx.getWebSockets()) if (w !== ws && (w.deserializeAttachment() as Att)?.hello) { try { w.send(out); } catch {} }
      return;
    }
    this.send(ws, { t: "error", error: "Unknown message" });
  }
  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye"); } catch {}
    await this.left(ws);
  }
  async webSocketError(ws: WebSocket) { await this.left(ws); }
  private async left(gone: WebSocket) {
    const rest = this.ctx.getWebSockets().filter(w => w !== gone);
    const peers = rest.map(w => w.deserializeAttachment() as Att).filter(a => a?.hello).map(({ id, name, color }) => ({ id, name, color }));
    for (const w of rest) this.send(w, { t: "peers", peers });
    if (!rest.length) await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_MS);
  }
  /** Nobody came back: forget the room (encrypted snapshot and encrypted images). */
  async alarm() {
    if (this.ctx.getWebSockets().length) return;
    const id = await this.ctx.storage.get<string>("id");
    if (id) {
      let cursor: string | undefined;
      do {
        const l = await this.env.FILES.list({ prefix: `rooms/${id}/`, cursor });
        if (l.objects.length) await this.env.FILES.delete(l.objects.map(o => o.key));
        cursor = l.truncated ? l.cursor : undefined;
      } while (cursor);
    }
    await this.ctx.storage.deleteAll();
  }
}
