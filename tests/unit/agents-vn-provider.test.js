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
import { getUsageForProvider } from "../../open-sse/services/usage.js";

describe("Agents AI VN Provider Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const entry = REGISTRY.find((e) => e.id === "agents-vn");

  it("is properly registered in the provider registry", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("freeTier");
    expect(entry.authType).toBe("apikey");
    expect(entry.alias).toBe("avn");
    expect(entry.aliases).toContain("avn");
    expect(entry.aliases).toContain("agents-vn");
    expect(entry.aliases).toContain("agents-ai-vn");
    expect(entry.aliases).toContain("agents.ai.vn");
    expect(entry.display.name).toBe("Agents AI VN");
    expect(entry.display.website).toBe("https://gateway.agents.ai.vn");
    expect(entry.display.notice.text).toContain("sk-D8Kyao8gBBweVR7pKqafi1bxuH5DaPfFc7GzTPmHvdcqaZP0");
    expect(entry.transport.baseUrl).toBe("https://gateway.agents.ai.vn/v1/chat/completions");
    expect(entry.transport.validateUrl).toBe("https://gateway.agents.ai.vn/v1/models");
    expect(entry.passthroughModels).toBe(true);
    expect(entry.modelsFetcher).toMatchObject({
      url: "https://gateway.agents.ai.vn/v1/models",
      type: "openai",
    });
  });

  it("has seed models registered in PROVIDER_MODELS", () => {
    const models = PROVIDER_MODELS["agents-vn"] || [];
    const ids = models.map((m) => m.id);
    expect(ids).toContain("muse-spark-1.3");
    expect(ids).toContain("muse-spark-1.2");
  });

  it("builds into PROVIDERS runtime config", () => {
    expect(PROVIDERS["agents-vn"]).toBeDefined();
    expect(PROVIDERS["agents-vn"].baseUrl).toBe("https://gateway.agents.ai.vn/v1/chat/completions");
    expect(PROVIDERS["agents-vn"].format).toBe("openai");

    expect(PROVIDERS.avn).toBeDefined();
    expect(PROVIDERS.avn.baseUrl).toBe("https://gateway.agents.ai.vn/v1/chat/completions");
  });

  it("resolves provider aliases correctly", () => {
    expect(resolveProviderAlias("agents-vn")).toBe("agents-vn");
    expect(resolveProviderAlias("avn")).toBe("agents-vn");
    expect(resolveProviderAlias("agents-ai-vn")).toBe("agents-vn");
    expect(resolveProviderAlias("agents.ai.vn")).toBe("agents-vn");
  });

  it("parses model strings with aliases", () => {
    const p1 = parseModel("agents-vn/muse-spark-1.3");
    expect(p1.provider).toBe("agents-vn");
    expect(p1.model).toBe("muse-spark-1.3");

    const p2 = parseModel("avn/muse-spark-1.2");
    expect(p2.provider).toBe("agents-vn");
    expect(p2.model).toBe("muse-spark-1.2");

    const p3 = parseModel("agents.ai.vn/muse-spark-1.3");
    expect(p3.provider).toBe("agents-vn");
    expect(p3.model).toBe("muse-spark-1.3");
  });

  it("DefaultExecutor builds correct URL and headers", () => {
    const ex = new DefaultExecutor("agents-vn");
    const headers = ex.buildHeaders({ apiKey: "sk-D8Kyao8gBBweVR7pKqafi1bxuH5DaPfFc7GzTPmHvdcqaZP0" });
    expect(headers.Authorization).toBe("Bearer sk-D8Kyao8gBBweVR7pKqafi1bxuH5DaPfFc7GzTPmHvdcqaZP0");
    expect(ex.buildUrl("muse-spark-1.3", false)).toBe("https://gateway.agents.ai.vn/v1/chat/completions");

    const aliasEx = new DefaultExecutor("avn");
    expect(aliasEx.buildUrl("muse-spark-1.2", true)).toBe("https://gateway.agents.ai.vn/v1/chat/completions");
  });

  it("is wired into getUsageForProvider dispatcher", async () => {
    proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        object: "billing_subscription",
        hard_limit_usd: 100000000,
      }),
    });
    proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        total_usage: 920.0004,
      }),
    });

    const res = await getUsageForProvider({
      provider: "agents-vn",
      apiKey: "sk-D8Kyao8gBBweVR7pKqafi1bxuH5DaPfFc7GzTPmHvdcqaZP0",
    });
    expect(res.plan).toBe("Agents AI VN");
    expect(res.quotas["Total Usage ($)"]).toBeDefined();
    expect(res.quotas["Total Usage ($)"].used).toBe(920.0004);
  });
});
