import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/localDb", () => ({
  getSettings: vi.fn().mockResolvedValue({ requireApiKey: false }),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn().mockReturnValue("test_bearer_key"),
  isValidApiKey: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
  default: vi.fn(),
}));

import { POST, OPTIONS } from "../../src/app/api/v1/systemone/route.js";
import { getProviderCredentials } from "../../src/sse/services/auth.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

describe("/v1/systemone endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles OPTIONS preflight request", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("proxies valid request to TypeSafe AI and returns JSON response", async () => {
    getProviderCredentials.mockResolvedValueOnce({
      connectionId: "conn-ts-1",
      apiKey: "sk-typesafe-secret",
    });

    const mockUpstreamData = {
      answers: {
        category: { type: "choice", value: "billing", confidence: 0.99 },
      },
      metadata: { version: "jev-1.13.0" },
    };

    proxyAwareFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(mockUpstreamData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const request = new Request("http://localhost:20128/v1/systemone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "jev-latest",
        state: "Issue with monthly invoice",
        questions: {
          category: { type: "choice", criteria: { billing: "billing", tech: "tech" } },
        },
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.answers.category.value).toBe("billing");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-typesafe-secret");
  });

  it("returns 404 when no provider credentials exist", async () => {
    getProviderCredentials.mockResolvedValueOnce(null);

    const request = new Request("http://localhost:20128/v1/systemone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "jev-latest",
        state: "Test",
        questions: {},
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(404);
  });
});
