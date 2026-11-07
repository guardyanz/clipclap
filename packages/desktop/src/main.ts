/**
 * ClipClap desktop app — Electron shell around two servers the CLI already
 * ships, started in-process so nothing needs a terminal:
 *
 *   Easy Mode    → `@hyperframes/cli/wizard-server`  (pick a template, fill a
 *                    short form, render)
 *   Full Editor → `@hyperframes/cli/studio-server` (live preview canvas,
 *                    timeline, block gallery, property inspector)
 *
 * This process owns FFmpeg path setup, the projects folder, and the app menu
 * that switches between the two.
 */
import { app, BrowserWindow, Menu, dialog, shell } from "electron";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_PROJECT = "my-video";
const SEED_TEMPLATE = "simple-intro";

function resolveResourcesDir(): string {
  // Packaged app: electron-builder's extraResources land in process.resourcesPath.
  // Dev mode (`bun run dev`, unpacked): fall back to the source resources/ dir.
  if (app.isPackaged) return process.resourcesPath;
  return join(__dirname, "..", "resources");
}

function resolveTemplatesDir(): string {
  const bundled = join(resolveResourcesDir(), "templates");
  if (existsSync(bundled)) return bundled;
  // Unpacked dev run: extraResources hasn't been staged yet, so read the
  // registry straight out of the monorepo.
  return join(__dirname, "..", "..", "..", "registry", "examples");
}

function resolveRegistryDir(): string {
  const bundled = join(resolveResourcesDir(), "registry");
  if (existsSync(bundled)) return bundled;
  // Unpacked dev run: extraResources hasn't been staged yet, so read the
  // registry straight out of the monorepo.
  return join(__dirname, "..", "..", "..", "registry");
}

function resolvePreviewsDir(): string {
  const bundled = join(resolveResourcesDir(), "previews");
  if (existsSync(bundled)) return bundled;
  // Unpacked dev run / previews not (yet) generated for this checkout —
  // read straight out of the monorepo's gitignored preview cache, which may
  // itself be partial or absent (see configureBundledPreviews below).
  return join(__dirname, "..", "..", "..", "docs", "images", "catalog");
}

function configureBundledFfmpeg(): void {
  const ffmpegDir = join(resolveResourcesDir(), "ffmpeg");
  const ffmpegPath = join(ffmpegDir, "ffmpeg.exe");
  const ffprobePath = join(ffmpegDir, "ffprobe.exe");
  if (existsSync(ffmpegPath)) process.env.HYPERFRAMES_FFMPEG_PATH = ffmpegPath;
  if (existsSync(ffprobePath)) process.env.HYPERFRAMES_FFPROBE_PATH = ffprobePath;
}

/**
 * In a packaged app the templates ship as an extraResource, out of reach of
 * the relative walk wizardServer.ts does from its own module location — point
 * it at the shipped copy explicitly.
 */
function configureBundledTemplates(): void {
  const templatesDir = resolveTemplatesDir();
  if (existsSync(templatesDir)) process.env.CLIPCLAP_TEMPLATES_DIR = templatesDir;
}

/**
 * Block/component catalog: bundled as its own extraResource (distinct from
 * `templates`, which is just `registry/examples`) so the Studio catalog and
 * `hyperframes add` install every block with no network at all. Read by
 * `resolveLocalRegistryDir()` in packages/cli/src/registry/remote.ts.
 */
function configureBundledRegistry(): void {
  const registryDir = resolveRegistryDir();
  if (existsSync(join(registryDir, "registry.json"))) {
    process.env.CLIPCLAP_REGISTRY_DIR = registryDir;
  }
}

/**
 * Catalog preview thumbnails (mp4/png), rendered locally by
 * scripts/generate-catalog-previews.ts into a gitignored cache — a manifest's
 * default `preview.video`/`preview.poster` is a static.heygen.ai CDN URL, so
 * without this the catalog just shows category badges offline instead of
 * real thumbnails. Best-effort: an empty or missing cache (the generator
 * hasn't been run, or was only run for some items) is not an error, it's
 * just fewer thumbnails — Studio's catalog card already falls back to a
 * plain badge per item. Read by `resolveLocalPreviewPath()` in
 * packages/cli/src/registry/remote.ts.
 */
function configureBundledPreviews(): void {
  const previewsDir = resolvePreviewsDir();
  if (existsSync(previewsDir)) process.env.CLIPCLAP_PREVIEWS_DIR = previewsDir;
}

// ── Projects ────────────────────────────────────────────────────────────────
// Studio opens a directory, not a scaffolded project — anything containing an
// index.html with data-composition-id works. We keep the user's projects in
// userData so an app reinstall doesn't wipe their work.

function projectsRoot(): string {
  const root = join(app.getPath("userData"), "projects");
  mkdirSync(root, { recursive: true });
  return root;
}

