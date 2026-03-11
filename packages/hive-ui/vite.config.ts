import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: true,
    strictPort: true,
    hmr: {
      clientPort: 5173,
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:18790",
        changeOrigin: true,
        rewrite: (path) => path,
      },
      "/ws": {
        target: "ws://127.0.0.1:18790",
        ws: true,
        rewrite: (path) => path,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
