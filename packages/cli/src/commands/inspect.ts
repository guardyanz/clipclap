import type { Example } from "./_examples.js";
import { createInspectCommand } from "./layout.js";

export const examples: Example[] = [
  ["Inspect visual layout across the current composition", "clipclap inspect"],
  ["Inspect a specific project", "clipclap inspect ./my-video"],
  ["Output agent-readable JSON", "clipclap inspect --json"],
  ["Use explicit hero-frame timestamps", "clipclap inspect --at 1.5,4.0,7.25"],
  [
    "Also sample at tween boundaries to catch transient overlaps",
    "clipclap inspect --at-transitions",
  ],
  [
    "Verify motion intent (add a *.motion.json sidecar next to the composition)",
    "clipclap inspect --json",
  ],
  ["Run the compatibility alias", "clipclap layout --json"],
];

export default createInspectCommand("inspect");
