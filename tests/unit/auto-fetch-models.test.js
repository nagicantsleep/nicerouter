import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetCustomModels = vi.fn();
const mockDeleteCustomModel = vi.fn();
const mockGetProviderNodes = vi.fn().mockResolvedValue([]);
const mockGetProviderLiveModels = vi.fn();

vi.mock("../../src/lib/localDb.js", () => ({
  getCustomModels: (...args) => mockGetCustomModels(...args),
  deleteCustomModel: (...args) => mockDeleteCustomModel(...args),
  getProviderNodes: (...args) => mockGetProviderNodes(...args),
}));

vi.mock("../../src/shared/constants/providers.js", () => ({
  getProviderAlias: (id) => id,
}));

vi.mock("../../src/app/api/providers/[id]/models/route.js", () => ({
  getProviderLiveModels: (...args) => mockGetProviderLiveModels(...args),
}));

import {
  PRUNE_TARGET_PROVIDERS,
  DEFAULT_AUTO_PRUNE_INTERVAL_MS,
  startAutoPruneModels,
  stopAutoPruneModels,
  runAutoPruneModelsTick,
} from "../../src/shared/services/autoFetchModels.js";

describe("autoPruneModels service", () => {
  beforeEach(() => {
    stopAutoPruneModels();
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopAutoPruneModels();
    vi.clearAllMocks();
  });

  it("exports correct PRUNE_TARGET_PROVIDERS and default interval", () => {
    expect(DEFAULT_AUTO_PRUNE_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
    const targetIds = PRUNE_TARGET_PROVIDERS.map((t) => t.id);

    // Free tier & integrated providers are present
    expect(targetIds).toContain("poolside");
    expect(targetIds).toContain("openrouter");
    expect(targetIds).toContain("api-airforce");
    expect(targetIds).toContain("nvidia");
    expect(targetIds).toContain("opencode");
    expect(targetIds).toContain("cloudflare-ai");
    expect(targetIds).toContain("ramclouds");
    expect(targetIds).toContain("seekai");
    expect(targetIds).toContain("qoder");

    // Decolua Auth providers and original built-ins are NOT in background prune
    expect(targetIds).not.toContain("claude");
    expect(targetIds).not.toContain("codex");
    expect(targetIds).not.toContain("cursor");
    expect(targetIds).not.toContain("kiro");
    expect(targetIds).not.toContain("gemini");
    expect(targetIds).not.toContain("openai");
    expect(targetIds).not.toContain("deepseek");
    expect(targetIds).not.toContain("groq");
    expect(targetIds).not.toContain("xai");

    const openrouterTarget = PRUNE_TARGET_PROVIDERS.find((t) => t.id === "openrouter");
    expect(openrouterTarget?.freeOnly).toBe(true);
  });

  it("starts and stops idempotently without adding models", () => {
    const started1 = startAutoPruneModels({ intervalMs: 10000, initialDelayMs: 5000 });
    expect(started1).toBe(true);

    const started2 = startAutoPruneModels({ intervalMs: 10000, initialDelayMs: 5000 });
    expect(started2).toBe(false);

    stopAutoPruneModels();

    const started3 = startAutoPruneModels({ intervalMs: 10000, initialDelayMs: 5000 });
    expect(started3).toBe(true);
    stopAutoPruneModels();
  });

  it("prunes dead/unavailable models from customModels and keeps active ones", async () => {
    // Existing custom models in DB:
    // poolside: "active-poolside-model" (still live), "dead-poolside-model" (dropped upstream)
    // openrouter: "deepseek-r1:free" (still live :free), "paid-or-expired-model" (no longer free)
    mockGetCustomModels.mockResolvedValue([
      { providerAlias: "poolside", id: "active-poolside-model", type: "llm" },
      { providerAlias: "poolside", id: "dead-poolside-model", type: "llm" },
      { providerAlias: "openrouter", id: "deepseek-r1:free", type: "llm" },
      { providerAlias: "openrouter", id: "paid-or-expired-model", type: "llm" },
    ]);

    const deletedModels = [];
    mockDeleteCustomModel.mockImplementation(async ({ providerAlias, id, type }) => {
      deletedModels.push({ providerAlias, id, type });
      return true;
    });

    // Mock live resolver returning only active models
    mockGetProviderLiveModels.mockImplementation(async (providerId) => {
      if (providerId === "poolside") {
        return {
          provider: "poolside",
          models: [
            { id: "active-poolside-model", name: "Active Model" },
            { id: "some-new-upstream-model", name: "New Model" },
          ],
        };
      }
      if (providerId === "openrouter") {
        return {
          provider: "openrouter",
          models: [
            { id: "deepseek-r1:free", name: "DeepSeek R1 Free", pricing: { prompt: "0", completion: "0" } },
            // paid-or-expired-model does NOT have :free and is paid
            { id: "paid-or-expired-model", name: "Paid Model", pricing: { prompt: "0.01", completion: "0.02" } },
          ],
        };
      }
      return { models: [] };
    });

    const result = await runAutoPruneModelsTick();

    expect(result.scanned).toBeGreaterThan(0);
    expect(result.pruned).toBe(2);

    // dead-poolside-model should be pruned
    const prunedPoolside = deletedModels.find((m) => m.id === "dead-poolside-model");
    expect(prunedPoolside).toBeDefined();
    expect(prunedPoolside.providerAlias).toBe("poolside");

    // paid-or-expired-model on openrouter should be pruned because it is not :free
    const prunedOpenRouter = deletedModels.find((m) => m.id === "paid-or-expired-model");
    expect(prunedOpenRouter).toBeDefined();
    expect(prunedOpenRouter.providerAlias).toBe("openrouter");

    // active-poolside-model and deepseek-r1:free should NOT be pruned
    expect(deletedModels.find((m) => m.id === "active-poolside-model")).toBeUndefined();
    expect(deletedModels.find((m) => m.id === "deepseek-r1:free")).toBeUndefined();
  });
});
