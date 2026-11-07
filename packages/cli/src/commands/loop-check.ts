import { failCommand } from "../utils/commandResult.js";
import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Example } from "./_examples.js";
import { checkLoopSeam, DEFAULT_LOOP_SEAM_THRESHOLD_DB } from "../utils/loopSeam.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { c } from "../ui/colors.js";

export const examples: Example[] = [
  ["Check a rendered video's loop seam", "clipclap loop-check out.mp4"],
  ["Require a stricter match", "clipclap loop-check out.mp4 --threshold 36"],
];

function fail(message: string): never {
  console.error(c.error(message));
  failCommand();
}

export default defineCommand({
  meta: {
    name: "loop-check",
    description: "Compare a rendered video's first and last frame to gauge how seamless it loops",
  },
  args: {
    video: { type: "positional", description: "Path to a rendered mp4/webm/mov", required: true },
    threshold: {
      type: "string",
      description: `PSNR floor in dB — below this, the loop cut is flagged (default: ${DEFAULT_LOOP_SEAM_THRESHOLD_DB})`,
    },
    json: { type: "boolean", description: "Output result as JSON", default: false },
  },
  async run({ args }) {
    const videoPath = resolve(args.video);
    if (!existsSync(videoPath)) fail(`File not found: ${args.video}`);

    const threshold = args.threshold !== undefined ? Number(args.threshold) : undefined;
    if (threshold !== undefined && !Number.isFinite(threshold)) {
      fail(`--threshold must be a number (got "${args.threshold}")`);
    }

    let result: Awaited<ReturnType<typeof checkLoopSeam>>;
    try {
      result = await checkLoopSeam(videoPath, threshold);
    } catch (err) {
      fail(`Loop check failed: ${normalizeErrorMessage(err)}`);
    }

    if (args.json) {
      console.log(JSON.stringify({ ok: true, file: args.video, ...result }, null, 2));
      return;
    }

    const dbLabel = Number.isFinite(result.psnrDb) ? `${result.psnrDb.toFixed(1)} dB` : "∞ dB";
    if (result.seamless) {
      console.log(c.success(`✓ Loops cleanly — first/last frame PSNR ${dbLabel}`));
    } else {
      console.log(
        c.error(
          `✗ Visible loop seam — first/last frame PSNR ${dbLabel} (below ${result.thresholdDb} dB). ` +
            "The composition's start and end states don't match closely enough to loop invisibly.",
        ),
      );
      failCommand();
    }
  },
});