/** Seed a first project from a bundled template so Studio never opens empty. */
function ensureDefaultProject(): string {
  const root = projectsRoot();
  const existing = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (existing.length > 0) return join(root, existing[0]!.name);

  const target = join(root, DEFAULT_PROJECT);
  const seed = join(resolveTemplatesDir(), SEED_TEMPLATE);
  mkdirSync(target, { recursive: true });
  if (existsSync(seed)) cpSync(seed, target, { recursive: true });
  return target;
}

// ── Servers ─────────────────────────────────────────────────────────────────

/** hostname MUST stay loopback: these APIs read and write project files and
 * spawn renders with no auth, so binding the unspecified address would hand
 * them to the whole LAN. Same constraint the CLI documents as F-001 in
 * packages/cli/src/server/portUtils.ts. */
async function listen(fetch: (req: Request) => Response | Promise<Response>): Promise<number> {
  const { serve } = await import("@hono/node-server");
  return new Promise((resolve) => {
    const server = serve({ fetch, hostname: "127.0.0.1", port: 0 }, (info) => resolve(info.port));
    void server;
  });
}

let wizardPort: number | null = null;
let studioPort: number | null = null;

async function ensureWizardServer(): Promise<number> {
  if (wizardPort !== null) return wizardPort;
  const { createWizardApp } = await import("@hyperframes/cli/wizard-server");
  wizardPort = await listen(createWizardApp().fetch);
  console.log(`[clipclap-desktop] wizard server on 127.0.0.1:${wizardPort}`);
  return wizardPort;
}

async function ensureStudioServer(): Promise<number> {
  if (studioPort !== null) return studioPort;
  // studioServer forwards VITE_STUDIO_* from process.env into the SPA as
  // window.__HF_STUDIO_ENV__, which is how Studio's feature flags are read at
  // runtime. This one hides the code editor, file tree, storyboard view and
  // agent-prompt affordances — none of which mean anything to a buyer.
  process.env["VITE_STUDIO_CONSUMER_MODE"] = "true";
  const { createStudioServer } = await import("@hyperframes/cli/studio-server");
  const projectDir = ensureDefaultProject();
  const { app: studioApp } = createStudioServer({ projectDir });
  studioPort = await listen(studioApp.fetch);
  console.log(`[clipclap-desktop] studio server on 127.0.0.1:${studioPort} (${projectDir})`);
  return studioPort;
}

// ── Window + menu ───────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function getWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "ClipClap",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  return mainWindow;
}

async function openMode(mode: "wizard" | "studio"): Promise<void> {
  const win = getWindow();
  try {
    const port = mode === "wizard" ? await ensureWizardServer() : await ensureStudioServer();
    await win.loadURL(`http://127.0.0.1:${port}`);
  } catch (err) {
    dialog.showErrorBox(
      mode === "wizard" ? "Could not open Easy Mode" : "Could not open the editor",
      err instanceof Error ? err.message : String(err),
    );
  }
}

function buildMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "ClipClap",
        submenu: [
          {
            label: "Easy Mode — choose a template, fill in the form",
            accelerator: "CmdOrCtrl+1",
            click: () => void openMode("wizard"),
          },
          {
            label: "Full Editor — live preview and timeline",
            accelerator: "CmdOrCtrl+2",
            click: () => void openMode("studio"),
          },
          { type: "separator" },
          {
            label: "Open projects folder",
            click: () => void shell.openPath(projectsRoot()),
          },
          { type: "separator" },
          { role: "quit", label: "Quit" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload", label: "Reload" },
          { role: "toggleDevTools", label: "Developer Tools" },
          { type: "separator" },
          { role: "resetZoom", label: "Actual Size" },
          { role: "zoomIn", label: "Zoom In" },
          { role: "zoomOut", label: "Zoom Out" },
          { type: "separator" },
          { role: "togglefullscreen", label: "Full Screen" },
        ],
      },
    ]),
  );
}

// Without this, userData lands under the npm package name
// (@hyperframes/desktop) rather than the product's.
app.setName("ClipClap");

app.whenReady().then(() => {
  process.env.HYPERFRAMES_NO_TELEMETRY = "1";
  process.env.VITE_HYPERFRAMES_NO_TELEMETRY = "1";
  configureBundledFfmpeg();
  configureBundledTemplates();
  configureBundledRegistry();
  configureBundledPreviews();
  buildMenu();
  // CLIPCLAP_START_MODE=studio opens straight into the editor — used by the
  // smoke test, and handy for anyone who never wants the simple mode.
  const startMode = process.env["CLIPCLAP_START_MODE"] === "studio" ? "studio" : "wizard";
  void openMode(startMode);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void openMode(startMode);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
