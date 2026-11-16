// End-to-end encryption used for collaboration rooms and encrypted share links.
// AES-GCM with a 128-bit key; the key is the JWK `k` value (base64url, 22 chars) and lives only in the URL
// fragment (#room=<id>,<key> or #json=<id>,<key>), which browsers never send to the server.
// Payload layout: 12-byte IV followed by the ciphertext.
export const IV_BYTES = 12;
export async function generateKey(): Promise<string> {
  const key = (await crypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, true, ["encrypt", "decrypt"])) as CryptoKey;
  const jwk = (await crypto.subtle.exportKey("jwk", key)) as JsonWebKey;
  return jwk.k!;
}
async function importKey(k: string, usage: ("encrypt" | "decrypt")[]) {
  return crypto.subtle.importKey("jwk", { kty: "oct", k, alg: "A128GCM", ext: true }, { name: "AES-GCM", length: 128 }, false, usage);
}
export async function encrypt(k: string, data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(k, ["encrypt"]), bytes as BufferSource));
  const out = new Uint8Array(IV_BYTES + ct.length); out.set(iv); out.set(ct, IV_BYTES); return out;
}
export async function decrypt(k: string, payload: Uint8Array): Promise<Uint8Array> {
  if (payload.length <= IV_BYTES) throw new Error("payload too short");
  const iv = payload.slice(0, IV_BYTES), ct = payload.slice(IV_BYTES);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await importKey(k, ["decrypt"]), ct));
}
export const decryptText = async (k: string, p: Uint8Array) => new TextDecoder().decode(await decrypt(k, p));
// Share links compress before encrypting, like Excalidraw (pako deflate): zlib "deflate" via the built-in
// CompressionStream, so no library is needed. Plain JSON payloads (starting with "{") still open.
async function pipe(data: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([data as unknown as ArrayBuffer]).stream().pipeThrough(t as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export const deflate = (text: string) => pipe(new TextEncoder().encode(text), new CompressionStream("deflate"));
export async function inflateText(bytes: Uint8Array): Promise<string> {
  if (bytes[0] === 0x7b) return new TextDecoder().decode(bytes); // "{": stored without compression
  return new TextDecoder().decode(await pipe(bytes, new DecompressionStream("deflate")));
}
/** Encrypted share-link body: IV ‖ AES-GCM(deflate(JSON)). */
export const sealScene = async (k: string, json: string) => encrypt(k, await deflate(json));
export const openScene = async (k: string, payload: Uint8Array) => inflateText(await decrypt(k, payload));
export const isKey = (k: string) => /^[A-Za-z0-9_-]{22}$/.test(k);
export function toB64(u: Uint8Array): string { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); }
export function fromB64(s: string): Uint8Array { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
export async function sha1Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", data as BufferSource));
  return [...h].map(b => b.toString(16).padStart(2, "0")).join("");
}
