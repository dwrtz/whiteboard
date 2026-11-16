export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

type Handler = (req: Request, params: Record<string, string>) => Promise<Response>;
export class Router {
  private routes: { method: string; re: RegExp; keys: string[]; h: Handler }[] = [];
  on(method: string, pattern: string, h: Handler) {
    const keys: string[] = [];
    const re = new RegExp("^" + pattern.replace(/:(\w+)(\*)?/g, (_m, k, star) => { keys.push(k); return star ? "(.+)" : "([^/]+)"; }) + "$");
    this.routes.push({ method, re, keys, h }); return this;
  }
  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(url.pathname); if (!m) continue;
      pathMatched = true;
      if (r.method !== req.method) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return r.h(req, params);
    }
    throw new HttpError(pathMatched ? 405 : 404, pathMatched ? "Method not allowed" : "Not found");
  }
}
export async function body<T = any>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new HttpError(400, "Send a JSON body"); }
}
