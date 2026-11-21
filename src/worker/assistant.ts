import { DurableObject } from "cloudflare:workers";
import { decryptText, encrypt, fromB64, generateKey, toB64 } from "../shared/crypto";
import { IDLE_PEER_MS, INVITE_TTL_MS } from "../shared/assistant-links";
import { applyBoardEdits, type BoardEdit } from "../shared/assistant-edits";
import { LIMITS } from "../shared/limits";
import { bounds } from "../shared/geometry";
import { restoreElements } from "../shared/restore";
import { reconcile } from "../shared/reconcile";
import type { Peer, PointerPayload, ServerMsg } from "../shared/protocol";
import { isImage, isText, isLinear, type Element } from "../shared/types";
import { renderPreview } from "./assistant-preview";

interface Grant { roomId: string; wrappedKey: string; revokeHash: string; expiresAt: number; joined: boolean }
interface EditResult { cursor: string; applied: { id: string; version: number; versionNonce: number; deleted: boolean }[] }
interface Receipt { id: string; digest: string; result: string }
type Pointer = Extract<PointerPayload, { kind: "pointer" }>;
export interface ReadOptions { offset: number; limit: number; preview: boolean; ids?: string[] }
export async function digest(value: string) {
  return toB64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
export async function assistantFor(env: Env, token: string) {
  return env.ASSISTANTS.getByName(await digest(token));
}
function describe(e: Element) {
  return { id: e.id, type: e.type, x: e.x, y: e.y, width: e.width, height: e.height, angle: e.angle, bounds: bounds(e),
    version: e.version, versionNonce: e.versionNonce, locked: e.locked, strokeColor: e.strokeColor, backgroundColor: e.backgroundColor,
    ...(isText(e) ? { text: e.text.slice(0, 8192), truncated: e.text.length > 8192 } : {}),
    ...(isLinear(e) ? { from: e.startBinding?.elementId, to: e.endBinding?.elementId } : {}),
    ...(isImage(e) ? { fileId: e.fileId } : {}) };
}
async function decodeScene(key: string, sealed: string) {
  const scene = JSON.parse(await decryptText(key, fromB64(sealed)));
  if (scene?.kind !== "scene" || !Array.isArray(scene.elements)) throw new Error("Invalid room scene.");
  return restoreElements(scene.elements, true).elements;
}

export class AssistantSession extends DurableObject<Env> {
  private socket?: WebSocket;
  private key = "";
  private elements: Element[] = [];
  private peers: Peer[] = [];
  private pointers = new Map<string, Pointer>();
  private peerId = "";
  private epoch = crypto.randomUUID();
  private revision = 0;
  private idleAt = 0;
  private tail: Promise<void> = Promise.resolve();
  private waiters = new Set<() => void>();
  private acknowledge?: { id: string; settle: (saved: boolean) => void };

  // Apply asynchronous decryptions and tool calls in arrival order. Socket acknowledgments
  // resolve outside this queue so the operation waiting for one can release it.
  private ordered<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task);
    this.tail = next.then(() => {}, () => {});
    return next;
  }
  private get cursor() { return this.epoch + "." + this.revision; }
  private changed() { this.revision++; for (const wake of this.waiters) wake(); }
  private disconnect() {
    const socket = this.socket;
    this.socket = undefined;
    try { socket?.close(1000, "Assistant left"); } catch { /* already closed */ }
    this.key = ""; this.elements = []; this.peers = []; this.pointers.clear(); this.peerId = "";
    this.acknowledge?.settle(false); this.epoch = crypto.randomUUID(); this.changed();
  }
  async issue(token: string, roomId: string, roomKey: string, revokeHash: string) {
    return this.ordered(async () => {
      const snapshot = await this.env.ROOMS.getByName(roomId).loadSnapshot();
      if (!snapshot) throw new Error("The room has no saved scene yet. Start a live session and try again.");
      try { await decodeScene(roomKey, snapshot); } catch { throw new Error("The key cannot open this room."); }
      const expiresAt = Date.now() + INVITE_TTL_MS;
      const wrappedKey = toB64(await encrypt(token, roomKey));
      await this.ctx.storage.put("grant", { roomId, wrappedKey, revokeHash, expiresAt, joined: false } satisfies Grant);
      await this.ctx.storage.setAlarm(expiresAt);
      return expiresAt;
    });
  }
  private async grant(): Promise<Grant> {
    const grant = await this.ctx.storage.get<Grant>("grant");
    if (!grant || Date.now() >= grant.expiresAt) throw new Error("This assistant invite has expired or was revoked.");
    return grant;
  }
  private async connectRoom(grant: Grant, token: string) {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    this.disconnect();
    const key = await decryptText(token, fromB64(grant.wrappedKey));
    const room = this.env.ROOMS.getByName(grant.roomId);
    const response = await room.fetch("https://room/" + grant.roomId, { headers: { upgrade: "websocket" } });
    const socket = response.webSocket;
    if (!socket) throw new Error(response.status === 429 ? "This session is full." : "Could not connect to the room.");
    this.socket = socket; this.key = key;
    try {
      const welcome = await new Promise<Extract<ServerMsg, {t: "welcome"}>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Room connection timed out.")), 5000);
        const closed = () => {
          clearTimeout(timer); reject(new Error("Room connection closed."));
          if (socket === this.socket) this.disconnect();
        };
        socket.addEventListener("close", closed);
        socket.addEventListener("error", closed);
        socket.addEventListener("message", event => {
          if (socket !== this.socket || typeof event.data !== "string") return;
          let msg: ServerMsg;
          try { msg = JSON.parse(event.data); } catch { return; }
          if (msg.t === "welcome") { clearTimeout(timer); resolve(msg); return; }
          if (msg.t === "stored" && msg.receipt === this.acknowledge?.id) { this.acknowledge?.settle(true); return; }
          if (msg.t === "error") { this.acknowledge?.settle(false); return; }
          this.ctx.waitUntil(this.ordered(async () => {
            if (socket === this.socket) await this.receive(msg);
          }).catch(() => { /* Discard unreadable messages from a peer. */ }));
        });
        socket.accept(); socket.send(JSON.stringify({ t: "hello", name: "Codex" }));
      });
      if (!welcome.snapshot) throw new Error("The room has expired.");
      const elements = await decodeScene(key, welcome.snapshot);
      if (socket !== this.socket) throw new Error("Room connection closed.");
      this.elements = elements;
      this.peers = welcome.peers; this.peerId = welcome.you.id;
      this.changed();
    } catch (error) { this.disconnect(); throw error; }
  }
  private async receive(msg: ServerMsg) {
    const socket = this.socket;
    if (msg.t === "peers") {
      const peers = msg.peers.filter(p => p.id !== this.peerId);
      for (const id of this.pointers.keys()) if (!peers.some(p => p.id === id)) this.pointers.delete(id);
      if (JSON.stringify(peers) !== JSON.stringify(this.peers)) { this.peers = peers; this.changed(); }
    } else if (msg.t === "volatile") {
      const p: PointerPayload = JSON.parse(await decryptText(this.key, fromB64(msg.data)));
      if (socket !== this.socket || p.kind !== "pointer" || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      const previous = this.pointers.get(msg.from);
      const selected = Array.isArray(p.selected) ? p.selected.filter(id => typeof id === "string").slice(0, 256) : [];
      this.pointers.set(msg.from, { ...p, selected });
      // Keep the latest cursor, wake a wait on meaningful selection changes.
      if (!previous || JSON.stringify(previous.selected) !== JSON.stringify(selected)) this.changed();
    } else if (msg.t === "broadcast") {
      const incoming = await decodeScene(this.key, msg.data);
      if (socket !== this.socket) return;
      const merged = reconcile(this.elements, incoming);
      if (merged.length !== this.elements.length || merged.some((e, i) => e !== this.elements[i])) {
        this.elements = merged; this.changed();
      }
    }
  }
  private async access(token: string, joining = false) {
    const grant = await this.grant();
    if (!joining && !grant.joined) throw new Error("Join the room first.");
    await this.connectRoom(grant, token);
    if (joining && !grant.joined) { grant.joined = true; await this.ctx.storage.put("grant", grant); }
    this.idleAt = Date.now() + IDLE_PEER_MS;
    await this.ctx.storage.setAlarm(Math.min(this.idleAt, grant.expiresAt));
    return grant;
  }
  async join(token: string) {
    return this.ordered(async () => {
      const grant = await this.access(token, true);
      return { session: token, participant: "Codex", expiresAt: grant.expiresAt, cursor: this.cursor };
    });
  }
  async read(token: string, options: ReadOptions) {
    return this.ordered(async () => {
      const grant = await this.access(token);
      const ids = options.ids && new Set(options.ids);
      const live = this.elements.filter(e => !e.isDeleted && (!ids || ids.has(e.id)));
      const end = options.offset + options.limit;
      const board = { cursor: this.cursor, total: live.length, nextOffset: end < live.length ? end : null,
        elements: live.slice(options.offset, end).map(describe),
        peers: this.peers.map(peer => { const p = this.pointers.get(peer.id); return { ...peer, ...(p && { x: p.x, y: p.y, button: p.button, selected: p.selected }) }; }) };
      const image = options.preview ? await renderPreview(live, grant.roomId, this.key, this.env.FILES) : null;
      return { board, image };
    });
  }
  private async broadcastSaved(scene: Element[]) {
    const plain = JSON.stringify({kind: "scene", elements: scene, full: true});
    if (new TextEncoder().encode(plain).length + 28 > LIMITS.roomSnapshotBytes) throw new Error("This edit would exceed the room size limit.");
    const data = toB64(await encrypt(this.key, plain));
    const receipt = crypto.randomUUID();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("Room disconnected. Rejoin and read the board.");
    const stored = await new Promise<boolean>((resolve, reject) => {
      const settle = (saved: boolean) => { clearTimeout(timer); this.acknowledge = undefined; resolve(saved); };
      const timer = setTimeout(() => settle(false), 5000);
      this.acknowledge = { id: receipt, settle };
      try { socket.send(JSON.stringify({ t: "broadcast", data, snapshot: true, receipt })); }
      catch (e) { clearTimeout(timer); this.acknowledge = undefined; reject(e); }
    });
    if (!stored) { this.disconnect(); throw new Error("Room did not confirm the edit. Read the current board before retrying."); }
  }
  async edit(token: string, requestId: string, edits: BoardEdit[]): Promise<EditResult> {
    return this.ordered(async () => {
      await this.access(token);
      const receipts = await this.ctx.storage.get<Receipt[]>("receipts") ?? [];
      const hash = await digest(JSON.stringify(edits));
      const previous = receipts.find(item => item.id === requestId);
      if (previous) {
        if (previous.digest !== hash) throw new Error("Request ID was already used for another edit.");
        return JSON.parse(await decryptText(token, fromB64(previous.result)));
      }
      const next = applyBoardEdits(this.elements, edits, Date.now());
      await this.broadcastSaved(next);
      this.elements = next; this.changed();
      const ids = new Set(edits.map(e => e.id));
      const result = { cursor: this.cursor, applied: next.filter(e => ids.has(e.id)).map(e => ({ id:e.id, version:e.version, versionNonce:e.versionNonce, deleted:e.isDeleted })) };
      const saved = toB64(await encrypt(token, JSON.stringify(result)));
      await this.ctx.storage.put("receipts", [...receipts.slice(-63), { id:requestId, digest:hash, result:saved }]);
      return result;
    });
  }
  async wait(token: string, cursor: string, timeoutMs: number) {
    const { pending } = await this.ordered(async () => {
      const grant = await this.access(token);
      if (this.waiters.size >= 4) throw new Error("Too many pending waits for this session.");
      const pending = cursor !== this.cursor ? Promise.resolve() : new Promise<void>(resolve => {
        const wake = () => { clearTimeout(timer); this.waiters.delete(wake); resolve(); };
        const timer = setTimeout(wake, Math.min(timeoutMs, Math.max(0, grant.expiresAt - Date.now())));
        this.waiters.add(wake);
      });
      return { pending };
    });
    await pending;
    return this.ordered(async () => {
      if (!(await this.grant()).joined) throw new Error("The assistant left the room.");
      return { cursor: this.cursor, changed: cursor !== this.cursor };
    });
  }
  async leave() {
    return this.ordered(async () => {
      const grant = await this.grant();
      this.disconnect(); grant.joined = false;
      await this.ctx.storage.put("grant", grant); await this.ctx.storage.setAlarm(grant.expiresAt);
    });
  }
  async revoke(secret: string) {
    return this.ordered(async () => {
      const grant = await this.ctx.storage.get<Grant>("grant");
      if (!grant) return true;
      if (await digest(secret) !== grant.revokeHash) return false;
      this.disconnect(); await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); return true;
    });
  }
  async alarm() {
    return this.ordered(async () => {
      const grant = await this.ctx.storage.get<Grant>("grant");
      if (!grant || Date.now() >= grant.expiresAt) { this.disconnect(); await this.ctx.storage.deleteAll(); return; }
      if (Date.now() >= this.idleAt) this.disconnect();
      await this.ctx.storage.setAlarm(this.socket ? Math.min(grant.expiresAt, this.idleAt) : grant.expiresAt);
    });
  }
}

export async function issueInvite(env: Env, roomId: string, key: string) {
  const token = await generateKey(), revokeSecret = await generateKey();
  const session = await assistantFor(env, token);
  const expiresAt = await session.issue(token, roomId, key, await digest(revokeSecret));
  return { token, revokeSecret, expiresAt };
}
