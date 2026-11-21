import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Store } from "./store";
import { Editor, canvasBackgroundItems } from "./Editor";
import { ShareDialog } from "./share";
import { Collab, parseRoomHash, parseJsonHash, newRoomId } from "./collab";
import { readLocal, readLocalFiles, bindLocal, writeLocal, localIsEmpty, readLocalLibrary, writeLocalLibrary } from "./persist";
import type { LibraryApi } from "./dialogs";
import { Icon, toast, confirm } from "./ui";
import { settings } from "../shared/settings";
import { generateKey, openScene } from "../shared/crypto";
import { parseSceneFile } from "../shared/restore";

const library: LibraryApi = { where: "Kept in this browser.", load: async () => readLocalLibrary(), save: async items => writeLocalLibrary(items) };
const userName = () => localStorage.getItem("whiteboard:name") || "Guest";

function Welcome() {
  return <div className="welcome-inner">
    <div className="welcome-brand"><span className="brand-mark" aria-hidden="true" />{settings.appName}</div>
    <p>Your drawing is saved in this browser. Clearing site data removes it — save to a file to keep it.</p>
    <p className="muted">Pick a tool and start drawing · <kbd>?</kbd> for shortcuts</p>
  </div>;
}
function RoomBadge({ c }: { c: Collab }) {
  const label = c.status === "connected" ? `Live · ${c.peers.length + 1} here` : c.status === "reconnecting" ? "Reconnecting…" : "Connecting…";
  return <span className={`status room-${c.status}`} role="status" data-testid="room-status">
    {c.peers.map(p => <span key={p.id} className="avatar" title={p.name} style={{ background: p.color }}>{p.name.slice(0, 1).toUpperCase()}</span>)}{label}</span>;
}

/** The one page: the canvas kept in this browser, a live session joined by link, or a copy opened from an encrypted link. */
export function CanvasPage() {
  const s = useMemo(() => new Store(), []);
  const room = parseRoomHash(location.hash); const json = parseJsonHash(location.hash);
  // "local": this browser's canvas (also while hosting a session); "room": joined someone's session; "copy": an encrypted link
  const [mode] = useState<"local" | "room" | "copy">(room ? "room" : json ? "copy" : "local");
  const [ready, setReady] = useState(false);
  const [share, setShare] = useState(false);
  const [left, setLeft] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [collab, setCollab] = useState<Collab | null>(null);
  const sharePointer = useCallback((x: number, y: number, button: "up" | "down") => {
    collab?.pointer(x, y, button);
  }, [collab]);
  const [, bump] = useState(0);
  const join = (id: string, key: string, starter: boolean) => {
    const c = new Collab(s, id, key, userName(), () => bump(x => x + 1), starter); c.connect(); setCollab(c); return c;
  };
  useEffect(() => () => collab?.close(), [collab]);
  useEffect(() => { s.onChangeExtra = collab ? () => collab.scheduleChanges() : null; }, [collab]);

  useEffect(() => {
    let unbind: (() => void) | null = null;
    (async () => {
      if (room) {
        join(room.id, room.key, false);
        s.onChange = kind => { s.onChangeExtra?.(kind); };
      } else if (json) {
        try {
          const res = await fetch(`/api/links/${json.id}`); if (!res.ok) throw new Error("This link doesn't exist or was mistyped.");
          const text = await openScene(json.key, new Uint8Array(await res.arrayBuffer())).catch(() => { throw new Error("Couldn't decrypt this drawing: the key in the link is wrong."); });
          const d = parseSceneFile(text); s.load(d.elements, d.appState, d.files);
        } catch (e: any) { setErr(e.message); }
      } else {
        const l = readLocal(); s.load(l.elements, l.appState, await readLocalFiles());
        unbind = bindLocal(s, m => toast(m));
        const base = s.onChange; s.onChange = kind => { base?.(kind); s.onChangeExtra?.(kind); };
      }
      setReady(true);
    })();
    return () => { unbind?.(); s.onChange = null; };
  }, []);

  const keepLocal = async () => {
    if (!localIsEmpty() && !(await confirm("Replace the drawing in this browser?", "The canvas saved in this browser will be replaced with this drawing.", "Replace", true))) return;
    await writeLocal(s.live(), s.appState, s.files); collab?.close(); location.href = "/";
  };
  const startRoom = async () => {
    const id = newRoomId(); const key = await generateKey();
    history.replaceState(null, "", `/#room=${id},${key}`);
    join(id, key, true); setShare(true);
  };
  const stopRoom = async () => { collab?.close(); setCollab(null); history.replaceState(null, "", "/"); };
  const leave = () => { collab?.close(); setCollab(null); setLeft(true); history.replaceState(null, "", "/"); };
  if (err) return <CenterMessage title="Can't open this" text={err} />;
  if (!ready) return <CenterMessage title="Loading…" />;
  const banner = mode === "copy" ? <span>Opened from an encrypted link — not saved yet. <button className="btn small" onClick={keepLocal}>Keep in this browser</button></span>
    : left ? <span>You left the live session. <button className="btn small" onClick={keepLocal}>Keep a copy in this browser</button></span>
    : null;
  const name = mode === "copy" ? "Shared drawing" : mode === "room" ? "Live session" : "My canvas";
  return <>
    <Editor store={s} mode={mode} name={name} library={library} banner={banner}
      status={collab ? <RoomBadge c={collab} /> : null}
      welcome={mode === "local" ? <Welcome /> : undefined}
      onPointer={sharePointer}
      menuBottom={canvasBackgroundItems(s)}
      topRight={<button className="btn primary share-btn" onClick={() => setShare(true)}><Icon name="share" /><span>Share</span>{collab && collab.peers.length > 0 && <span className="peer-count" aria-label={`${collab.peers.length} others here`}>{collab.peers.length}</span>}</button>} />
    {share && <ShareDialog s={s} collab={collab} isHost={mode === "local"} onStart={startRoom} onStop={stopRoom} onLeave={leave} onClose={() => setShare(false)} />}
  </>;
}

export function CenterMessage({ title, text }: { title: string; text?: string }) {
  return <main className="center-msg"><h1>{title}</h1>{text && <p>{text}</p>}{title !== "Loading…" && <a className="btn" href="/">Go to your canvas</a>}</main>;
}
