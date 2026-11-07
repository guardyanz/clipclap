import { describe, expect, it } from "vitest";
import { createWizardApp } from "./wizardServer.js";

describe("ClipClap public starter workflow", () => {
  it("serves the beginner UI and its local assets", async () => {
    const app = createWizardApp();
    const home = await app.request("http://localhost/");
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain("ClipClap");
    expect(html).toContain('lang="en"');
    expect(html).toContain("Choose a Template");
    for (const path of ["/wizard.js", "/wizard.css"]) {
      const response = await app.request(`http://localhost${path}`);
      expect(response.status).toBe(200);
      expect((await response.text()).length).toBeGreaterThan(100);
    }
  });

  it("offers the downstream gallery, loop and intro templates without a provider key", async () => {
    const response = await createWizardApp().request("http://localhost/api/templates");
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    const text = JSON.stringify(body);
    expect(text).toContain("ambient-loop");
    expect(text).toContain("photo-gallery");
    expect(text).toContain("simple-intro");
  });

  it("does not expose an output file for an unknown render job", async () => {
    const response = await createWizardApp().request("http://localhost/output/not-a-job");
    expect(response.status).toBe(404);
  });
});
