import React, { useEffect, useState } from "react";
import { parseAssistantLink } from "../shared/assistant-links";
import type { Collab } from "./collab";
import { api } from "./api";
import { toast } from "./ui";

type IssuedInvite = { token: string; revokeSecret: string; expiresAt: number };
const endpoint = () => location.origin + "/api/mcp";
const urlFor = (token: string) => location.origin + "/mcp/#invite=" + token;
const storageKey = (id: string) => "whiteboard:assistant-invite:" + id;
const copy = async (value: string) => {
  try { await navigator.clipboard.writeText(value); toast("Copied"); } catch { toast("Select the address and copy it"); }
};
function stored(room: string): IssuedInvite | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey(room)) ?? "null");
    return value?.expiresAt > Date.now() ? value : null;
  } catch { return null; }
}

export function AssistantShare({ collab }: { collab: Collab }) {
  const [invite, setInvite] = useState(() => stored(collab.id));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!invite) return;
    const timer = setTimeout(() => { setInvite(null); sessionStorage.removeItem(storageKey(collab.id)); }, Math.max(0, invite.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [invite, collab.id]);
  const issue = async () => {
    setBusy(true);
    try {
      await collab.sendFull();
      const next = await api<IssuedInvite>("/api/assistant-invites", { body: { roomId: collab.id, key: collab.key } });
      setInvite(next); sessionStorage.setItem(storageKey(collab.id), JSON.stringify(next));
    } catch (e) { toast(e instanceof Error ? e.message : "Could not create the invite"); }
    finally { setBusy(false); }
  };
  const revoke = async () => {
    if (!invite) return;
    setBusy(true);
    try {
      await api("/api/assistant-invites", { method: "DELETE", body: { token: invite.token, revokeSecret: invite.revokeSecret } });
      sessionStorage.removeItem(storageKey(collab.id)); setInvite(null); toast("Assistant invite revoked");
    } catch (e) { toast(e instanceof Error ? e.message : "Could not revoke the invite"); }
    finally { setBusy(false); }
  };
  return <section className="share-sec" aria-label="Assistant collaboration">
    <h3>Assistant collaboration</h3>
    <p>Inviting a hosted assistant lets it and its MCP client read and edit this room. The invite expires after one hour.</p>
    {invite ? <>
      <div className="link-row"><input aria-label="Assistant invite" readOnly value={urlFor(invite.token)} onFocus={e => e.target.select()} />
        <button className="btn primary" onClick={() => copy(urlFor(invite.token))}>Copy invite</button></div>
      <div className="modal-actions"><button className="btn danger" disabled={busy} onClick={revoke}>Revoke invite</button></div>
    </> : <button className="btn primary" disabled={busy || collab.status !== "connected"} onClick={issue}>Invite assistant</button>}
  </section>;
}

export function AssistantLanding() {
  const link = parseAssistantLink(location.href, location.origin);
  return <main className="center-msg"><h1>Whiteboard MCP</h1>
    <p>Connect your MCP client to this Streamable HTTP endpoint.</p>
    <div className="link-row"><input aria-label="MCP endpoint" readOnly value={endpoint()} onFocus={e => e.target.select()} />
      <button className="btn" onClick={() => copy(endpoint())}>Copy endpoint</button></div>
    {link ? <><p>Paste the full invite into your connected assistant to share this live drawing for reading and editing.</p>
      <button className="btn primary" onClick={() => copy(location.href)}>Copy invite</button>
      {"roomId" in link && <a className="btn" href={"/" + location.hash}>Open live room</a>}</> :
      <p>In a live room, open Share and choose Invite assistant.</p>}
  </main>;
}
