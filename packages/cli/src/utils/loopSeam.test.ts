import { describe, expect, it, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFfmpegBinary } from "@hyperframes/engine";
import { checkLoopSeam } from "./loopSeam.js";

const execFileP = promisify(execFile);

/** A 1s clip that holds a single flat color for its whole duration — first
 * and last frame are the same pixels by construction. */
async function renderConstantColorClip(outPath: string, color: string): Promise<void> {
  await execFileP(getFfmpegBinary(), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=64x64:d=1:r=10`,
    "-frames:v",
    "10",
    outPath,
  ]);
}

/** A 1s clip that's solid `colorA` for the first half and solid `colorB` for
 * the second — first and last frame are maximally different colors. */
async function renderHardCutClip(outPath: string, colorA: string, colorB: string): Promise<void> {
  const dir = join(outPath, "..");
  const a = join(dir, "a.mp4");
  const b = join(dir, "b.mp4");
  await renderConstantColorClip(a, colorA);
  await renderConstantColorClip(b, colorB);
  const listFile = join(dir, "list.txt");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(listFile, `file '${a.replace(/\\/g, "/")}'\nfile '${b.replace(/\\/g, "/")}'\n`);
  await execFileP(getFfmpegBinary(), ["-y", "-f", "concat", "-safe", "0", "-i", listFile, outPath]);
}

/** Concatenates N 1s constant-color segments into one clip. */
async function renderConcatClip(outPath: string, colors: string[]): Promise<void> {
  const dir = join(outPath, "..");
  const { writeFileSync } = await import("node:fs");
  const segmentPaths = await Promise.all(
    colors.map(async (color, i) => {
      const p = join(dir, `seg-${i}.mp4`);
      await renderConstantColorClip(p, color);
      return p;
    }),
  );
  const listFile = join(dir, "list.txt");
  writeFileSync(
    listFile,
    segmentPaths.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n") + "\n",
  );
  await execFileP(getFfmpegBinary(), ["-y", "-f", "concat", "-safe", "0", "-i", listFile, outPath]);
}

describe("checkLoopSeam", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("reports high PSNR and seamless=true for a clip whose first and last frame match", async () => {
    dir = mkdtempSync(join(tmpdir(), "loop-seam-test-"));
    const clip = join(dir, "constant.mp4");
    await renderConstantColorClip(clip, "red");

    const result = await checkLoopSeam(clip);

    expect(result.seamless).toBe(true);
    expect(result.psnrDb).toBeGreaterThan(40);
  }, 20000);

  it("reports low PSNR and seamless=false for a clip whose first and last frame are opposite colors", async () => {
    dir = mkdtempSync(join(tmpdir(), "loop-seam-test-"));
    const clip = join(dir, "hardcut.mp4");
    await renderHardCutClip(clip, "red", "blue");

    const result = await checkLoopSeam(clip);

    expect(result.seamless).toBe(false);
    expect(result.psnrDb).toBeLessThan(28);
  }, 20000);

  it("respects a custom threshold", async () => {
    dir = mkdtempSync(join(tmpdir(), "loop-seam-test-"));
    const clip = join(dir, "hardcut.mp4");
    await renderHardCutClip(clip, "red", "blue");

    // The default threshold (28dB) fails this clip (asserted above); a
    // permissive custom threshold set below its actual PSNR must pass it.
    const withDefault = await checkLoopSeam(clip);
    const lenient = await checkLoopSeam(clip, withDefault.psnrDb - 1);

    expect(lenient.seamless).toBe(true);
    expect(lenient.thresholdDb).toBe(withDefault.psnrDb - 1);
  }, 20000);

  it("compares against the true final frame, not an approximate offset from EOF", async () => {
    dir = mkdtempSync(join(tmpdir(), "loop-seam-test-"));
    const clip = join(dir, "concat.mp4");
    // 4 one-second segments: red, green, blue, red. Frame 0 is red and the
    // TRUE last frame is also red (the loop is genuinely seamless) — but a
    // fixed "1 second before EOF" seek lands at the green/blue boundary
    // instead, which would misreport this as a hard cut. Locks in the
    // -update-1 full-decode fix over the earlier -sseof approximation.
    await renderConcatClip(clip, ["red", "green", "blue", "red"]);

    const result = await checkLoopSeam(clip);

    expect(result.seamless).toBe(true);
    expect(result.psnrDb).toBeGreaterThan(40);
  }, 20000);
});
