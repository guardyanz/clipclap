/**
 * Remote Registry Fetching
 *
 * Fetches registry manifests and item files from a Hyperframes registry hosted
 * on GitHub (or any HTTPS endpoint serving the same file layout).
 *
 * Base URL layout:
 *   <base>/registry.json                    → top-level manifest
 *   <base>/<type-dir>/<name>/registry-item.json
 *   <base>/<type-dir>/<name>/<file.path>    → individual files referenced by the item
 *
 * `<type-dir>` comes from ITEM_TYPE_DIRS in @hyperframes/core.
 */

import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import {
  ITEM_TYPE_DIRS,
  type FileTarget,
  type ItemType,
  type RegistryItem,
  type RegistryManifest,
} from "@hyperframes/core";

export const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry";

const FETCH_TIMEOUT_MS = 10_000;

// ── Local (offline) registry ───────────────────────────────────────────────
// The `registry/` directory in this monorepo already has the exact layout
// `DEFAULT_REGISTRY_URL` serves over HTTP (registry.json + <type-dir>/<name>/
// registry-item.json + referenced files). When a copy of it is reachable on
// disk — bundled as an extraResource in the packaged desktop app, or simply
// running inside the monorepo checkout — prefer it over the network so the
// catalog and `add`/install work with no connection at all. A project that
// sets an explicit custom `registry` URL in hyperframes.json is never
// second-guessed here; this substitution only fires for the official default.

function isRemoteUrl(baseUrl: string): boolean {
  return /^https?:\/\//i.test(baseUrl);
}

function resolveLocalRegistryDir(): string | undefined {
  const candidates = [
    process.env.CLIPCLAP_REGISTRY_DIR,
    // Packaged desktop app: extraResources land next to the built server bundle.
    join(__dirname, "registry"),
    // Bundled dist run from inside the monorepo checkout (dist -> cli -> packages -> root).
    join(__dirname, "..", "..", "..", "registry"),
    // Unbundled source run (tests, tsx) — one level deeper (src/registry -> ... -> root).
    join(__dirname, "..", "..", "..", "..", "registry"),
  ].filter((p): p is string => Boolean(p));

  for (const dir of candidates) {
    if (existsSync(join(dir, "registry.json"))) return dir;
  }
  return undefined;
}

/**
 * The registry base URL to use when a caller hasn't set an explicit one —
 * a local bundled/monorepo registry directory if one is reachable, else the
 * official remote URL. Exposed for callers that pick a baseUrl themselves
 * (e.g. to seed a new project's `hyperframes.json`); the three fetchers below
 * apply the same substitution internally, so most callers don't need this.
 */
export function resolveDefaultRegistryBaseUrl(): string {
  return resolveLocalRegistryDir() ?? DEFAULT_REGISTRY_URL;
}

/**
 * Every caller — CLI commands reading a scaffolded project's committed
 * `hyperframes.json` (whose `registry` field is literally
 * `DEFAULT_REGISTRY_URL` unless a user hand-edited it), the resolver's own
 * `?? DEFAULT_REGISTRY_URL` fallbacks, Studio's server-side catalog — ends up
 * passing this exact string, not `undefined`, so a default *parameter* value
 * alone can't intercept it. Normalize at the point of use instead: swap in a
 * local registry directory whenever the caller asked for the official
 * default, whether that arrived as "omitted" or as the literal URL string. A
 * genuinely custom `registry` value (a user's own URL or local path) is
 * never touched here.
 */
function resolveEffectiveBaseUrl(baseUrl: string): string {
  if (baseUrl !== DEFAULT_REGISTRY_URL) return baseUrl;
  return resolveLocalRegistryDir() ?? baseUrl;
}

// ── Local (offline) previews ────────────────────────────────────────────────
// Every block/component manifest's `preview.video`/`preview.poster` is a
// `static.heygen.ai` CDN URL, unreachable offline. `scripts/generate-catalog-
// previews.ts` can render the same media locally into the gitignored
// `docs/images/catalog/<type-dir>/<name>.{png,mp4}` — this resolves that
// local cache (or a packaged copy of it) so a caller can serve it instead of
// the CDN URL. Absence is not an error: a manifest whose preview was never
// generated locally just keeps pointing at the CDN, which Studio's catalog
// card already degrades gracefully from (falls back to a category badge).

function resolveLocalPreviewsDir(): string | undefined {
  const candidates = [
    process.env.CLIPCLAP_PREVIEWS_DIR,
    // Packaged desktop app: extraResources land next to the built server bundle.
    join(__dirname, "previews"),
    // Bundled dist run from inside the monorepo checkout.
    join(__dirname, "..", "..", "..", "docs", "images", "catalog"),
    // Unbundled source run (tests, tsx).
    join(__dirname, "..", "..", "..", "..", "docs", "images", "catalog"),
  ].filter((p): p is string => Boolean(p));

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return undefined;
}

