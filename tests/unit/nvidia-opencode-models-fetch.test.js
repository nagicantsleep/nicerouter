import { describe, it, expect } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";

describe("NVIDIA and OpenCode models discovery configuration", () => {
  it("has modelsFetcher and passthroughModels in nvidia registry", () => {
    const nvidia = REGISTRY.find((e) => e.id === "nvidia");
    expect(nvidia).toBeDefined();
    expect(nvidia.passthroughModels).toBe(true);
    expect(nvidia.modelsFetcher).toMatchObject({
      url: "https://integrate.api.nvidia.com/v1/models",
      type: "openai",
    });
  });

  it("has modelsFetcher and passthroughModels in opencode registry", () => {
    const opencode = REGISTRY.find((e) => e.id === "opencode");
    expect(opencode).toBeDefined();
    expect(opencode.passthroughModels).toBe(true);
    expect(opencode.modelsFetcher).toMatchObject({
      url: "https://opencode.ai/zen/v1/models",
      type: "opencode-free",
    });
  });

  it("filters suggested models with openai filter correctly", () => {
    expect(FILTERS.openai).toBeDefined();
    const raw = [
      { id: "01-ai/yi-large", object: "model" },
      { id: "deepseek-ai/deepseek-v4-flash-0731", name: "DeepSeek V4 Flash" },
    ];
    const filtered = FILTERS.openai(raw);
    expect(filtered).toEqual([
      { id: "01-ai/yi-large", name: "01-ai/yi-large" },
      { id: "deepseek-ai/deepseek-v4-flash-0731", name: "DeepSeek V4 Flash" },
    ]);
  });

  it("filters opencode-free models, keeping free ones and excluding dead ones", () => {
    expect(FILTERS["opencode-free"]).toBeDefined();
    const raw = [
      { id: "claude-opus-5" },
      { id: "gpt-5.5" },
      { id: "nemotron-3-ultra-free" },
      { id: "big-pickle" },
      { id: "deepseek-v4-flash-free" }, // dead model
    ];
    const filtered = FILTERS["opencode-free"](raw);
    const ids = filtered.map((m) => m.id);
    expect(ids).toContain("nemotron-3-ultra-free");
    expect(ids).toContain("big-pickle");
    expect(ids).not.toContain("claude-opus-5");
    expect(ids).not.toContain("gpt-5.5");
    expect(ids).not.toContain("deepseek-v4-flash-free");
  });
});
