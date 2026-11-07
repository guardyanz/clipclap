import { afterEach, describe, expect, it, vi } from "vitest";

async function loadShouldTrack(env: { HYPERFRAMES_NO_TELEMETRY?: string; DO_NOT_TRACK?: string }) {
  vi.resetModules();
  vi.doMock("../utils/env.js", () => ({ isDevMode: () => false }));
  vi.doMock("./config.js", () => ({
    readConfig: () => ({ telemetryEnabled: true }),
    writeConfig: () => true,
  }));
  // This build ships with no PostHog key configured (telemetry disabled by
  // default — see transport.ts), which would make every policy test here
  // false regardless of config/env. Stub a fake-but-valid-looking key so
  // this test exercises the config/env override logic in isolation.
  vi.doMock("./transport.js", () => ({
    POSTHOG_API_KEY: "phc_test",
    enqueue: () => {},
    flush: async () => {},
    flushSync: () => {},
  }));
  vi.stubEnv("HYPERFRAMES_NO_TELEMETRY", env.HYPERFRAMES_NO_TELEMETRY ?? "");
  vi.stubEnv("DO_NOT_TRACK", env.DO_NOT_TRACK ?? "");
  return (await import("./client.js")).shouldTrack;
}

describe("telemetry client policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("../utils/env.js");
    vi.doUnmock("./config.js");
    vi.doUnmock("./transport.js");
    vi.resetModules();
  });

  it.each([
    ["HYPERFRAMES_NO_TELEMETRY", "true"],
    ["HYPERFRAMES_NO_TELEMETRY", " yes "],
    ["DO_NOT_TRACK", "TRUE"],
    ["DO_NOT_TRACK", "on"],
  ] as const)("does not track when %s=%j", async (name, value) => {
    const shouldTrack = await loadShouldTrack({ [name]: value });
    expect(shouldTrack()).toBe(false);
  });

  it("tracks when the config is enabled and no runtime override applies", async () => {
    const shouldTrack = await loadShouldTrack({});
    expect(shouldTrack()).toBe(true);
  });
});
