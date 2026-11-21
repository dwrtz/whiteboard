# Whiteboard

This implementation follows version 0.2.2 of the [dwrtz/whiteboard Spekkr spec](https://spekkr.com/dwrtz/whiteboard/).

Build line: `Build the spec at https://spekkr.com/dwrtz/whiteboard/start.md`

Live demo: [https://whiteboard.beef-able.com](https://whiteboard.beef-able.com)

A hand-drawn-style whiteboard on one Cloudflare Worker. It reads and writes `.excalidraw` files.

On a phone, spread two fingers to zoom in or pinch them together to zoom out. The drawing follows the midpoint between your fingers. You can start with one finger on a floating tool or zoom button and the other on the canvas.

If you pan away from your work, tap **Fit drawing** (frame corners) beside the zoom buttons to bring everything into view. **Go to origin** (crosshair) centres `(0, 0)` at 100%. On a keyboard, use **Shift+1** and **Home** for those actions.

To check pinch zoom on a device, open the scratch board, pinch inward once and tap **Copy result**. It uses a separate in-memory drawing. The report shows how far apart the browser saw your fingers and how much the canvas zoomed. [Open the pinch test](https://whiteboard.beef-able.com/?pinch-test)

- **Local drawings** use localStorage, with images in IndexedDB. Save to a file to keep a copy anywhere else.
- **The room relay and R2 store encrypted data:**
  - Shareable links (`/#json=<id>,<key>`) are compressed (deflate), then encrypted snapshots in R2.
  - Live sessions (`/#room=<id>,<key>`) run through one Durable Object per room. It relays encrypted WebSocket messages and keeps the latest encrypted scene for people who join later. Session images are encrypted in R2.
  - The key lives after `#`. Browser navigation keeps it out of the HTTP request. Explicitly inviting the hosted MCP guest gives that service access to this room.
- The same Worker serves the React app and the HTTP MCP endpoint. Each assistant grant has its own SQLite-backed Durable Object.

## Anyone with the URL can use sharing

There is no sign-in. Anyone who can reach the site can create share links and start live sessions. Anyone who has a link can open that drawing or join that session.

Sharing and assistant calls have per-address rate limits.

| What | Limit |
|---|---|
| New share links | 10 per minute, 10 MB each (compressed and encrypted) |
| Session connections | 120 per minute, 32 people per room |
| Session images | 120 uploads per minute, 4 MB each, 100 per room |
| Assistant requests | 240 per minute, up to 4 pending waits per guest |

Per-address limits return HTTP 429. The link, room connection and image upload routes validate requests before counting them. A room with nobody in it is deleted after 24 hours, together with its images.

Like Excalidraw, share links never expire, and stopping a session only disconnects you; the others can keep drawing.

When you edit text, the canvas pans to keep the cursor in view so the browser doesn't scroll the toolbar off-screen (important on phones).

To limit who can use the site at all, put it behind Cloudflare Access (Zero Trust → Access → Applications → self-hosted).

## Use a headless MCP collaborator

1. Add a Streamable HTTP server in your MCP client. The deployed endpoint is `https://whiteboard.beef-able.com/api/mcp`. For local development use `http://localhost:8787/api/mcp`.
2. On the board choose **Share → Start session → Invite assistant → Copy invite**. Paste the full invite into the connected client and ask it to join. A participant named **Codex** appears on the board.
3. Select a shape and ask the assistant to move it or add a label. Use **Revoke invite** in the issuing tab to disconnect that guest and invalidate its grant.

The scoped invite has the form `/mcp/#invite=<token>` and expires after one hour. Its hosted guest and MCP client can read and edit the room. The issuer's separate revocation credential stays in that tab's session storage. The live socket closes after five minutes without a tool call. A later call can reconnect during the grant's lifetime. A disconnected or restarted peer gets the encrypted snapshot and a fresh change cursor.

The client can also pass a normal `/#room=<id>,<key>` link or its `/mcp/#room=<id>,<key>` alias to `join_room`. Either delegates the reusable room key. Revoking a separate assistant invite only affects that invite. Opening the MCP landing page in a browser shows connection instructions. Redemption sends the full link in the MCP request body.

| Tool | Behavior |
|---|---|
| `join_room` | Takes `invite_url` and returns the private `session` handle. |
| `read_board` | Reads shapes, text, element versions, peers and selections. Use `ids` for a selection or `preview: true` for a PNG. |
| `apply_edits` | Adds shapes or text, moves or deletes elements, updates text and connects shapes. Use a fresh creation ID and send the observed version and nonce for an existing-element edit. Reuse the request ID to retry an identical batch. |
| `wait_for_changes` | Waits up to 25 seconds on the last read cursor for an edit, selection or participant change. |
| `leave_room` | Disconnects the guest. A valid invite can be joined again. |

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

Migration `v1` creates `Room` and migration `v2` adds `AssistantSession`. Rate limits are set in `wrangler.jsonc` (`ratelimits`); keep `RATE_LIMITS` in `src/shared/limits.ts` in step.

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
