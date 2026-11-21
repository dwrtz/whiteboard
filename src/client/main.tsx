import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/kalam/400.css";
import "./style.css";
import { settings } from "../shared/settings";
import { AssistantLanding } from "./assistant-share";
import { CanvasPage, CenterMessage } from "./pages";
import { applyTheme } from "./theme";

document.documentElement.style.setProperty("--accent", settings.accentColor);
document.title = settings.appName;
applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
// a pasted session or encrypted link in a tab that is already open: start over on that link
window.addEventListener("hashchange", () => { if (/^#(room|json|invite)=/.test(location.hash)) location.reload(); });

function Root() {
  if (location.pathname === "/mcp/" || location.pathname === "/mcp") return <AssistantLanding />;
  if (location.pathname === "/") return <CanvasPage key={location.hash} />;
  return <CenterMessage title="Page not found" text="There's nothing at this address." />;
}
const root = createRoot(document.getElementById("root")!);
if (location.pathname === "/" && !location.hash && new URLSearchParams(location.search).has("pinch-test")) {
  void import("./pinch-check").then(({ default: PinchCheck }) => root.render(<PinchCheck />));
} else root.render(<Root />);
