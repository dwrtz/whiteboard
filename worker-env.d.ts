/** Bindings for this Worker. Run `npm run types` if you want a generated `worker-configuration.d.ts`. */
interface Env {
  FILES: R2Bucket;
  LINK_LIMIT: RateLimit;
  ROOM_LIMIT: RateLimit;
  FILE_LIMIT: RateLimit;
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace<import("./src/worker/index").Room>;
}
