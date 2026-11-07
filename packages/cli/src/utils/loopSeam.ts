/**
 * Loop-seam check — how visually jarring the cut from a rendered video's
 * last frame back to its first frame will be when a player loops it (social
 * feed autoplay, `<video loop>`, GIF). MP4/webm/mov carry no loop metadata
 * of their own (unlike GIF's Netscape extension / `gifLoop`) — looping is
 * entirely the player's behavior, so "seamless loop" is something a
 * composition must be AUTHORED to produce, not something the render
 * pipeline can add after the fact. This gives template authors an
 * objective signal instead of eyeballing it.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getFfmpegBinary, psnrDb } from "@hyperframes/engine";

const execFileP = promisify(execFile);

/** The PSNR floor (dB) below which a loop cut reads as a visible pop. */
export const DEFAULT_LOOP_SEAM_THRESHOLD_DB = 28;

async function extractFirstFrame(videoPath: string): Promise<Buffer> {
  const { stdout } = await execFileP(
    getFfmpegBinary(),
    [
      "-ss",
      "0",
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "-",
    ],
    { maxBuffer: 32 * 1024 * 1024, encoding: "buffer" },
  );
  return stdout;
}

/**
 * Extracts the exact last frame. A seek-based approach (`-sseof`/`-ss`) only
 * approximates "near the end" — the offset needed to reliably land on the
 * true final frame depends on the video's duration and frame rate, and
 * getting it wrong either overshoots into an earlier frame or fails to seek
 * far enough. `-update 1` sidesteps the guesswork: the image2 muxer
 * overwrites the same output file on every frame, so whatever's left after
 * ffmpeg finishes decoding the whole stream is the last frame, exactly.
 */
async function extractLastFrame(videoPath: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "hf-loop-seam-"));
  try {
    const outPath = join(dir, "last.jpg");
    await execFileP(getFfmpegBinary(), ["-i", videoPath, "-update", "1", "-q:v", "2", outPath]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface LoopSeamResult {
  /** PSNR (dB) between the first and last frame. Infinity = pixel-identical. */
  psnrDb: number;
  seamless: boolean;
  thresholdDb: number;
}

/**
 * Compares a rendered video's first and last frame. Higher PSNR means a
 * closer match — the loop cut is a smaller step.
 *
 * Matching endpoints are necessary but NOT sufficient for a good loop: a
 * composition that fades in from an empty background and fades back out to
 * it scores perfectly (both endpoints are the same empty frame) while
 * actually reading as a blink, not continuous motion. This measures the
 * seam only; whether the motion *through* it carries is a design question.
 */
export async function checkLoopSeam(
  videoPath: string,
  thresholdDb: number = DEFAULT_LOOP_SEAM_THRESHOLD_DB,
): Promise<LoopSeamResult> {
  const [first, last] = await Promise.all([
    extractFirstFrame(videoPath),
    extractLastFrame(videoPath),
  ]);
  const db = await psnrDb(first, last);
  return { psnrDb: db, seamless: db >= thresholdDb, thresholdDb };
}
