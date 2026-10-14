import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const https = process.env.TECHPREP_HTTPS === "1";
const apiTarget = `http://127.0.0.1:${process.env.PORT || "8000"}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on the network, not only localhost
    port: 5173,
    strictPort: true,
    https: https ? {
      key: readFileSync(new URL("../../.certs/server-key.pem", import.meta.url)),
      cert: readFileSync(new URL("../../.certs/server.pem", import.meta.url))
    } : undefined,
    proxy: {
      "/api": { target: apiTarget },
      "/health": { target: apiTarget }
    }
  }
});