/**
 * Absolute path to a locally-generated preview file for a registry item, if
 * one exists. `typeDir` is the registry's `<type-dir>` segment (`"blocks"`,
 * `"components"` — see `ITEM_TYPE_DIRS`), not the `ItemType` string itself,
 * so both the manifest-rewrite call site (which has an `ItemType` and maps
 * it) and the HTTP route (which already has the raw path segment) can call
 * this with no extra mapping on either side.
 */
export function resolveLocalPreviewPath(
  typeDir: string,
  name: string,
  ext: string,
): string | undefined {
  const dir = resolveLocalPreviewsDir();
  if (!dir) return undefined;
  const filePath = join(dir, typeDir, `${name}.${ext}`);
  return existsSync(filePath) ? filePath : undefined;
}

// ── Caching ─────────────────────────────────────────────────────────────────
// 24h TTL on manifest fetches so the interactive picker stays snappy offline.
// Item files aren't cached — they're written straight to destDir on install.

const CACHE_DIR = join(homedir(), ".clipclap", "cache");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
  fetchedAt: number;
  data: T;
}

function cachePath(baseUrl: string, key: string): string {
  const slug = baseUrl.replace(/[^a-zA-Z0-9]/g, "_");
  return join(CACHE_DIR, `${slug}__${key}.json`);
}

function readCache<T>(path: string): T | undefined {
  try {
    const entry = JSON.parse(readFileSync(path, "utf-8")) as CacheEntry<T>;
    if (typeof entry.fetchedAt !== "number") return undefined;
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return undefined;
    return entry.data;
  } catch {
    // Missing file or corrupt JSON → cache miss.
    return undefined;
  }
}

function writeCache<T>(path: string, data: T): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const entry: CacheEntry<T> = { fetchedAt: Date.now(), data };
    writeFileSync(path, JSON.stringify(entry), "utf-8");
  } catch {
    // Cache writes are opportunistic. A read-only home directory or sandboxed
    // environment should not make the registry appear unreachable.
  }
}

// ── Fetchers ────────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Registry fetch failed: ${url} — HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

function readLocalJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

/**
 * Fetch the top-level registry.json manifest. Cached for 24h when remote.
 * Returns undefined if the registry is unreachable (offline / 404 / missing
 * local directory).
 */
export async function fetchRegistryManifest(
  baseUrl: string = DEFAULT_REGISTRY_URL,
  options?: { skipCache?: boolean },
): Promise<RegistryManifest | undefined> {
  baseUrl = resolveEffectiveBaseUrl(baseUrl);
  if (!isRemoteUrl(baseUrl)) {
    try {
      return readLocalJson<RegistryManifest>(join(baseUrl, "registry.json"));
    } catch {
      return undefined;
    }
  }

  const cacheFile = cachePath(baseUrl, "registry");
  if (!options?.skipCache) {
    const cached = readCache<RegistryManifest>(cacheFile);
    if (cached) return cached;
  }

  try {
    const manifest = await fetchJson<RegistryManifest>(`${baseUrl}/registry.json`);
    writeCache(cacheFile, manifest);
    return manifest;
  } catch {
    return undefined;
  }
}

/**
 * Fetch a single item's `registry-item.json` manifest. Cached for 24h when
 * remote. Throws on failure (callers decide whether to degrade gracefully).
 */
export async function fetchItemManifest(
  name: string,
  type: ItemType,
  baseUrl: string = DEFAULT_REGISTRY_URL,
): Promise<RegistryItem> {
  baseUrl = resolveEffectiveBaseUrl(baseUrl);
  const dir = ITEM_TYPE_DIRS[type];

  if (!isRemoteUrl(baseUrl)) {
    return readLocalJson<RegistryItem>(join(baseUrl, dir, name, "registry-item.json"));
  }

  const cacheFile = cachePath(baseUrl, `${dir}__${name}`);
  const cached = readCache<RegistryItem>(cacheFile);
  if (cached) return cached;

  const url = `${baseUrl}/${dir}/${name}/registry-item.json`;
  const item = await fetchJson<RegistryItem>(url);
  writeCache(cacheFile, item);
  return item;
}

/**
 * Download (or copy, for a local registry) a single file referenced by an
 * item to a local destination. Caller is responsible for target-path
 * validation (see installer.ts).
 */
export async function fetchItemFile(
  item: RegistryItem,
  file: FileTarget,
  destPath: string,
  baseUrl: string = DEFAULT_REGISTRY_URL,
): Promise<void> {
  baseUrl = resolveEffectiveBaseUrl(baseUrl);
  // Reject path-traversal in file.path (mirrors assertSafeTarget for file.target).
  if (/(^|[/\\])\.\.([/\\]|$)/.test(file.path)) {
    throw new Error(`Unsafe file.path "${file.path}": path segments may not contain "..".`);
  }

  if (!isRemoteUrl(baseUrl)) {
    const sourcePath = join(baseUrl, ITEM_TYPE_DIRS[item.type], item.name, file.path);
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(sourcePath, destPath);
    return;
  }

  const url = `${baseUrl}/${ITEM_TYPE_DIRS[item.type]}/${item.name}/${file.path}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`File fetch failed: ${url} — HTTP ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, buf);
}
