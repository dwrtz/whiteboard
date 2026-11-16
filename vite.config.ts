import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import inputs from "./spekkr.inputs.json";
export default defineConfig({
  plugins: [react(), { name: "app-name", transformIndexHtml: (h: string) => h.replace("%APP_NAME%", String((inputs as any).app_name || "Whiteboard").replace(/[<>&"]/g, "")) }],
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 2000 },
  test: { include: ["tests/**/*.test.ts"] },
} as any);
