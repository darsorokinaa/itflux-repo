import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@jitsi/electron-sdk/renderer": fileURLToPath(
        new URL("./src/cabinet/jitsiElectronSdkRenderer.stub.js", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx,js,jsx}"],
  },
});
