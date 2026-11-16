export const LIMITS = {
  fileBytes: 4 * 1024 * 1024,              // one image
  encryptedLinkBytes: 10 * 1024 * 1024,    // one encrypted share link (scene + images)
  roomFileBytes: 4 * 1024 * 1024 + 64,     // one encrypted session image (IV + tag overhead)
  roomFiles: 100,                          // images per live session
  roomSnapshotBytes: 4 * 1024 * 1024,      // the encrypted scene a room keeps for late joiners
};
/** Requests per address per minute (wrangler.jsonc `ratelimits`). */
export const RATE_LIMITS = { links: 10, roomConnections: 120, roomFiles: 120 };
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "image/bmp", "image/avif"];
