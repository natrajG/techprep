import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = `http://127.0.0.1:${process.env.PORT || "8000"}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on the network, not only localhost
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: apiTarget },
      "/health": { target: apiTarget }
    }
  }
});
