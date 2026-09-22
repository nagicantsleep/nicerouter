import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
  default: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { resolveProviderAlias, parseModel } from "../../open-sse/services/model.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getOpenGatewayUsage } from "../../open-sse/services/usage/opengateway.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";

describe("OpenGateway (gitlawb) Provider Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const entry = REGISTRY.find((e) => e.id === "opengateway");

  it("is properly registered in the provider registry", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("freeTier");
    expect(entry.authType).toBe("apikey");
    expect(entry.alias).toBe("ogw");
    expect(entry.aliases).toContain("ogw");
    expect(entry.aliases).toContain("opengateway");
    expect(entry.aliases).toContain("gitlawb");
    expect(entry.aliases).toContain("gitlawb-opengateway");
    expect(entry.display.name).toBe("OpenGateway");
    expect(entry.transport.baseUrl).toBe("https://opengateway.gitlawb.com/v1/chat/completions");
    expect(entry.transport.validateUrl).toBe("https://opengateway.gitlawb.com/v1/models");
    expect(entry.passthroughModels).toBe(true);
    expect(entry.modelsFetcher).toMatchObject({
      url: "https://opengateway.gitlawb.com/v1/models",
      type: "openai",
    });
  });

  it("includes free Nemotron 3 Ultra in models catalog", () => {
    const models = PROVIDER_MODELS.opengateway || [];
    const freeModels = models.filter((m) => m.isFree);
    const freeIds = freeModels.map((m) => m.id);
    expect(freeIds).toContain("nvidia/nemotron-3-ultra-550b-a55b:free");

    const nemotron = models.find((m) => m.id === "nvidia/nemotron-3-ultra-550b-a55b:free");
    expect(nemotron).toBeDefined();
    expect(nemotron.isFree).toBe(true);
  });

  it("includes other gateway catalog models", () => {
    const models = PROVIDER_MODELS.opengateway || [];
    const ids = models.map((m) => m.id);
    expect(ids).toContain("xiaomi/mimo-v2.5-pro");
    expect(ids).toContain("xiaomi/mimo-v2.5");
    expect(ids).toContain("auto");
    expect(ids).toContain("google/gemini-3.1-flash-lite");
    expect(ids).toContain("minimax/minimax-m3");
    expect(ids).toContain("qwen/qwen3.7-max");
    expect(ids).toContain("moonshotai/kimi-k3");
    expect(ids).toContain("z-ai/glm-5.2");
  });

  it("builds into PROVIDERS runtime config", () => {
    expect(PROVIDERS.opengateway).toBeDefined();
    expect(PROVIDERS.opengateway.baseUrl).toBe("https://opengateway.gitlawb.com/v1/chat/completions");
    expect(PROVIDERS.opengateway.format).toBe("openai");

    expect(PROVIDERS.ogw).toBeDefined();
    expect(PROVIDERS.ogw.baseUrl).toBe("https://opengateway.gitlawb.com/v1/chat/completions");
  });

  it("resolves provider aliases correctly", () => {
    expect(resolveProviderAlias("opengateway")).toBe("opengateway");
    expect(resolveProviderAlias("ogw")).toBe("opengateway");
    expect(resolveProviderAlias("gitlawb")).toBe("opengateway");
    expect(resolveProviderAlias("gitlawb-opengateway")).toBe("opengateway");
  });

  it("parses model strings with aliases", () => {
    const p1 = parseModel("opengateway/nvidia/nemotron-3-ultra-550b-a55b:free");
    expect(p1.provider).toBe("opengateway");
    expect(p1.model).toBe("nvidia/nemotron-3-ultra-550b-a55b:free");

    const p2 = parseModel("ogw/auto");
    expect(p2.provider).toBe("opengateway");
    expect(p2.model).toBe("auto");

    const p3 = parseModel("gitlawb/xiaomi/mimo-v2.5-pro");
    expect(p3.provider).toBe("opengateway");
    expect(p3.model).toBe("xiaomi/mimo-v2.5-pro");
  });

  it("DefaultExecutor builds correct URL and headers", () => {
    const ex = new DefaultExecutor("opengateway");
    const headers = ex.buildHeaders({ apiKey: "ogw_live_sample123" });
    expect(headers.Authorization).toBe("Bearer ogw_live_sample123");
    expect(ex.buildUrl("nvidia/nemotron-3-ultra-550b-a55b:free", false)).toBe("https://opengateway.gitlawb.com/v1/chat/completions");

    const aliasEx = new DefaultExecutor("ogw");
    expect(aliasEx.buildUrl("auto", true)).toBe("https://opengateway.gitlawb.com/v1/chat/completions");
  });

  it("fetches usage and handles missing/invalid key", async () => {
    const noKey = await getOpenGatewayUsage(null);
    expect(noKey.message).toContain("API key not available");

    proxyAwareFetch.mockResolvedValueOnce({ status: 401, ok: false });
    proxyAwareFetch.mockResolvedValueOnce({ status: 401, ok: false });
    const invalidKey = await getOpenGatewayUsage("ogw_live_invalid");
    expect(invalidKey.message).toContain("invalid or expired");
  });

  it("fetches credits and formats quotas correctly", async () => {
    proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        balance_usd: "9.50",
        total_spent_usd: "0.50",
      }),
    });
    proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        requests: 120,
      }),
    });

    const usage = await getOpenGatewayUsage("ogw_live_valid123");
    expect(usage.plan).toContain("OpenGateway");
    expect(usage.quotas["Credit Balance ($)"]).toBeDefined();
    expect(usage.quotas["Credit Balance ($)"].used).toBe(0.5);
    expect(usage.quotas["Credit Balance ($)"].total).toBe(10);
    expect(usage.quotas["Credit Balance ($)"].remainingPercentage).toBe(95);
    expect(usage.quotas["Nemotron 3 Ultra (Free)"]).toBeDefined();
  });

  it("is wired into getUsageForProvider dispatcher", async () => {
    proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ balance_usd: 5.0, total_spent_usd: 1.0 }),
    });
    proxyAwareFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const res = await getUsageForProvider({
      provider: "opengateway",
      apiKey: "ogw_live_test",
    });
    expect(res.plan).toContain("OpenGateway");
    expect(res.quotas["Credit Balance ($)"]).toBeDefined();
  });
});
