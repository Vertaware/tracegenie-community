import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const REACT_PRODUCTION_ALIASES = [
  {
    find: "react-dom/client",
    replacement: resolve(__dirname, "../../node_modules/react-dom/cjs/react-dom-client.production.js"),
  },
  {
    find: "react-dom",
    replacement: resolve(__dirname, "../../node_modules/react-dom/cjs/react-dom.production.js"),
  },
  {
    find: "react/jsx-runtime",
    replacement: resolve(__dirname, "../../node_modules/react/cjs/react-jsx-runtime.production.js"),
  },
  {
    find: "react/jsx-dev-runtime",
    replacement: resolve(__dirname, "../../node_modules/react/cjs/react-jsx-dev-runtime.production.js"),
  },
  {
    find: "react",
    replacement: resolve(__dirname, "../../node_modules/react/cjs/react.production.js"),
  },
] as const;

const FORBIDDEN_CSP_PATTERNS = [
  {
    label: "React development JSX runtime",
    pattern: /\.jsxDEV\b/,
  },
  {
    label: "React DevTools DCE hook",
    pattern: /__REACT_DEVTOOLS_GLOBAL_HOOK__\.checkDCE/,
  },
  {
    label: "eval()",
    pattern: /\beval\s*\(/,
  },
  {
    label: "new Function()",
    pattern: /\bnew Function\s*\(/,
  },
  {
    label: "Function() constructor",
    pattern: /(?:^|[^\w$.])Function\s*\(/,
  },
  {
    label: "string-based setTimeout()",
    pattern: /\bsetTimeout\s*\(\s*["']/,
  },
  {
    label: "string-based setInterval()",
    pattern: /\bsetInterval\s*\(\s*["']/,
  },
] as const;

function replaceOnce(code: string, searchValue: string, replaceValue: string, label: string) {
  if (!code.includes(searchValue)) {
    throw new Error(`Unable to patch ${label}: source snippet not found.`);
  }

  return code.replace(searchValue, replaceValue);
}

function patchZodForStrictCsp() {
  return {
    name: "patch-zod-for-strict-csp",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (id.endsWith("/node_modules/zod/v4/core/util.js")) {
        return replaceOnce(
          code,
          `export const allowsEval = cached(() => {
    // @ts-ignore
    if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
        return false;
    }
    try {
        const F = Function;
        new F("");
        return true;
    }
    catch (_) {
        return false;
    }
});`,
          `export const allowsEval = {
    get value() {
        return false;
    },
};`,
          "zod allowsEval probe",
        );
      }

      if (id.endsWith("/node_modules/zod/v4/core/doc.js")) {
        return replaceOnce(
          code,
          `    compile() {
        const F = Function;
        const args = this?.args;
        const content = this?.content ?? [\`\`];
        const lines = [...content.map((x) => \`  \${x}\`)];
        // console.log(lines.join("\\n"));
        return new F(...args, lines.join("\\n"));
    }`,
          `    compile() {
        throw new Error("Zod JIT is disabled for the CSP-safe embed bundle.");
    }`,
          "zod doc compiler",
        );
      }

      return null;
    },
  };
}

function assertCspSafeEmbed() {
  return {
    name: "assert-csp-safe-embed",
    generateBundle(_options: unknown, bundle: Record<string, { type: string; fileName: string; code?: string }>) {
      const embedChunk = Object.values(bundle).find(
        (entry) => entry.type === "chunk" && entry.fileName === "embed.js",
      );

      if (!embedChunk?.code) {
        throw new Error("embed.js chunk was not generated.");
      }

      for (const { label, pattern } of FORBIDDEN_CSP_PATTERNS) {
        if (pattern.test(embedChunk.code)) {
          throw new Error(`embed.js failed CSP safety check: found ${label}.`);
        }
      }
    },
  };
}

/**
 * Vite config for the standalone IIFE embed build.
 *
 * Produces a single `embed.js` file that bundles React, ReactDOM,
 * and all widget dependencies. No external peer deps required.
 * CSS is inlined into the JS bundle via ?inline imports handled by
 * the cssCodeSplit: false + inlineCSS plugin.
 */
export default defineConfig({
  plugins: [patchZodForStrictCsp(), react(), tailwindcss(), assertCspSafeEmbed()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  resolve: {
    alias: REACT_PRODUCTION_ALIASES,
    extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: false, // Don't wipe the ESM build
    lib: {
      entry: resolve(__dirname, "src/embed.tsx"),
      name: "TraceGenieEmbed",
      fileName: () => "embed.js",
      formats: ["iife"],
    },
    rollupOptions: {
      // Do NOT externalize react — bundle it inside.
      external: [],
      output: {
        banner: `/*!\n${readFileSync(resolve(__dirname, "NOTICE"), "utf8")}\n${readFileSync(resolve(__dirname, "../shared/MOTION-LICENSE-NOTICE.txt"), "utf8")}\n*/`,
      },
    },
    cssCodeSplit: false,
    minify: "esbuild",
  },
});
