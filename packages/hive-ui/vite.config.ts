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
      "/health": {
        target: "http://127.0.0.1:18790",
        changeOrigin: true,
        rewrite: (path) => path,
      },
      "/status": {
        target: "http://127.0.0.1:18790",
        changeOrigin: true,
        rewrite: (path) => path,
      },
      "/ws": {
        target: "ws://127.0.0.1:18790",
        ws: true,
        rewrite: (path) => path,
      },
      "/realtime": {
        target: "ws://127.0.0.1:18790",
        ws: true,
        rewrite: (path) => path,
      },
    },
  },
  // Rolldown no trata .glb como asset por defecto: sin esto el import del
  // modelo 3D rompe el build ("Could not load src/assets/bia.glb").
  assetsInclude: ["**/*.glb"],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("recharts") || id.includes("d3-") || id.includes("victory-vendor")) return "vendor-charts";
          if (id.includes("@radix-ui/")) return "vendor-radix";
          if (id.includes("@tanstack/")) return "vendor-query";
          if (id.includes("react-hook-form") || id.includes("@hookform/") || id.includes("/zod/")) return "vendor-forms";
          if (id.includes("react-router") || id.includes("@remix-run/")) return "vendor-router";
          if (id.includes("/react-dom/") || id.includes("/react/")) return "vendor-react";
        },
      },
    },
  },
});
