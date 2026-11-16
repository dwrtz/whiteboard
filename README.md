# Whiteboard

Built from the Spekkr spec dwrtz/whiteboard: https://spekkr.com/dwrtz/whiteboard/

Build line: `Build the spec at https://spekkr.com/dwrtz/whiteboard/start.md`

Live demo: [https://whiteboard.beef-able.com](https://whiteboard.beef-able.com)

A hand-drawn-style whiteboard on one Cloudflare Worker. It reads and writes `.excalidraw` files.

- **Drawings live in your browser:** localStorage, with images in IndexedDB. Save to a file to keep them anywhere else. There are no accounts and no server-side drawings.
- **The server stores only what is shared, always end-to-end encrypted in the browser:**
  - Shareable links (`/#json=<id>,<key>`) are compressed (deflate), then encrypted snapshots in R2.
  - Live sessions (`/#room=<id>,<key>`) run through one Durable Object per room. It relays encrypted WebSocket messages and keeps the latest encrypted scene for people who join later. Session images are encrypted in R2.
  - The key is the part of the link after `#`, which browsers never send to the server.
- The React app is the Worker's static assets. No database is used.

## Anyone with the URL can use sharing

There is no sign-in. Anyone who can reach the site can create share links and start live sessions. Anyone who has a link can open that drawing or join that session.

The server can't read what is stored, but it does pay for it. These limits keep that in check (per address, per minute):

| What | Limit |
|---|---|
| New share links | 10 per minute, 10 MB each (compressed and encrypted) |
| Session connections | 120 per minute, 32 people per room |
| Session images | 120 uploads per minute, 4 MB each, 100 per room |

Beyond a limit the server answers 429. Refused requests (bad id, too big, cross-site, not a WebSocket) don't count toward a limit. A room with nobody in it is deleted after 24 hours, together with its images.

Like Excalidraw, share links never expire, and stopping a session only disconnects you; the others can keep drawing.

When you edit text, the canvas pans to keep the cursor in view so the browser doesn't scroll the toolbar off-screen (important on phones).

To limit who can use the site at all, put it behind Cloudflare Access (Zero Trust → Access → Applications → self-hosted).

## Run it on your computer

```bash
npm install
npm run dev          # builds, then runs wrangler dev with local R2 and Durable Objects
```

Open http://localhost:8787. No Cloudflare account is needed locally.

## Tests

```bash
npm run typecheck && npm test                    # unit tests
npx playwright install chromium && npm run e2e   # end-to-end, against wrangler dev on port 3210
```

Optional: `npx playwright test -c playwright.live.config.ts` runs a subset of the e2e specs against the live demo.

## Deploy to Cloudflare

1. Review [`wrangler.example.jsonc`](./wrangler.example.jsonc) and copy any optional fields you need (account id, custom domain) into `wrangler.jsonc`.
2. Log in and create the R2 bucket once:

```bash
npx wrangler login
npx wrangler r2 bucket create whiteboard-files
npm run deploy
```

The first deploy creates the `Room` Durable Object class (migration `v1`). Rate limits are set in `wrangler.jsonc` (`ratelimits`); keep `RATE_LIMITS` in `src/shared/limits.ts` in step.

### If static asset upload is unavailable

The UI can be bundled into the Worker instead of being uploaded as Workers static assets. Temporarily set `"main": "src/worker/deploy-entry.ts"` in your wrangler config (and drop the `assets` block), then:

```bash
npm run build
node gen-inline-assets.mjs
npx wrangler deploy
```

`src/worker/inline-assets.gen.js` is generated and is not committed.

## Settings (`spekkr.inputs.json`)

- **`app_name`:** the product name (default `"Whiteboard"`).
- **`accent_color`:** the accent colour, as `#rrggbb` (default `#4c6ef5`).

## License

MIT. See [LICENSE](./LICENSE).
