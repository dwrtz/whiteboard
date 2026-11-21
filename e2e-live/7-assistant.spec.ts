import { test } from "@playwright/test";
import { assistantRoundTrip } from "../e2e/assistant-flow";

test("R28 deployed MCP and browser complete a fresh room round trip", async ({page, baseURL}) => {
  await assistantRoundTrip(page, baseURL!);
});
