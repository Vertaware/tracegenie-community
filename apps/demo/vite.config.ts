import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  base: process.env.COMMUNITY_WEB_BUILD === "true" ? "/feedback/" : "/",
  envDir: path.resolve(__dirname, "../.."),
  plugins: [react(), tailwindcss()],
  resolve: {
    extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
    alias: {
      "@tracegenie/widget/styles.css": path.resolve(__dirname, "../../packages/widget/src/styles/widget.css"),
      "@tracegenie/widget": path.resolve(__dirname, "../../packages/widget/src/index.ts"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4312,
  },
  preview: {
    host: "127.0.0.1",
    port: 4312,
  },
});
