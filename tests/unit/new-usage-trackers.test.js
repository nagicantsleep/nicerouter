import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import {
  USAGE_SUPPORTED_PROVIDERS,
  USAGE_APIKEY_PROVIDERS,
} from "../../src/shared/constants/providers.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("new usage trackers registry flags", () => {
  const newProviders = [
    "openrouter",
    "stability-ai",
    "firecrawl",
    "tavily",
    "tokenrouter",
    "wusrouter",
    "elevenlabs",
  ];

  for (const p of newProviders) {
    it(`registers ${p} in USAGE_SUPPORTED_PROVIDERS and USAGE_APIKEY_PROVIDERS`, () => {
      expect(USAGE_SUPPORTED_PROVIDERS).toContain(p);
      expect(USAGE_APIKEY_PROVIDERS).toContain(p);
    });
  }
});

describe("new usage handlers dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles OpenRouter usage successfully", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: { total_credits: 10, total_usage: 1.5 },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            label: "test-key",
            free_model_daily_requests: { used: 10, limit: 1000, remaining: 990 },
          },
        })
      );

    const res = await getUsageForProvider({
      provider: "openrouter",
      apiKey: "sk-or-test",
    });

    expect(res.plan).toBe("OpenRouter (test-key)");
    expect(res.quotas["Credit Balance ($)"]).toBeDefined();
    expect(res.quotas["Credit Balance ($)"].total).toBe(10);
    expect(res.quotas["Credit Balance ($)"].used).toBe(1.5);
    expect(res.quotas["Credit Balance ($)"].remainingPercentage).toBe(85);
    expect(res.quotas["Free Daily Requests"].remainingPercentage).toBe(99);
  });

  it("handles Stability AI balance successfully", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ credits: 500 }));

    const res = await getUsageForProvider({
      provider: "stability-ai",
      apiKey: "sk-stability-test",
    });

    expect(res.plan).toBe("Stability AI");
    expect(res.quotas.Credits.total).toBe(500);
    expect(res.quotas.Credits.isCreditBalance).toBe(true);
  });

  it("handles Firecrawl credit usage successfully", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          remaining_credits: 800,
          plan_credits: 1000,
          billing_period_end: "2026-10-01T00:00:00.000Z",
        },
      })
    );

    const res = await getUsageForProvider({
      provider: "firecrawl",
      apiKey: "fc-test",
    });

    expect(res.plan).toBe("Firecrawl");
    expect(res.quotas.Credits.total).toBe(1000);
    expect(res.quotas.Credits.used).toBe(200);
    expect(res.quotas.Credits.remainingPercentage).toBe(80);
    expect(res.quotas.Credits.resetAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("handles Tavily usage successfully", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        account: {
          current_plan: "Researcher",
          plan_usage: 150,
          plan_limit: 1000,
        },
      })
    );

    const res = await getUsageForProvider({
      provider: "tavily",
      apiKey: "tvly-test",
    });

    expect(res.plan).toBe("Tavily (Researcher)");
    expect(res.quotas["Monthly Searches"].total).toBe(1000);
    expect(res.quotas["Monthly Searches"].used).toBe(150);
    expect(res.quotas["Monthly Searches"].remainingPercentage).toBe(85);
  });

  it("handles TokenRouter billing usage successfully", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(
        jsonResponse({
          object: "billing_subscription",
          hard_limit_usd: 100,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          total_usage: 25.5,
        })
      );

    const res = await getUsageForProvider({
      provider: "tokenrouter",
      apiKey: "sk-tr-test",
    });

    expect(res.plan).toBe("TokenRouter");
    expect(res.quotas["Quota ($)"]).toBeDefined();
    expect(res.quotas["Quota ($)"].total).toBe(100);
    expect(res.quotas["Quota ($)"].used).toBe(25.5);
    expect(res.quotas["Quota ($)"].remainingPercentage).toBe(74.5);
  });

  it("handles ElevenLabs usage successfully", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        tier: "creator",
        character_count: 5000,
        character_limit: 100000,
        next_character_count_reset_unix: 1789748000,
      })
    );

    const res = await getUsageForProvider({
      provider: "elevenlabs",
      apiKey: "xi-test",
    });

    expect(res.plan).toBe("ElevenLabs (Creator)");
    expect(res.quotas.Characters.total).toBe(100000);
    expect(res.quotas.Characters.used).toBe(5000);
    expect(res.quotas.Characters.remainingPercentage).toBe(95);
  });
});
