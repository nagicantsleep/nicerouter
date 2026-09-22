import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/localDb", () => ({
  getSettings: vi.fn().mockResolvedValue({ requireApiKey: false, comboStrategy: "fallback" }),
  getComboByName: vi.fn().mockImplementation(async (name) => {
    if (name === "jev-latest" || name === "jev") {
      return {
        id: "combo-jev-latest",
        name,
        models: ["oc/jev-1.13-free", "typesafe/jev-latest"],
        isActive: true,
      };
    }
    return null;
  }),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn().mockReturnValue("test_key"),
  isValidApiKey: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
  default: vi.fn(),
}));

import { POST } from "../../src/app/api/v1/systemone/route.js";
import { getProviderCredentials } from "../../src/sse/services/auth.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

describe("/v1/systemone combo handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes combo 'jev-latest' to first model oc/jev-1.13-free when available", async () => {
    getProviderCredentials.mockResolvedValueOnce({
      connectionId: "conn-oc-1",
      apiKey: "public",
    });

    const mockOpenCodeData = {
      model: "jev-1.13-free",
      answers: {
        category: { type: "choice", choice: "billing", confidence: 0.98 },
      },
      usage: { input_tokens: 300, output_tokens: 30 },
    };

    proxyAwareFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(mockOpenCodeData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const request = new Request("http://localhost:20128/v1/systemone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "jev-latest",
        state: "Monthly subscription charge inquiry",
        questions: {
          category: { type: "choice", criteria: { billing: "billing", tech: "tech" } },
        },
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.answers.category.choice).toBe("billing");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetch.mock.calls[0][0]).toContain("/zen/v1/systemone");
  });

  it("falls back to typesafe/jev-latest when oc/jev-1.13-free returns 429 or 500", async () => {
    getProviderCredentials.mockImplementation(async (prov, excludeIds) => {
      if ((prov === "opencode" || prov === "oc") && !excludeIds?.has("conn-oc-1")) {
        return { connectionId: "conn-oc-1", apiKey: "public" };
      }
      if (prov === "typesafe" && !excludeIds?.has("conn-ts-1")) {
        return { connectionId: "conn-ts-1", apiKey: "sk-typesafe-valid" };
      }
      return null;
    });

    // 1st model: oc/jev-1.13-free fails with 429
    proxyAwareFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "rate limit" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      })
    );

    // 2nd model: typesafe/jev-latest succeeds
    const mockTypeSafeData = {
      model: "jev-1.13.0",
      answers: {
        category: { type: "choice", choice: "tech", confidence: 0.95 },
      },
      metadata: { version: "jev-1.13.0" },
    };
    proxyAwareFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(mockTypeSafeData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const request = new Request("http://localhost:20128/v1/systemone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "jev-latest",
        state: "System crash report",
        questions: {
          category: { type: "choice", criteria: { billing: "billing", tech: "tech" } },
        },
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.answers.category.choice).toBe("tech");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    // 1st call to opencode
    expect(proxyAwareFetch.mock.calls[0][0]).toContain("/zen/v1/systemone");
    // 2nd call to typesafe
    expect(proxyAwareFetch.mock.calls[1][0]).toContain("api.typesafe.ai/v1/systemone");
  });

  it("OpenCodeExecutor handles chat completions for jev-1.13-free cleanly", async () => {
    const executor = new OpenCodeExecutor();
    expect(executor.buildUrl("jev-1.13-free")).toContain("/zen/v1/systemone");

    const transformed = executor.transformRequest(
      "jev-1.13-free",
      {
        messages: [{ role: "user", content: "Is this request actionable?" }],
      },
      false,
      {}
    );

    expect(transformed.state).toContain("USER: Is this request actionable?");
    expect(transformed.questions).toBeDefined();
    expect(transformed.questions.decision).toBeDefined();
  });
});
