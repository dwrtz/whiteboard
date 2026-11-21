// Production entry: wraps the app Worker and serves the built UI from an in-bundle asset map,
// mimicking Workers static assets with not_found_handling = "single-page-application".
import app from "./index";
export { Room, AssistantSession } from "./index";
// @ts-ignore generated file
import ASSET_MAP from "./inline-assets.gen.js";

type Asset = { type: string; text: boolean; data: string };
const assets = ASSET_MAP as Record<string, Asset>;
const bin: Record<string, Uint8Array> = {};
const bytes = (p: string, s: string) => (bin[p] ??= Uint8Array.from(atob(s), c => c.charCodeAt(0)));

function serve(req: Request): Response {
  const url = new URL(req.url);
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  let p = decodeURIComponent(url.pathname);
  if (p === "/mcp/" || p === "/mcp") p = "/";
  if (p.endsWith("/")) p += "index.html";
  let a = assets[p];
  if (!a) {
    // Missing files 404; page routes fall back to the app shell.
    if (p.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(p)) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
    p = "/index.html"; a = assets[p];
  }
  const headers = new Headers({ "content-type": a.type, "x-content-type-options": "nosniff" });
  headers.set("cache-control", p.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
  const body = req.method === "HEAD" ? null : a.text ? a.data : bytes(p, a.data);
  return new Response(body, { status: 200, headers });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return serve(req);
    return app.fetch(req, { ...env, ASSETS: { fetch: (r: Request) => Promise.resolve(serve(r)) } } as unknown as Env);
  },
} satisfies ExportedHandler<Env>;
