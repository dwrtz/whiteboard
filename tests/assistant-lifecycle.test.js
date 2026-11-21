import { afterEach, expect, it, vi } from "vitest";
import { decryptText, encrypt, fromB64, generateKey, toB64 } from "../src/shared/crypto";
import { IDLE_PEER_MS, INVITE_TTL_MS } from "../src/shared/assistant-links";
import { AssistantSession, digest } from "../src/worker/assistant";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  },
}));
vi.mock("../src/worker/assistant-preview", () => ({ renderPreview: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

it("disconnects an idle guest, reconnects with its grant and clears storage on expiry", async () => {
  const start = Date.now();
  const now = vi.spyOn(Date, "now").mockReturnValue(start);
  const entries = new Map();
  const storage = {
    get: async key => entries.get(key),
    put: async (key, value) => entries.set(key, value),
    deleteAll: async () => entries.clear(),
    setAlarm: vi.fn(),
  };
  const token = await generateKey(), key = await generateKey();
  const snapshot = toB64(await encrypt(key, JSON.stringify({ kind: "scene", elements: [] })));
  const sockets = [];
  const room = {
    loadSnapshot: async () => snapshot,
    fetch: async () => {
      const socket = Object.assign(new EventTarget(), {
        readyState: WebSocket.OPEN,
        accept() {},
        send() {
          const welcome = { t: "welcome", you: { id: "guest" }, peers: [], snapshot };
          this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(welcome) }));
        },
        close: vi.fn(),
      });
      sockets.push(socket);
      return { webSocket: socket };
    },
  };
  const session = new AssistantSession({ storage }, { ROOMS: { getByName: () => room } });
  const expiry = await session.issue(token, "a".repeat(20), key, await digest(await generateKey()));
  expect(expiry).toBe(start + INVITE_TTL_MS);
  expect(await decryptText(token, fromB64(entries.get("grant").wrappedKey))).toBe(key);
  expect(await session.revoke(token)).toBe(false);

  const joined = await session.join(token);
  expect(storage.setAlarm).toHaveBeenLastCalledWith(start + IDLE_PEER_MS);
  now.mockReturnValue(start + IDLE_PEER_MS);
  await session.alarm();
  expect(sockets[0].close).toHaveBeenCalledOnce();
  expect(storage.setAlarm).toHaveBeenLastCalledWith(expiry);
  const options = { offset: 0, limit: 50, preview: false };
  const { board } = await session.read(token, options);
  expect(sockets).toHaveLength(2);
  expect(board.cursor).not.toBe(joined.cursor);

  now.mockReturnValue(expiry);
  await expect(session.read(token, options)).rejects.toThrow("expired or was revoked");
  await session.alarm();
  expect(sockets[1].close).toHaveBeenCalledOnce();
  expect(entries.size).toBe(0);
  await expect(session.join(token)).rejects.toThrow("expired or was revoked");
});
