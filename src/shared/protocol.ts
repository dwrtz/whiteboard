// Messages between browsers and the room (Durable Object). The server never sees drawing content:
// `data` is base64 of an encrypted payload (see crypto.ts). Server-originated messages are plain JSON.
export type Peer = { id: string; name: string; color: string };
export type ClientMsg =
  | { t: "hello"; name: string }                   // first message after connecting
  | { t: "broadcast"; data: string; snapshot?: boolean; receipt?: string } // encrypted scene update; snapshot=true replaces the stored copy
  | { t: "volatile"; data: string }                // encrypted cursor/pointer update, not stored
  | { t: "save"; data: string }                    // encrypted full scene to keep for people who join later; not relayed
  | { t: "ping" };
export type ServerMsg =
  | { t: "welcome"; you: Peer; peers: Peer[]; snapshot: string | null } // snapshot = latest stored encrypted scene
  | { t: "peers"; peers: Peer[] }
  | { t: "broadcast"; from: string; data: string }
  | { t: "volatile"; from: string; data: string }
  | { t: "error"; error: string }
  | { t: "stored"; receipt: string }
  | { t: "pong" };
// Decrypted payloads of broadcast/volatile messages.
export type ScenePayload = { kind: "scene"; elements: unknown[]; full?: boolean };
export type PointerPayload = { kind: "pointer"; x: number; y: number; tool: "pointer" | "laser"; button: "up" | "down"; name: string; selected?: string[] } | { kind: "idle"; idle: boolean; name: string };
export const MAX_WS_MESSAGE = 4 * 1024 * 1024 + 4096; // encrypted scene ≤4 MiB plus envelope
export const MAX_PEERS = 32;
export const PEER_COLORS = ["#e03131", "#2f9e44", "#1971c2", "#f08c00", "#9c36b5", "#0c8599", "#e8590c", "#5c940d"];
export const FULL_SYNC_MS = 20000;
/** After local changes settle this long, the full encrypted scene is stored in the room for later joiners. */
export const SAVE_MS = 1000;
