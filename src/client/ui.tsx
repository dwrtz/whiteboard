// Shared UI: icons (drawn here), toasts, modals, prompts, menus.
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const P: Record<string, string> = {
  plus: "M12 5v14 M5 12h14", minus: "M5 12h14",
  x: "M6 6l12 12 M18 6L6 18",
  menu: "M4 7h16 M4 12h16 M4 17h16",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  lock: "M6 11h12v9H6z M8 11V7a4 4 0 0 1 8 0v4", unlock: "M6 11h12v9H6z M8 11V7a4 4 0 0 1 7.5-2",
  hand: "M8 13V6a1.5 1.5 0 0 1 3 0v5 M11 11V4.5a1.5 1.5 0 0 1 3 0V11 M14 11V6a1.5 1.5 0 0 1 3 0v6 M17 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.3 14a1.5 1.5 0 0 1 2.4-1.8L8 14",
  selection: "M6 3l12 9-5.5 1.2L15 20l-2.5 1-2.6-6.4L6 18z",
  rectangle: "M4 6h16v12H4z", diamond: "M12 3l9 9-9 9-9-9z", ellipse: "M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z",
  arrow: "M5 19L19 5 M10 5h9v9", line: "M5 19L19 5", freedraw: "M4 19c3-1 4-6 7-6s2 5 5 5 3-8 4-12",
  text: "M5 6V4h14v2 M12 4v16 M9 20h6", image: "M4 5h16v14H4z M4 16l5-5 4 4 2-2 5 5 M15 9h.01",
  eraser: "M8 20h12 M5 15l9-10 6 6-9 9H8z M9 10l6 6",
  undo: "M9 14L4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3", redo: "M15 14l5-5-5-5 M20 9H9a5 5 0 0 0 0 10h3",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13", copy: "M8 8h12v12H8z M4 16V4h12",
  share: "M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8.6 13.5l6.8 4 M15.4 6.5l-6.8 4",
  library: "M4 4h4v16H4z M10 4h4v16h-4z M16 5l3.8-1 3 15.5-3.8 1z",
  open: "M3 7h6l2 2h10v10H3z", save: "M5 4h11l3 3v13H5z M8 4v5h7V4 M8 20v-6h8v6",
  download: "M12 4v12 M7 11l5 5 5-5 M5 20h14", upload: "M12 20V8 M7 13l5-5 5 5 M5 4h14",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14 M12 17h.01",
  sun: "M12 8a4 4 0 1 1 0 8a4 4 0 0 1 0-8z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5L19 19 M5 19l1.5-1.5 M17.5 6.5L19 5",
  moon: "M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z",
  users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21v-1a6 6 0 0 1 12 0v1 M16 3.5a4 4 0 0 1 0 7.5 M22 21v-1a6 6 0 0 0-4-5.6",
  link: "M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1 M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1",
  grid: "M4 4h16v16H4z M4 9.3h16 M4 14.6h16 M9.3 4v16 M14.6 4v16",
  fit: "M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5",
  origin: "M19 12a7 7 0 1 1-14 0 7 7 0 1 1 14 0z M12 2v5 M12 17v5 M2 12h5 M17 12h5 M12 12h.01",
  folder: "M3 6h6l2 2h10v11H3z", user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0",
  check: "M5 12l5 5 9-10", palette: "M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.8-1.5 2-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5z M7.5 11h.01 M10 7h.01 M14.5 7h.01",
  front: "M9 9h11v11H9z M4 4h11v3 M4 4v11h3", back: "M4 4h11v11H4z M9 15v5h11V9h-5",
  forward: "M12 19V5 M6 11l6-6 6 6", backward: "M12 5v14 M6 13l6 6 6-6",
  alignLeft: "M4 3v18 M8 7h12v4H8z M8 14h7v4H8z", alignRight: "M20 3v18 M4 7h12v4H4z M9 14h7v4H9z",
  alignTop: "M3 4h18 M7 8h4v12H7z M14 8h4v7h-4z", alignBottom: "M3 20h18 M7 4h4v12H7z M14 9h4v7h-4z",
  alignHCenter: "M12 3v18 M6 7h12v4H6z M8 14h8v4H8z", alignVCenter: "M3 12h18 M7 6h4v12H7z M14 8h4v8h-4z",
  distH: "M4 3v18 M20 3v18 M9 8h6v8H9z", distV: "M3 4h18 M3 20h18 M8 9h8v6H8z",
  group: "M3 3h4v4H3z M17 3h4v4h-4z M3 17h4v4H3z M17 17h4v4h-4z M7 5h10 M7 19h10 M5 7v10 M19 7v10",
  ungroup: "M3 3h4v4H3z M17 17h4v4h-4z M7 5h6 M5 7v6 M11 19h6 M19 11v6",
  duplicate: "M8 8h12v12H8z M4 16V4h12 M14 11v6 M11 14h6",
  arrowLeft: "M15 6l-6 6 6 6", chevronDown: "M6 9l6 6 6-6",
  pencil: "M4 20h4L19 9l-4-4L4 16z", eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z",
  logout: "M10 5H5v14h5 M9 12h11 M16 8l4 4-4 4", reset: "M4 4v6h6 M5 15a8 8 0 1 0 1.5-8.5L4 10",
};
export function Icon({ name, size = 16, title }: { name: string; size?: number; title?: string }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}<path d={P[name] || P.x} />
    </svg>
  );
}
export function IconButton({ icon, label, onClick, active, className = "", ...rest }: { icon: string; label: string; onClick?: (e: React.MouseEvent) => void; active?: boolean; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`icon-btn ${active ? "is-active" : ""} ${className}`} aria-label={label} title={label} aria-pressed={active === undefined ? undefined : active} onClick={onClick} {...rest}><Icon name={icon} /></button>;
}

