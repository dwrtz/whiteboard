// Small fetch wrapper. Errors carry the server's message and extra fields.
export class ApiError extends Error { constructor(public status: number, message: string, public data: any) { super(message); } }
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; raw?: BodyInit | Uint8Array; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method || (opts.body !== undefined || opts.raw !== undefined ? "POST" : "GET"),
      headers: opts.raw !== undefined ? opts.headers : { "content-type": "application/json", ...(opts.headers || {}) },
      body: opts.raw !== undefined ? (opts.raw as BodyInit) : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
  } catch { throw new ApiError(0, "You seem to be offline", null); }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data);
  }
  return data as T;
}
