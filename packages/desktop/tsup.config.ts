import { defineConfig } from "tsup";

export default defineConfig({
  entry: { main: "src/main.ts" },
  format: ["esm"],
  outDir: "dist",
  target: "node20",
  platform: "node",
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  external: ["electron", "@hyperframes/cli", "@hyperframes/cli/wizard-server", "@hono/node-server"],
});
