// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RenderQueue } from "./RenderQueue";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mountRenderQueue(onStartRender: ReturnType<typeof vi.fn>) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <RenderQueue
        jobs={[]}
        projectId="demo"
        onDelete={vi.fn()}
        onClearCompleted={vi.fn()}
        onStartRender={onStartRender}
        isRendering={false}
        compositionDimensions={{ width: 1920, height: 1080 }}
      />,
    );
  });
  return host;
}

describe("RenderQueue resolution submission", () => {
  it("submits the canonical landscape 4K preset selected by the user", () => {
    const onStartRender = vi.fn();
    const host = mountRenderQueue(onStartRender);
    const resolutionSelect = [...host.querySelectorAll("select")].find((select) =>
      [...select.options].some((option) => option.textContent?.startsWith("4K")),
    );
    if (!resolutionSelect) throw new Error("resolution selector did not render");

    act(() => {
      resolutionSelect.value = "4k";
      resolutionSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const exportButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Export",
    );
    if (!exportButton) throw new Error("export button did not render");
    act(() => {
      exportButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onStartRender).toHaveBeenCalledWith("mp4", "standard", "landscape-4k", 30, undefined);
  });
});

describe("RenderQueue orientation override", () => {
  function findSelectByOption(host: HTMLElement, optionText: string): HTMLSelectElement {
    const select = [...host.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.textContent === optionText),
    );
    if (!select) throw new Error(`select containing option "${optionText}" did not render`);
    return select;
  }

  function clickExport(host: HTMLElement): void {
    const exportButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Export",
    );
    if (!exportButton) throw new Error("export button did not render");
    act(() => {
      exportButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("sends no outputShape when orientation stays Auto on a landscape composition", () => {
    const onStartRender = vi.fn();
    const host = mountRenderQueue(onStartRender);
    clickExport(host);
    expect(onStartRender).toHaveBeenCalledWith("mp4", "standard", "auto", 30, undefined);
  });

  it("sends the portrait outputShape when the user picks Portrait on a landscape composition", () => {
    const onStartRender = vi.fn();
    const host = mountRenderQueue(onStartRender);
    const orientationSelect = findSelectByOption(host, "Portrait");

    act(() => {
      orientationSelect.value = "portrait";
      orientationSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    clickExport(host);

    expect(onStartRender).toHaveBeenCalledWith("mp4", "standard", "auto", 30, {
      width: 1080,
      height: 1920,
    });
  });

  it("omits outputShape when the chosen orientation already matches the composition", () => {
    // compositionDimensions is 1920x1080 (landscape) — picking Landscape
    // explicitly should be a no-op reshape, not a redundant outputShape.
    const onStartRender = vi.fn();
    const host = mountRenderQueue(onStartRender);
    const orientationSelect = findSelectByOption(host, "Landscape");

    act(() => {
      orientationSelect.value = "landscape";
      orientationSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    clickExport(host);

    expect(onStartRender).toHaveBeenCalledWith("mp4", "standard", "auto", 30, undefined);
  });

  it("resolves the 4K preset against the chosen orientation, not the authored one", () => {
    // 1920x1080 authored, Portrait override + 4K scale must resolve to
    // portrait-4k (the reshaped base), not a landscape preset.
    const onStartRender = vi.fn();
    const host = mountRenderQueue(onStartRender);
    const orientationSelect = findSelectByOption(host, "Portrait");
    act(() => {
      orientationSelect.value = "portrait";
      orientationSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const resolutionSelect = [...host.querySelectorAll("select")].find((select) =>
      [...select.options].some((option) => option.textContent?.startsWith("4K")),
    );
    if (!resolutionSelect) throw new Error("resolution selector did not render");
    act(() => {
      resolutionSelect.value = "4k";
      resolutionSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    clickExport(host);

    expect(onStartRender).toHaveBeenCalledWith("mp4", "standard", "portrait-4k", 30, {
      width: 1080,
      height: 1920,
    });
  });
});
