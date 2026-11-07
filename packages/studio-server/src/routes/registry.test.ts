import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { registerRegistryRoutes } from "./registry";
import type { StudioApiAdapter } from "../types";

function createAdapter(overrides: Partial<StudioApiAdapter> = {}): StudioApiAdapter {
  return {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir: "/tmp/project" }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => "/tmp/renders",
    startRender: () => ({
      id: "job-1",
      status: "rendering",
      progress: 0,
      outputPath: "/tmp/out.mp4",
    }),
    ...overrides,
  };
}

describe("registerRegistryRoutes", () => {
  it("returns the catalog from listRegistryCatalog", async () => {
    const listRegistryCatalog = vi.fn(async () => [{ name: "demo" }] as never);
    const app = new Hono();
    registerRegistryRoutes(app, createAdapter({ listRegistryCatalog }));

    const response = await app.request("http://localhost/registry/blocks");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ name: "demo" }]);
  });

  it("501s the catalog route when the adapter has no registry", async () => {
    const app = new Hono();
    registerRegistryRoutes(app, createAdapter());

    const response = await app.request("http://localhost/registry/blocks");
    expect(response.status).toBe(501);
  });

  it("serves a local preview file with its content type", async () => {
    const getRegistryPreview = vi.fn(async () => ({
      data: Buffer.from("fake-png-bytes"),
      contentType: "image/png",
    }));
    const app = new Hono();
    registerRegistryRoutes(app, createAdapter({ getRegistryPreview }));

    const response = await app.request("http://localhost/registry/preview/blocks/app-showcase.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(getRegistryPreview).toHaveBeenCalledWith("blocks", "app-showcase", "png");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("fake-png-bytes");
  });

  it("404s a preview the adapter doesn't have", async () => {
    const getRegistryPreview = vi.fn(async () => null);
    const app = new Hono();
    registerRegistryRoutes(app, createAdapter({ getRegistryPreview }));

    const response = await app.request("http://localhost/registry/preview/blocks/missing.png");
    expect(response.status).toBe(404);
  });

  it("404s the preview route when the adapter has no registry preview support", async () => {
    const app = new Hono();
    registerRegistryRoutes(app, createAdapter());

    const response = await app.request("http://localhost/registry/preview/blocks/app-showcase.png");
    expect(response.status).toBe(404);
  });

  it("404s a file segment with no extension", async () => {
    const getRegistryPreview = vi.fn(async () => null);
    const app = new Hono();
    registerRegistryRoutes(app, createAdapter({ getRegistryPreview }));

    const response = await app.request("http://localhost/registry/preview/blocks/no-extension");
    expect(response.status).toBe(404);
    expect(getRegistryPreview).not.toHaveBeenCalled();
  });
});
