import { build } from "esbuild";
const alias = {
  "@breakwater/core": "./packages/core/src/index.ts",
  "@breakwater/collector": "./packages/collector/src/index.ts",
  "@breakwater/cli": "./packages/cli/src/index.ts",
};
const common = { bundle: true, platform: "node", format: "esm", target: "node22", alias, logLevel: "warning", external: ["node:*"] };
await build({ ...common, entryPoints: ["scripts/demo.ts"], outfile: "dist/demo.mjs" });
await build({ ...common, entryPoints: ["packages/cli/src/bin.ts"], outfile: "packages/cli/dist/cli.js", banner: { js: "#!/usr/bin/env node" } });
await build({ ...common, entryPoints: ["packages/collector/src/bin.ts"], outfile: "packages/collector/dist/server.js", banner: { js: "#!/usr/bin/env node" } });
for (const p of ["core", "web", "react-native"]) {
  await build({ entryPoints: [`packages/${p}/src/index.ts`], outfile: `packages/${p}/dist/index.js`, bundle: true, format: "esm", platform: "neutral", alias, logLevel: "warning" });
}
console.log("built");
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
if (existsSync("examples/eats/out/dashboard-data.json")) {
  const out = await build({ entryPoints: ["apps/dashboard/main.ts"], bundle: true, write: false, format: "iife", minify: true, loader: { ".json": "json" }, logLevel: "warning" });
  const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  mkdirSync("dist", { recursive: true });
  writeFileSync("dist/dashboard.html", readFileSync("apps/dashboard/index.html", "utf8").replace("/*BUNDLE*/", () => js));
  console.log("dist/dashboard.html");
}