// ---------- Toasts ----------
let toastHost: HTMLElement | null = null;
export function toast(message: string, ms = 4000) {
  if (!toastHost) { toastHost = document.createElement("div"); toastHost.className = "toasts"; toastHost.setAttribute("role", "status"); toastHost.setAttribute("aria-live", "polite"); document.body.appendChild(toastHost); }
  const el = document.createElement("div"); el.className = "toast"; el.textContent = message;
  toastHost.appendChild(el); setTimeout(() => el.remove(), ms);
}

// ---------- Modal ----------
export function Modal({ title, onClose, children, wide, className = "" }: { title?: string; onClose: () => void; children: React.ReactNode; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input,textarea,select,button:not(.modal-close)");
    first?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("keydown", key, true); prev?.focus?.(); };
  }, []);
  return (
    <div className="modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`modal ${wide ? "is-wide" : ""} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        {title && <div className="modal-title">{title}</div>}
        <button className="modal-close icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        {children}
      </div>
    </div>
  );
}

/** Mount a modal imperatively and resolve with its result. */
export function openModal<T>(render: (done: (v: T) => void) => React.ReactNode): Promise<T> {
  return new Promise(resolve => {
    const host = document.createElement("div"); document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: T) => { root.unmount(); host.remove(); resolve(v); };
    root.render(<>{render(done)}</>);
  });
}
export function prompt(title: string, opts: { value?: string; label?: string; placeholder?: string; ok?: string; validate?: (v: string) => string | null; selectStem?: boolean } = {}): Promise<string | null> {
  return openModal<string | null>(done => <PromptDialog title={title} {...opts} done={done} />);
}
function PromptDialog({ title, value = "", label, placeholder, ok = "Save", validate, done, selectStem }: { title: string; value?: string; label?: string; placeholder?: string; ok?: string; validate?: (v: string) => string | null; done: (v: string | null) => void; selectStem?: boolean }) {
  const [v, setV] = useState(value); const [err, setErr] = useState<string | null>(null);
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => { const el = inp.current; if (el) { el.focus(); if (selectStem) { const i = value.lastIndexOf("."); el.setSelectionRange(0, i > 0 ? i : value.length); } else el.select(); } }, []);
  const submit = (e: React.FormEvent) => { e.preventDefault(); const m = validate?.(v) ?? null; if (m) { setErr(m); return; } done(v); };
  return (
    <Modal title={title} onClose={() => done(null)}>
      <form onSubmit={submit} className="form">
        <label className="field"><span>{label || "Name"}</span><input ref={inp} value={v} placeholder={placeholder} onChange={e => { setV(e.target.value); setErr(null); }} aria-invalid={!!err} /></label>
        {err && <div className="field-error" role="alert">{err}</div>}
        <div className="modal-actions"><button type="button" className="btn" onClick={() => done(null)}>Cancel</button><button className="btn primary" type="submit">{ok}</button></div>
      </form>
    </Modal>
  );
}
export function confirm(title: string, text: string, ok = "Delete", danger = true): Promise<boolean> {
  return openModal<boolean>(done => (
    <Modal title={title} onClose={() => done(false)}>
      <p className="modal-text">{text}</p>
      <div className="modal-actions"><button className="btn" onClick={() => done(false)}>Cancel</button><button className={`btn ${danger ? "danger" : "primary"}`} onClick={() => done(true)}>{ok}</button></div>
    </Modal>
  ));
}

// ---------- Context menu ----------
export interface MenuItem { label: string; icon?: string; onClick?: () => void; danger?: boolean; separator?: boolean; disabled?: boolean }
let menuClose: (() => void) | null = null;
export function showMenu(e: { clientX: number; clientY: number; preventDefault?: () => void }, items: MenuItem[]) {
  e.preventDefault?.();
  menuClose?.();
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => { root.unmount(); host.remove(); menuClose = null; };
  menuClose = close;
  root.render(<Menu x={e.clientX} y={e.clientY} items={items} close={close} />);
}
function Menu({ x, y, items, close }: { x: number; y: number; items: MenuItem[]; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = ref.current!; const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
    el.querySelector<HTMLElement>("button")?.focus();
    const down = (ev: MouseEvent) => { if (!el.contains(ev.target as Node)) close(); };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.stopPropagation(); close(); }
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        const bs = [...el.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]; const i = bs.indexOf(document.activeElement as HTMLButtonElement);
        bs[(i + (ev.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length]?.focus();
      }
    };
    setTimeout(() => window.addEventListener("mousedown", down), 0); window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("mousedown", down); window.removeEventListener("keydown", key, true); };
  }, []);
  return (
    <div ref={ref} className="menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) => it.separator ? <div key={i} className="menu-sep" /> :
        <button key={i} role="menuitem" disabled={it.disabled} className={`menu-item ${it.danger ? "is-danger" : ""}`} onClick={() => { close(); it.onClick?.(); }}>
          {it.icon && <Icon name={it.icon} />}<span>{it.label}</span>
        </button>)}
    </div>
  );
}
export function relTime(iso: string) { const d = new Date(iso); return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
