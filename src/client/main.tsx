import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/kalam/400.css";
import "./style.css";
import { settings } from "../shared/settings";
import { CanvasPage, CenterMessage } from "./pages";
import { applyTheme } from "./theme";

document.documentElement.style.setProperty("--accent", settings.accentColor);
document.title = settings.appName;
applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
// a pasted session or encrypted link in a tab that is already open: start over on that link
window.addEventListener("hashchange", () => { if (/^#(room|json)=/.test(location.hash)) location.reload(); });

function Root() {
  if (location.pathname === "/") return <CanvasPage key={location.hash} />;
  return <CenterMessage title="Page not found" text="There's nothing at this address." />;
}
createRoot(document.getElementById("root")!).render(<Root />);
