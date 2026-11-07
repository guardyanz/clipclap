/**
 * Wizard server for `clipclap wizard` — proof-of-concept "few-click" flow.
 *
 * Serves a minimal static UI (template gallery → auto-generated form →
 * render → download) backed by a small JSON API. Reuses the same
 * composition-variables schema and in-process render API the full Studio
 * editor uses, just without any of Studio's timeline/canvas/DOM-editing
 * surface — see `VariablesPanel.tsx` in @hyperframes/studio for the richer
 * (developer-facing) version of the same type→widget mapping used here.
 *
 * Dev-mode only: template discovery reads `registry/examples/` directly from
 * the monorepo checkout. A packed CLI build would need those examples copied
 * into `dist/` the same way skills are (see `scripts/build-copy.mjs`).
 */

import { Hono } from "hono";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { toFps } from "@hyperframes/core";
import { isCompositionVariable, type CompositionVariable } from "@hyperframes/core/variables";
import { isDevMode } from "../utils/env.js";

async function loadProducer() {
  return isDevMode()
    ? await import("../../../producer/src/index.js")
    : await import("@hyperframes/producer");
}

interface TemplateInfo {
  id: string;
  title: string;
  description: string;
  width: number;
  height: number;
  duration: number;
  /** Frame shapes this template's layout can be rendered at. */
  orientations: OrientationId[];
  /** Template exposes the plain-language motion field. */
  aiMotion: boolean;
  /** Authored to loop seamlessly — last frame cuts invisibly back to the first. */
  loop: boolean;
  variables: CompositionVariable[];
  dir: string;
}

/**
 * Repo root sits a different number of levels up depending on whether this
 * module is running from source (`packages/cli/src/server/`, e.g. via tsx)
 * or from the tsup bundle (flattened into `packages/cli/dist/`) — mirrors
 * the dev/built dual-path pattern in commands/init.ts's resolveAssetDir().
 *
 * CLIPCLAP_TEMPLATES_DIR overrides both: the packaged desktop app ships the
 * templates as an Electron extraResource, where no relative walk from this
 * module's location can reach them.
 */
function resolveExamplesDir(): string {
  const override = process.env["CLIPCLAP_TEMPLATES_DIR"];
  if (override && existsSync(override)) return override;
  const base = dirname(fileURLToPath(import.meta.url));
  const fromSource = resolve(base, "..", "..", "..", "..", "registry", "examples");
  if (existsSync(fromSource)) return fromSource;
  const fromDist = resolve(base, "..", "..", "..", "registry", "examples");
  if (existsSync(fromDist)) return fromDist;
  return fromSource;
}

/**
 * Extract `data-composition-variables` off the `<html>` tag without a full
 * DOM parse — the attribute is always JSON, always on `<html ...>`, and this
 * runs against a handful of local files, not untrusted input.
 */
