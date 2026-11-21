import { test } from "@playwright/test";
import { assistantRoundTrip } from "./assistant-flow";

test("R28 a headless MCP guest shares the starter's selection, preview, edits and waits until revoked", async ({page, baseURL}) => {
  await assistantRoundTrip(page, baseURL!);
});
