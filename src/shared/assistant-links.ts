export const CAPABILITY = /^[A-Za-z0-9_-]{22}$/;
export const ROOM = /^[a-f0-9]{20}$/;
export const INVITE_TTL_MS = 60 * 60 * 1000;
export const IDLE_PEER_MS = 5 * 60 * 1000;

export type AssistantLink = { roomId: string; key: string } | { invite: string };

export function parseAssistantLink(value: string, origin: string): AssistantLink | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== origin || url.username || url.password || url.search) return null;
  if (!["/", "/mcp", "/mcp/"].includes(url.pathname)) return null;
  const room = /^#room=([a-f0-9]{20}),([A-Za-z0-9_-]{22})$/.exec(url.hash);
  if (room) return { roomId: room[1], key: room[2] };
  const invite = /^#invite=([A-Za-z0-9_-]{22})$/.exec(url.hash);
  return invite && url.pathname !== "/" ? { invite: invite[1] } : null;
}
