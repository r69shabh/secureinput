import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "cli/index": "src/cli/index.ts" },
  outDir: "dist",
  format: ["esm"],
  target: "node22",
  platform: "node",
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
});
