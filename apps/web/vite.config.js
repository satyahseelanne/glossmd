import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy so the app can call the @gloss/server routes without CORS fuss.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/tree": "http://localhost:8787",
      "/file": "http://localhost:8787",
      "/reviews": "http://localhost:8787",
      "/auth": "http://localhost:8787",
      "/repo": "http://localhost:8787",
    },
  },
});
