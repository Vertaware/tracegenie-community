import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  envDir: path.resolve(__dirname, "../.."),
  plugins: [react(), tailwindcss()],
  resolve: {
    // Linked workspace packages must share the renderer's React instance.
    dedupe: ["react", "react-dom"],
    alias: {
      "@tracegenie/widget": path.resolve(__dirname, "../../packages/widget/src/index.ts"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
          forms: ["react-hook-form", "zod", "@hookform/resolvers"],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4311,
    // Revalidate local dependency bundles after installs/restarts. Vite's
    // immutable browser cache can otherwise mix old and regenerated chunks.
    headers: { "Cache-Control": "no-cache" },
  },
  preview: {
    host: "127.0.0.1",
    port: 4311,
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.tsx"],
  },
});
