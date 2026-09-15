import { readFile } from "node:fs/promises";
import { rmSync } from "node:fs";

import { build } from "esbuild";

const packageJson = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
const bundledWorkspacePackages = new Set(["@tracegenie/shared", "@vertaware/email"]);
const external = Object.keys(packageJson.dependencies).filter((name) => !bundledWorkspacePackages.has(name));
rmSync(new URL("./dist", import.meta.url), { recursive: true, force: true });

await build({
  entryPoints: ["src/server.ts", "src/worker.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outdir: "dist",
  sourcemap: true,
  external,
  outExtension: { ".js": ".js" },
});
