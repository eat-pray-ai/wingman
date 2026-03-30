import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts", "bin/wingman.ts"],
  format: "esm",
  target: "node22",
  clean: true,
  sourcemap: true,
  deps: { neverBundle: ["better-sqlite3"] },
});
