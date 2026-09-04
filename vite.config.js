import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The frontend talks to the little Express proxy (server.js) for anything
// under /api, so the Azure key never ships to the browser.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      "/api": "http://localhost:8791",
    },
  },
});
