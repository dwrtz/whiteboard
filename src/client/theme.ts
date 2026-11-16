export type ThemePref = "light" | "dark" | "system";
export function themePref(): ThemePref { const t = localStorage.getItem("theme"); return t === "dark" || t === "system" ? t : "light"; }
export function resolvedTheme(): "light" | "dark" { const p = themePref(); return p === "dark" || (p === "system" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light"; }
export function setThemePref(p: ThemePref) { localStorage.setItem("theme", p); applyTheme(); }
export function applyTheme() { document.documentElement.dataset.theme = resolvedTheme(); window.dispatchEvent(new Event("themechange")); }
