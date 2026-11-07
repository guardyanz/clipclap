import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";

export function registerRegistryRoutes(api: Hono, adapter: StudioApiAdapter): void {
  api.get("/registry/blocks", async (c) => {
    if (!adapter.listRegistryCatalog) {
      return c.json({ error: "Registry not available" }, 501);
    }
    const items = await adapter.listRegistryCatalog();
    return c.json(items);
  });

  // Offline substitute for the CDN preview URLs baked into registry-item.json
  // — served only when a local copy exists (see getRegistryPreview on the
  // adapter); listRegistryCatalog rewrites preview.video/poster to point
  // here instead of the CDN when it finds one.
  api.get("/registry/preview/:typeDir/:file", async (c) => {
    if (!adapter.getRegistryPreview) return c.notFound();
    const typeDir = c.req.param("typeDir");
    const file = c.req.param("file");
    const dot = file.lastIndexOf(".");
    if (dot <= 0) return c.notFound();
    const name = file.slice(0, dot);
    const ext = file.slice(dot + 1);

    const preview = await adapter.getRegistryPreview(typeDir, name, ext);
    if (!preview) return c.notFound();
    return new Response(new Uint8Array(preview.data), {
      headers: {
        "Content-Type": preview.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });

  // fallow-ignore-next-line complexity
  api.post("/projects/:id/registry/install", async (c) => {
    if (!adapter.installRegistryBlock) {
      return c.json({ error: "Registry install not available" }, 501);
    }
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);

    const body = await c.req.json<{ blockName?: string }>().catch(() => null);
    if (!body?.blockName) {
      return c.json({ error: "blockName is required" }, 400);
    }

    try {
      const result = await adapter.installRegistryBlock({ project, blockName: body.blockName });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Install failed";
      return c.json({ error: message }, 500);
    }
  });
}
