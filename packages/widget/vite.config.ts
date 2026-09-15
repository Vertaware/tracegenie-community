import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "TraceGenieFeedbackWidget",
      fileName: "index",
      formats: ["es"],
    },
    rollupOptions: {
      external: [/^react($|\/)/, /^react-dom($|\/)/],
      output: {
        banner: "/*! TraceGenie Community - Copyright (c) 2026 TraceGenie contributors. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE and NOTICE. */",
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.tsx"],
  },
});
