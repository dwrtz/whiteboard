import React, { useEffect, useState } from "react";
import { Modal, Icon, toast, confirm } from "./ui";
import { api } from "./api";
import type { Store } from "./store";
import type { Collab } from "./collab";
import { roomLink } from "./collab";
import { generateKey, sealScene } from "../shared/crypto";
import { serializeScene } from "../shared/restore";

const copy = (text: string, what = "Link") => navigator.clipboard?.writeText(text).then(() => toast(`${what} copied`), () => toast("Could not copy; select the link instead"));

/** Make an end-to-end encrypted link: the drawing (with images) is deflated and encrypted here; the key only lives in the link. */
export async function createEncryptedLink(s: Store): Promise<string> {
  const key = await generateKey();
  const body = await sealScene(key, serializeScene(s.elements, s.appState, s.files, location.origin));
  const r = await api<{ id: string }>("/api/links", { method: "POST", raw: body, headers: { "content-type": "application/octet-stream" } });
  return `${location.origin}/#json=${r.id},${key}`;
}

export function ShareDialog({ s, collab, isHost, onStart, onStop, onLeave, onClose }: {
  s: Store; collab: Collab | null; isHost: boolean;
  onStart: () => Promise<void>; onStop: () => Promise<void>; onLeave: () => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [e2e, setE2e] = useState<string | null>(null);
  const [name, setName] = useState(collab?.name ?? localStorage.getItem("whiteboard:name") ?? "");
  useEffect(() => { if (collab) setName(collab.name); }, [collab]);
  const saveName = () => { const n = name.trim().slice(0, 40) || "Guest"; localStorage.setItem("whiteboard:name", n); collab?.rename(n); toast("Name updated"); };
  return (
    <Modal title="Share" onClose={onClose} wide className="share">
      <section className="share-sec" aria-label="Live collaboration">
        <h3><Icon name="users" /> Live collaboration</h3>
        <label className="field"><span>Your name</span><div className="link-row"><input aria-label="Your name" value={name} maxLength={40} placeholder="Guest" onChange={e => setName(e.target.value)} /><button className="btn" onClick={saveName}>Save</button></div></label>
        {collab ? <>
          <p>Anyone with this link can draw with you. Drawings and cursors are end-to-end encrypted; the server cannot read them.</p>
          <div className="link-row"><input readOnly aria-label="Session link" value={roomLink(collab.id, collab.key)} onFocus={e => e.target.select()} /><button className="btn primary" onClick={() => copy(roomLink(collab.id, collab.key))}><Icon name="copy" /> Copy link</button></div>
          <div className="modal-actions">
            {isHost ? <button className="btn danger" onClick={async () => { if (await confirm("Stop the session?", "You leave the session and your drawing stays here. Others who are still in it can keep drawing together.", "Stop session")) { await onStop(); onClose(); } }}>Stop session</button>
              : <button className="btn" onClick={() => { onLeave(); onClose(); }}>Leave session</button>}
          </div>
        </> : <>
          <p>Invite people to draw with you in real time. Nobody needs an account; anyone with the link can join.</p>
          <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); try { await onStart(); } catch (e: any) { toast(e.message); } finally { setBusy(false); } }}><Icon name="users" /> Start session</button>
        </>}
      </section>
      <section className="share-sec" aria-label="Encrypted link">
        <h3><Icon name="lock" /> Shareable link</h3>
        <p>A snapshot of the drawing as it is now, encrypted in this browser. The key is part of the link, so only people with the link can open it. Later changes are not included.</p>
        {e2e ? <div className="link-row"><input readOnly aria-label="Encrypted link" value={e2e} onFocus={e => e.target.select()} /><button className="btn primary" onClick={() => copy(e2e)}><Icon name="copy" /> Copy</button></div>
          : <button className="btn" disabled={busy || !s.live().length} onClick={async () => { setBusy(true); try { const l = await createEncryptedLink(s); setE2e(l); copy(l); } catch (e: any) { toast(e.message); } finally { setBusy(false); } }}><Icon name="link" /> Create encrypted link</button>}
      </section>
    </Modal>
  );
}
