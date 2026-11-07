// Build workspace dependencies before their consumers, including on a fresh clone.
import { spawnSync } from "node:child_process";

const packages = [
  "parsers",
  "lint",
  "studio-server",
  "core",
  "engine",
  "producer",
  "player",
  "shader-transitions",
  "studio",
  "aws-lambda",
  "gcp-cloud-run",
  "cli",
  "desktop",
];

for (const name of packages) {
  console.log(`\nBuilding @hyperframes/${name}`);
  const result = spawnSync(
    process.platform === "win32" ? "bun.exe" : "bun",
    ["run", "--filter", `@hyperframes/${name}`, "build"],
    {
      stdio: "inherit",
      env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", VITE_HYPERFRAMES_NO_TELEMETRY: "1" },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
