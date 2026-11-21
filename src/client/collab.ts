// Live session client: end-to-end encrypted scene and pointer updates through the room's WebSocket.
import type { ClientMsg, ServerMsg, Peer, ScenePayload, PointerPayload } from "../shared/protocol";
import { FULL_SYNC_MS, SAVE_MS } from "../shared/protocol";
import { encrypt, decryptText, toB64, fromB64, encrypt as enc, decrypt } from "../shared/crypto";
import { reconcile } from "../shared/reconcile";
import { restoreElements } from "../shared/restore";
import type { Element, BinaryFile } from "../shared/types";
import type { Store } from "./store";
import { api } from "./api";

export type RoomStatus = "connecting" | "connected" | "reconnecting" | "error";
export const roomLink = (id: string, key: string) => `${location.origin}/#room=${id},${key}`;
export function parseRoomHash(hash: string): { id: string; key: string } | null {
  const m = /^#room=([a-f0-9]{20}),([A-Za-z0-9_-]{22})$/.exec(hash); return m ? { id: m[1], key: m[2] } : null;
}
export function parseJsonHash(hash: string): { id: string; key: string } | null {
  const m = /^#json=([A-Za-z0-9_-]{22}),([A-Za-z0-9_-]{22})$/.exec(hash); return m ? { id: m[1], key: m[2] } : null;
}

export class Collab {
  ws: WebSocket | null = null;
  status: RoomStatus = "connecting";
  me: Peer | null = null;
  peers: Peer[] = [];
  error = "";
  private sent = new Map<string, number>();
  private fullTimer: any = null; private saveTimer: any = null; private sendTimer: any = null; private lastPointer = 0; private retries = 0; private closed = false;
  private pointerTimer?: ReturnType<typeof setTimeout>;
  private currentPointer?: { x: number; y: number; button: "up" | "down" };
  private fetching = new Set<string>(); private uploadedFiles = new Set<string>();
  /** Called when the store changes locally (wired by the editor). */
  constructor(private s: Store, public id: string, public key: string, public name: string, private onUpdate: () => void, private isStarter: boolean) {}

  connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/rooms/${this.id}/ws`); this.ws = ws;
    ws.onopen = () => { this.retries = 0; this.send({ t: "hello", name: this.name }); };
    ws.onmessage = ev => this.receive(JSON.parse(String(ev.data)) as ServerMsg).catch(() => {});
    ws.onclose = () => {
      this.ws = null; clearInterval(this.fullTimer);
      if (this.closed) return;
      this.setStatus("reconnecting");
      setTimeout(() => { if (!this.closed) this.connect(); }, Math.min(10_000, 500 * 2 ** this.retries++));
    };
  }
  close() {
    clearTimeout(this.pointerTimer); this.currentPointer = undefined;
    this.closed = true; clearInterval(this.fullTimer); clearTimeout(this.sendTimer);
    const ws = this.ws; this.ws = null;
    if (this.saveTimer && ws && this.status === "connected") {
      // store the latest scene for whoever opens the link next, then go
      clearTimeout(this.saveTimer); this.saveTimer = null;
      const payload: ScenePayload = { kind: "scene", elements: this.s.elements.filter(e => e.index), full: true };
      void encrypt(this.key, JSON.stringify(payload)).then(d => ws.send(JSON.stringify({ t: "save", data: toB64(d) } satisfies ClientMsg))).catch(() => {}).finally(() => ws.close(1000));
    } else { clearTimeout(this.saveTimer); ws?.close(1000); }
  }
  rename(name: string) { this.name = name; this.send({ t: "hello", name }); }
  private setStatus(st: RoomStatus) { this.status = st; this.onUpdate(); }
  private send(m: ClientMsg) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }

  private async receive(m: ServerMsg) {
    if (m.t === "welcome") {
      this.me = m.you; this.peers = m.peers; this.setStatus("connected");
      if (m.snapshot) await this.applyScene(m.snapshot);
      if (this.isStarter && !m.snapshot) await this.sendFull();
      else await this.sendChanges(); // anything made while offline
      this.sendPointer();
      clearInterval(this.fullTimer); this.fullTimer = setInterval(() => this.sendFull(), FULL_SYNC_MS);
      return;
    }
    if (m.t === "peers") {
      const known = new Set(this.peers.map(p => p.id));
      this.peers = m.peers.filter(p => p.id !== this.me?.id);
      for (const id of [...this.s.collaborators.keys()]) if (!this.peers.some(p => p.id === id)) this.s.collaborators.delete(id);
      for (const p of this.peers) this.s.collaborators.set(p.id, { ...(this.s.collaborators.get(p.id) ?? {}), ...p });
      // someone new joined: send the whole scene so they are up to date at once
      if (this.peers.some(p => !known.has(p.id))) {
        await this.sendFull();
        this.sendPointer();
      }
      this.s.notify(); this.onUpdate(); return;
    }
    if (m.t === "broadcast") { await this.applyScene(m.data); return; }
    if (m.t === "volatile") {
      const p = JSON.parse(await decryptText(this.key, fromB64(m.data))) as PointerPayload;
      const c = this.s.collaborators.get(m.from); if (!c) return;
      if (p.kind === "pointer") Object.assign(c, { x: p.x, y: p.y, button: p.button, selected: p.selected, name: p.name, idle: false });
      else Object.assign(c, { idle: p.idle });
      this.s.notify(); return;
    }
    if (m.t === "error") { this.error = m.error; this.onUpdate(); }
  }
  private async applyScene(data: string) {
    const p = JSON.parse(await decryptText(this.key, fromB64(data))) as ScenePayload;
    const remote = restoreElements(p.elements, true).elements;
    const merged = reconcile(this.s.elements, remote, id => id === this.s.editingText || this.isDragging(id));
    for (const e of merged) this.sent.set(e.id, e.version); // don't echo what we just received
    this.s.applyRemote(merged);
    this.fetchFiles();
  }
  private isDragging(id: string) { return this.s.dragging && this.s.selected.has(id); }
  /** Send the elements that changed since the last send (throttled). */
  scheduleChanges() { if (this.sendTimer) return; this.sendTimer = setTimeout(() => { this.sendTimer = null; this.sendChanges(); }, 50); }
  async sendChanges() {
    const changed = this.s.elements.filter(e => e.index && this.sent.get(e.id) !== e.version);
    if (!changed.length || this.status !== "connected") return;
    await this.broadcast(changed, false);
    this.uploadFiles();
    // keep the room's stored copy current for people who join later (not relayed to anyone)
    clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => { this.saveTimer = null; this.saveSnapshot(); }, SAVE_MS);
  }
  private async saveSnapshot() {
    if (this.status !== "connected") return;
    const payload: ScenePayload = { kind: "scene", elements: this.s.elements.filter(e => e.index), full: true };
    this.send({ t: "save", data: toB64(await encrypt(this.key, JSON.stringify(payload))) });
  }
  async sendFull() { if (this.status !== "connected") return; await this.broadcast(this.s.elements, true); this.uploadFiles(); }
  private async broadcast(all: Element[], snapshot: boolean) {
    const els = all.filter(e => e.index); // one being drawn right now has no key yet; it goes out when committed
    const payload: ScenePayload = { kind: "scene", elements: els, full: snapshot };
    const data = toB64(await encrypt(this.key, JSON.stringify(payload)));
    for (const e of els) this.sent.set(e.id, e.version);
    this.send({ t: "broadcast", data, snapshot });
  }
  pointer(x: number, y: number, button: "up" | "down") {
    this.currentPointer = { x, y, button };
    this.sendPointer();
  }
  private sendPointer() {
    if (this.closed || this.status !== "connected" || !this.currentPointer || this.pointerTimer) return;
    this.pointerTimer = setTimeout(() => {
      this.pointerTimer = undefined;
      const point = this.currentPointer;
      if (!point || this.closed) return;
      this.lastPointer = Date.now();
      const p: PointerPayload = { kind: "pointer", ...point, tool: "pointer", name: this.name, selected: [...this.s.selected] };
      void encrypt(this.key, JSON.stringify(p)).then(d => this.send({ t: "volatile", data: toB64(d) })).catch(() => {});
    }, Math.max(0, 33 - (Date.now() - this.lastPointer)));
  }
  // Images travel encrypted through R2: PUT/GET /api/rooms/:id/files/:fileId
  private async uploadFiles() {
    for (const e of this.s.live()) {
      const id = (e as any).fileId as string | undefined; const f = id && this.s.files[id];
      if (!f || this.uploadedFiles.has(f.id)) continue; this.uploadedFiles.add(f.id);
      try { const body = await enc(this.key, JSON.stringify({ mimeType: f.mimeType, dataURL: f.dataURL })); await api(`/api/rooms/${this.id}/files/${f.id}`, { method: "PUT", raw: body, headers: { "content-type": "application/octet-stream" } }); }
      catch { this.uploadedFiles.delete(f.id); }
    }
  }
  private fetchFiles() {
    for (const e of this.s.live()) {
      const id = (e as any).fileId as string | undefined;
      if (!id || this.s.files[id] || this.fetching.has(id)) continue; this.fetching.add(id);
      const tryGet = async (n: number): Promise<void> => {
        const r = await fetch(`/api/rooms/${this.id}/files/${id}`);
        if (!r.ok) { if (n < 5) { await new Promise(ok => setTimeout(ok, 1000 * (n + 1))); return tryGet(n + 1); } return; }
        const f = JSON.parse(new TextDecoder().decode(await decrypt(this.key, new Uint8Array(await r.arrayBuffer())))) as { mimeType: string; dataURL: string };
        this.uploadedFiles.add(id);
        this.s.addFiles([{ id, mimeType: f.mimeType, dataURL: f.dataURL, created: Date.now() } as BinaryFile]);
      };
      tryGet(0).catch(() => {}).finally(() => this.fetching.delete(id));
    }
  }
}
/** A new session id: 10 random bytes as hex. Rooms need no sign-up; the id and key are made here. */
export function newRoomId(): string { return [...crypto.getRandomValues(new Uint8Array(10))].map(b => b.toString(16).padStart(2, "0")).join(""); }