function extractDeclaredVariables(html: string): CompositionVariable[] {
  const match = html.match(/<html[^>]*\sdata-composition-variables=(['"])([\s\S]*?)\1/);
  const raw = match?.[2];
  if (raw === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCompositionVariable);
  } catch {
    return [];
  }
}

// ── Orientation & resolution ────────────────────────────────────────────────
// `outputResolution` in the producer only does integer upscales at a MATCHING
// aspect ratio (see checkOutputResolutionCompatibility) — it cannot turn a
// landscape composition into a portrait one. So orientation is applied by
// rewriting the copied composition's own dimensions, and the 4K option rides
// the supported path: every 4K preset is exactly 2x its 1080-class base.
const ORIENTATION_BASE = {
  landscape: { width: 1920, height: 1080, resolution4k: "landscape-4k" },
  portrait: { width: 1080, height: 1920, resolution4k: "portrait-4k" },
  square: { width: 1080, height: 1080, resolution4k: "square-4k" },
} as const;

type OrientationId = keyof typeof ORIENTATION_BASE;

function isOrientationId(value: unknown): value is OrientationId {
  return typeof value === "string" && value in ORIENTATION_BASE;
}

/** The orientation a composition is already authored in. */
function nativeOrientation(width: number, height: number): OrientationId {
  if (width === height) return "square";
  return width > height ? "landscape" : "portrait";
}

function normalizeOrientations(
  declared: string[] | undefined,
  width: number,
  height: number,
): OrientationId[] {
  const native = nativeOrientation(width, height);
  if (!Array.isArray(declared) || declared.length === 0) return [native];
  const valid = declared.filter(isOrientationId);
  return valid.length > 0 ? valid : [native];
}

/**
 * Rewrite a copied composition to a different frame shape. Only the three
 * places that carry the authored size are touched, and each replacement is
 * keyed to the template's own declared dimensions so nothing else matches.
 */
function applyOrientation(
  projectDir: string,
  from: { width: number; height: number },
  to: { width: number; height: number },
): void {
  if (from.width === to.width && from.height === to.height) return;
  const indexPath = join(projectDir, "index.html");
  if (!existsSync(indexPath)) return;

  const rewritten = readFileSync(indexPath, "utf-8")
    .replaceAll(`data-width="${from.width}"`, `data-width="${to.width}"`)
    .replaceAll(`data-height="${from.height}"`, `data-height="${to.height}"`)
    .replaceAll(
      `width=${from.width}, height=${from.height}`,
      `width=${to.width}, height=${to.height}`,
    )
    .replaceAll(`width: ${from.width}px`, `width: ${to.width}px`)
    .replaceAll(`height: ${from.height}px`, `height: ${to.height}px`);

  writeFileSync(indexPath, rewritten, "utf-8");
}

/** Only templates that declare variables are wizard-ready — see plan Slice 1. */
function listTemplates(): TemplateInfo[] {
  const examplesDir = resolveExamplesDir();
  if (!existsSync(examplesDir)) return [];

  const templates: TemplateInfo[] = [];
  for (const entry of readdirSync(examplesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(examplesDir, entry.name);
    const itemPath = join(dir, "registry-item.json");
    const htmlPath = join(dir, "index.html");
    if (!existsSync(itemPath) || !existsSync(htmlPath)) continue;

    try {
      const item = JSON.parse(readFileSync(itemPath, "utf-8")) as {
        name?: string;
        title?: string;
        description?: string;
        dimensions?: { width?: number; height?: number };
        duration?: number;
        orientations?: string[];
        aiMotion?: boolean;
        loop?: boolean;
      };
      const variables = extractDeclaredVariables(readFileSync(htmlPath, "utf-8"));
      if (variables.length === 0) continue;

      const width = item.dimensions?.width ?? 1920;
      const height = item.dimensions?.height ?? 1080;

      templates.push({
        id: item.name ?? entry.name,
        title: item.title ?? entry.name,
        description: item.description ?? "",
        width,
        height,
        duration: item.duration ?? 5,
        // Reshaping a composition only looks right when its layout is fluid.
        // Templates opt in explicitly; everything else stays at its authored
        // shape rather than silently rendering a broken frame.
        orientations: normalizeOrientations(item.orientations, width, height),
        aiMotion: item.aiMotion === true,
        loop: item.loop === true,
        variables,
        dir,
      });
    } catch {
      continue;
    }
  }
  return templates;
}

// ── Browser readiness ───────────────────────────────────────────────────────
// The render pipeline resolves Chrome via resolveHeadlessShellPath(), which
// returns undefined when nothing is installed — it never downloads. So on a
// machine that has never run ClipClap, a render would fail with no useful
// signal. We do the download ourselves at startup and publish progress so the
// UI can show a real setup screen instead of a stuck 0%.
type SetupState = "checking" | "downloading" | "ready" | "error";

interface SetupStatus {
  state: SetupState;
  downloadedBytes: number;
  totalBytes: number;
  error?: string;
}

const setupStatus: SetupStatus = { state: "checking", downloadedBytes: 0, totalBytes: 0 };

async function prepareBrowser(): Promise<void> {
  try {
    const { ensureBrowser } = await import("../browser/manager.js");
    const result = await ensureBrowser({
      // Without this a system Chrome satisfies the check here, but the
      // producer still downloads its own pinned build at render time —
      // the stall we are trying to eliminate. Matches commands/render.
      preferManagedChrome: true,
      onProgress: (downloadedBytes, totalBytes) => {
        setupStatus.state = "downloading";
        setupStatus.downloadedBytes = downloadedBytes;
        setupStatus.totalBytes = totalBytes;
      },
    });
    process.env["PRODUCER_HEADLESS_SHELL_PATH"] = result.executablePath;
    setupStatus.state = "ready";
  } catch (err) {
    setupStatus.state = "error";
    setupStatus.error = err instanceof Error ? err.message : String(err);
  }
}

type WizardJobStatus = "queued" | "rendering" | "done" | "error" | "cancelled";

interface WizardJob {
  id: string;
  templateId: string;
  status: WizardJobStatus;
  progress: number;
  message: string;
  outputPath?: string;
  error?: string;
}

const jobs = new Map<string, WizardJob>();
const jobAborts = new Map<string, AbortController>();

// Upload placeholder scheme: the client posts a file to /api/upload, gets
// back an `upload:<id>` marker, and puts that marker directly in the image
// variable's value. startRenderJob() resolves any such marker into a real
// file inside the render's temp project dir right before rendering — the
// producer only ever sees an ordinary relative path, never network I/O
// (this repo's compositions must not fetch at render time — see CLAUDE.md).
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_UPLOAD_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif"]);
const uploads = new Map<string, { path: string; ext: string }>();

function isUploadMarker(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("upload:");
}

/** Copy any `upload:<id>` marker values into `projectDir/uploads/` and rewrite them to relative paths. */
function resolveUploadedAssets(
  projectDir: string,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...variables };
  for (const [key, value] of Object.entries(resolved)) {
    if (!isUploadMarker(value)) continue;
    const uploadId = value.slice("upload:".length);
    const upload = uploads.get(uploadId);
    if (!upload) continue;

    const uploadsDir = join(projectDir, "uploads");
    mkdirSync(uploadsDir, { recursive: true });
    const relativePath = join("uploads", `${uploadId}${upload.ext}`);
    cpSync(upload.path, join(projectDir, relativePath));
    resolved[key] = relativePath.replace(/\\/g, "/");
  }
  return resolved;
}

// ── AI motion generation ────────────────────────────────────────────────────
// The user describes the movement they want; a model returns a GSAP timeline
// body which is spliced into the composition between its markers. The output
// is code that runs inside the render browser, so it is validated first: a
// strict allowlist of statements plus a denylist covering the determinism
// rules this repo renders under (no clocks, no randomness, no network).
const MOTION_START = "// ── CLIPCLAP:MOTION:START";
const MOTION_END = "// ── CLIPCLAP:MOTION:END";

const MOTION_FORBIDDEN = [
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /\bimport\b/,
  /\brequire\s*\(/,
  /\beval\s*\(/,
  /new\s+Function/,
  /Date\s*\.\s*now/,
  /new\s+Date\b/,
  /Math\s*\.\s*random/,
  /document\s*\.\s*write/,
  /localStorage|sessionStorage|indexedDB/,
  /\bwhile\s*\(/,
  /setTimeout|setInterval|requestAnimationFrame/,
  /window\s*\./,
  /<\s*script/i,
];

/** Only `tl.` and `gsap.` statements targeting the composition's own ids. */
const MOTION_ALLOWED_LINE = /^\s*(?:\/\/.*|tl\s*\.\w+\s*\(|gsap\s*\.\w+\s*\(|\)|\}|\{|,|;|.*)?$/;

function validateMotionCode(code: string): string | null {
  if (code.length > 4000) return "Animation code is too long.";
  for (const pattern of MOTION_FORBIDDEN) {
    if (pattern.test(code)) {
      return `Animation code rejected: contains a forbidden pattern (${pattern.source}).`;
    }
  }
  const statements = code
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));
  if (statements.length === 0) return "Animation code is empty.";
  for (const line of statements) {
    if (!/^(tl|gsap)\s*\./.test(line) && !MOTION_ALLOWED_LINE.test(line)) {
      return `Statement not allowed: ${line.slice(0, 60)}`;
    }
    if (!/^(tl|gsap)\s*\./.test(line) && !/^[)\]}\s,;.]/.test(line)) {
      return `Hanya perintah tl.* dan gsap.* yang diizinkan. Ditemukan: ${line.slice(0, 60)}`;
    }
  }
  return null;
}

/** Splice validated motion code into the copied composition. */
function applyMotionCode(projectDir: string, code: string): void {
  const indexPath = join(projectDir, "index.html");
  if (!existsSync(indexPath)) return;
  const html = readFileSync(indexPath, "utf-8");
  const start = html.indexOf(MOTION_START);
  const end = html.indexOf(MOTION_END);
  if (start === -1 || end === -1 || end < start) return;

  const lineEnd = html.indexOf("\n", start);
  const before = html.slice(0, lineEnd + 1);
  const after = html.slice(end);
  writeFileSync(indexPath, `${before}${code}\n      ${after}`, "utf-8");
}

interface RenderOptionsInput {
  orientation: OrientationId;
  fourK: boolean;
  motionCode?: string;
}

function startRenderJob(
  template: TemplateInfo,
  variables: Record<string, unknown>,
  options: RenderOptionsInput,
): WizardJob {
  const jobId = randomUUID();
  const job: WizardJob = {
    id: jobId,
    templateId: template.id,
    status: "queued",
    progress: 0,
    message: "Queued",
  };
  jobs.set(jobId, job);

  const projectDir = mkdtempSync(join(tmpdir(), "clipclap-wizard-"));
  const outputPath = join(tmpdir(), `clipclap-wizard-output-${jobId}.mp4`);
  const abortController = new AbortController();
  jobAborts.set(jobId, abortController);

  (async () => {
    try {
      cpSync(template.dir, projectDir, { recursive: true });
      const resolvedVariables = resolveUploadedAssets(projectDir, variables);

      const base = ORIENTATION_BASE[options.orientation];
      applyOrientation(projectDir, { width: template.width, height: template.height }, base);
      if (options.motionCode) applyMotionCode(projectDir, options.motionCode);
      job.status = "rendering";

      const producer = await loadProducer();
      const request = producer.createRenderRequest({
        projectDir,
        outputPath,
        options: {
          fps: toFps(30),
          quality: "draft",
          format: "mp4",
          variables: resolvedVariables,
          // Safe by construction: each 4K preset is an exact 2x of the base
          // we just reshaped the composition to, which is what the producer's
          // integer-upscale rule requires.
          ...(options.fourK ? { outputResolution: base.resolution4k } : {}),
        },
      });
      const renderJob = producer.createRenderJob(producer.renderConfigFromRequest(request));
      await producer.executeRenderJob(
        renderJob,
        projectDir,
        outputPath,
        (rj, message) => {
          job.progress = rj.progress;
          job.message = message;
        },
        abortController.signal,
      );

      job.status = "done";
      job.progress = 100;
      job.message = "Done";
      job.outputPath = outputPath;
    } catch (err) {
      // An aborted render rejects like any other failure; report the user's
      // own cancellation as such rather than as an error they have to read.
      if (abortController.signal.aborted) {
        job.status = "cancelled";
        job.message = "Cancelled";
      } else {
        job.status = "error";
        job.error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      jobAborts.delete(jobId);
    }
  })();

  return job;
}

const UPLOAD_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function mimeTypeForExt(ext: string): string {
  return UPLOAD_MIME_TYPES[ext] ?? "application/octet-stream";
}

function readUiAsset(uiDir: string, name: string): string | null {
  const path = join(uiDir, name);
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

export function createWizardApp(): Hono {
  const app = new Hono();
  const uiDir = resolve(dirname(fileURLToPath(import.meta.url)), "wizard-ui");

  // Fire and forget: on a warm machine this settles in milliseconds (a few
  // existsSync calls, no lock, no network), so nothing is gained by awaiting
  // it before the server starts listening.
  void prepareBrowser();

  app.get("/", (c) => {
    const html = readUiAsset(uiDir, "index.html");
    if (!html) return c.text("Wizard UI not found", 500);
    return c.html(html);
  });

  app.get("/wizard.js", (c) => {
    const js = readUiAsset(uiDir, "wizard.js");
    if (!js) return c.notFound();
    return c.body(js, 200, { "Content-Type": "application/javascript; charset=utf-8" });
  });

  app.get("/wizard.css", (c) => {
    const css = readUiAsset(uiDir, "wizard.css");
    if (!css) return c.notFound();
    return c.body(css, 200, { "Content-Type": "text/css; charset=utf-8" });
  });

  app.post("/api/upload", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "file is required" }, 400);
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: "File too large (max 20MB)" }, 413);
    }

    const ext = extname(file.name).toLowerCase();
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
      return c.json({ error: `Unsupported file type: ${ext || "(none)"}` }, 415);
    }

    const uploadId = randomUUID();
    const uploadsTmpDir = join(tmpdir(), "clipclap-wizard-uploads");
    mkdirSync(uploadsTmpDir, { recursive: true });
    const path = join(uploadsTmpDir, `${uploadId}${ext}`);
    writeFileSync(path, Buffer.from(await file.arrayBuffer()));
    uploads.set(uploadId, { path, ext });

    return c.json({ uploadId, previewUrl: `/api/uploads/${uploadId}` });
  });

  app.get("/api/uploads/:uploadId", (c) => {
    const upload = uploads.get(c.req.param("uploadId"));
    if (!upload || !existsSync(upload.path)) return c.notFound();
    return c.body(readFileSync(upload.path), 200, {
      "Content-Type": mimeTypeForExt(upload.ext),
    });
  });

  app.get("/api/templates", (c) => {
    const templates = listTemplates().map(({ dir: _dir, ...rest }) => rest);
    return c.json({ templates });
  });

  app.get("/api/setup", (c) => c.json(setupStatus));

  // The buyer brings their own key; it is used for this one request and never
  // written to disk or logged here.
  app.post("/api/motion", async (c) => {
    const body = await c.req.json<{ prompt?: string; apiKey?: string }>();
    const prompt = body.prompt?.trim();
    const apiKey = body.apiKey?.trim();
    if (!prompt) return c.json({ error: "Describe the motion you want first." }, 400);
    if (!apiKey) return c.json({ error: "Enter your API key first." }, 400);

    const instruction = [
      "You generate a GSAP timeline body for a video composition.",
      "Output ONLY JavaScript statements, no markdown fence, no explanation.",
      "The timeline variable is `tl` (a paused gsap.timeline). The animated",
      'element is the selector "#obj-1". You may also call gsap.set("#obj-1", …)',
      "to establish an initial state before the timeline runs.",
      "The composition is exactly 6 seconds long; keep all timings within 0–5.8s.",
      "Allowed properties: x, y, scale, rotation, opacity, skewX, skewY,",
      "transformOrigin, duration, ease, repeat, yoyo, stagger.",
      "Forbidden: any clock, randomness, network access, timers, window access,",
      "innerHTML/textContent changes, or creating elements. Deterministic only.",
      "",
      `User's requested motion: ${prompt}`,
    ].join("\n");

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${process.env["HYPERFRAMES_GEMINI_MODEL"] ?? "gemini-2.0-flash"}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({ contents: [{ parts: [{ text: instruction }] }] }),
        },
      );
      if (!res.ok) {
        const detail = await res.text();
        return c.json(
          { error: `Model rejected the request (${res.status}). ${detail.slice(0, 200)}` },
          502,
        );
      }
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const code = raw
        .replace(/^```(?:js|javascript)?/gm, "")
        .replace(/```$/gm, "")
        .trim();

      const problem = validateMotionCode(code);
      if (problem) return c.json({ error: problem, code }, 422);
      return c.json({ code });
    } catch (err) {
      return c.json(
        { error: `Could not reach the model: ${err instanceof Error ? err.message : String(err)}` },
        502,
      );
    }
  });

  app.post("/api/render", async (c) => {
    if (setupStatus.state !== "ready") {
      return c.json(
        {
          error:
            setupStatus.state === "error"
              ? `Setup failed: ${setupStatus.error ?? "unknown error"}`
              : "ClipClap is still setting up video components. Please wait.",
          setupState: setupStatus.state,
        },
        503,
      );
    }

    const body = await c.req.json<{
      templateId?: string;
      variables?: Record<string, unknown>;
      orientation?: string;
      resolution?: string;
      motionCode?: string;
    }>();
    if (!body.templateId) return c.json({ error: "templateId is required" }, 400);

    const template = listTemplates().find((t) => t.id === body.templateId);
    if (!template) return c.json({ error: "Template not found" }, 404);

    const requested = body.orientation;
    const orientation =
      isOrientationId(requested) && template.orientations.includes(requested)
        ? requested
        : (template.orientations[0] ?? nativeOrientation(template.width, template.height));

    // Re-validate here, not just at generation time: the client could send
    // any string, and this one ends up executing inside the render browser.
    let motionCode: string | undefined;
    if (body.motionCode) {
      const problem = validateMotionCode(body.motionCode);
      if (problem) return c.json({ error: problem }, 422);
      motionCode = body.motionCode;
    }

    const job = startRenderJob(template, body.variables ?? {}, {
      orientation,
      fourK: body.resolution === "4k",
      ...(motionCode ? { motionCode } : {}),
    });
    return c.json({ jobId: job.id });
  });

  app.get("/api/render/:jobId", (c) => {
    const job = jobs.get(c.req.param("jobId"));
    if (!job) return c.json({ error: "Job not found" }, 404);
    const { outputPath: _outputPath, ...status } = job;
    return c.json(status);
  });

  app.post("/api/render/:jobId/cancel", (c) => {
    const jobId = c.req.param("jobId");
    const controller = jobAborts.get(jobId);
    if (!controller) return c.json({ error: "Job not found or already finished" }, 404);
    controller.abort();
    return c.json({ ok: true });
  });

  /** Finished MP4, or null when the job isn't done / the file vanished. */
  function finishedOutput(jobId: string): { job: WizardJob; path: string } | null {
    const job = jobs.get(jobId);
    if (!job || job.status !== "done" || !job.outputPath || !existsSync(job.outputPath)) {
      return null;
    }
    return { job, path: job.outputPath };
  }

  // Inline sibling of /output — same bytes without Content-Disposition, so a
  // <video> element plays the result in place instead of downloading it.
  app.get("/preview/:jobId", (c) => {
    const found = finishedOutput(c.req.param("jobId"));
    if (!found) return c.notFound();
    return c.body(readFileSync(found.path), 200, {
      "Content-Type": "video/mp4",
      "Content-Length": String(statSync(found.path).size),
    });
  });

  app.get("/output/:jobId", (c) => {
    const found = finishedOutput(c.req.param("jobId"));
    if (!found) return c.notFound();
    return c.body(readFileSync(found.path), 200, {
      "Content-Type": "video/mp4",
      "Content-Length": String(statSync(found.path).size),
      "Content-Disposition": `attachment; filename="${found.job.templateId}.mp4"`,
    });
  });

  return app;
}
