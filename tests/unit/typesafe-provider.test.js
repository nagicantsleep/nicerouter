import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
  default: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { resolveProviderAlias, parseModel, getModelInfoCore } from "../../open-sse/services/model.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { TypeSafeExecutor } from "../../open-sse/executors/typesafe.js";

describe("TypeSafe AI (Jev) Provider Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const entry = REGISTRY.find((e) => e.id === "typesafe");

  it("is properly registered in the provider registry", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.authType).toBe("apikey");
    expect(entry.alias).toBe("typesafe");
    expect(entry.aliases).toContain("typesafe-ai");
    expect(entry.aliases).toContain("typesage");
    expect(entry.aliases).toContain("typesage-ai");
    expect(entry.aliases).toContain("ts");
    expect(entry.display.name).toBe("TypeSafe AI");
    expect(entry.transport.baseUrl).toBe("https://api.typesafe.ai/v1/systemone");
    expect(entry.passthroughModels).toBe(true);
  });

  it("has seed models registered in PROVIDER_MODELS", () => {
    const models = PROVIDER_MODELS.typesafe || [];
    const ids = models.map((m) => m.id);
    expect(ids).toContain("jev-latest");
    expect(ids).toContain("jev-1.13.0");
    expect(ids).toContain("jev-1.12.0");
  });

  it("builds into PROVIDERS runtime config", () => {
    expect(PROVIDERS.typesafe).toBeDefined();
    expect(PROVIDERS.typesafe.baseUrl).toBe("https://api.typesafe.ai/v1/systemone");
    expect(PROVIDERS.typesafe.format).toBe("openai");
  });

  it("resolves provider aliases correctly including typo variations", () => {
    expect(resolveProviderAlias("typesafe")).toBe("typesafe");
    expect(resolveProviderAlias("typesafe-ai")).toBe("typesafe");
    expect(resolveProviderAlias("typesage")).toBe("typesafe");
    expect(resolveProviderAlias("typesage-ai")).toBe("typesafe");
    expect(resolveProviderAlias("ts")).toBe("typesafe");
  });

  it("parses model strings with aliases", () => {
    const p1 = parseModel("typesafe/jev-latest");
    expect(p1.provider).toBe("typesafe");
    expect(p1.model).toBe("jev-latest");

    const p2 = parseModel("typesage/jev-latest");
    expect(p2.provider).toBe("typesafe");
    expect(p2.model).toBe("jev-latest");

    const p3 = parseModel("ts/jev-1.13.0");
    expect(p3.provider).toBe("typesafe");
    expect(p3.model).toBe("jev-1.13.0");
  });

  it("infers provider from bare jev-* model names without prefix", async () => {
    const info1 = await getModelInfoCore("jev-latest", {});
    expect(info1.provider).toBe("typesafe");
    expect(info1.model).toBe("jev-latest");

    const info2 = await getModelInfoCore("jev-1.13.0", {});
    expect(info2.provider).toBe("typesafe");
    expect(info2.model).toBe("jev-1.13.0");
  });

  it("resolves correct pricing for jev models ($0.042/1M input, $0 output)", () => {
    const pLatest = getPricingForModel("typesafe", "jev-latest");
    expect(pLatest).toBeDefined();
    expect(pLatest.input).toBe(0.042);
    expect(pLatest.output).toBe(0.00);

    const pVersion = getPricingForModel("typesafe", "jev-1.13.0");
    expect(pVersion).toBeDefined();
    expect(pVersion.input).toBe(0.042);
    expect(pVersion.output).toBe(0.00);

    const pPattern = getPricingForModel("typesafe", "jev-any-future-version");
    expect(pPattern).toBeDefined();
    expect(pPattern.input).toBe(0.042);
    expect(pPattern.output).toBe(0.00);
  });

  it("registers TypeSafeExecutor for typesafe, typesage and aliases", () => {
    const exec1 = getExecutor("typesafe");
    expect(exec1).toBeInstanceOf(TypeSafeExecutor);

    const exec2 = getExecutor("typesage");
    expect(exec2).toBeInstanceOf(TypeSafeExecutor);

    const exec3 = getExecutor("ts");
    expect(exec3).toBeInstanceOf(TypeSafeExecutor);
  });

  describe("TypeSafeExecutor transformations", () => {
    const executor = new TypeSafeExecutor();

    it("passes through state and questions if already provided", () => {
      const body = {
        state: "Order ID 12345 failed",
        questions: {
          category: { type: "choice", criteria: { billing: "billing issue", tech: "tech issue" } }
        }
      };
      const transformed = executor.transformRequest("jev-latest", body, false, {});
      expect(transformed.state).toBe("Order ID 12345 failed");
      expect(transformed.questions).toEqual(body.questions);
      expect(transformed.model).toBe("jev-latest");
    });

    it("transforms OpenAI messages into state and default decision questions", () => {
      const body = {
        messages: [
          { role: "system", content: "You are a customer support triage agent." },
          { role: "user", content: "I cannot login to my account." },
        ]
      };
      const transformed = executor.transformRequest("jev-latest", body, false, {});
      expect(transformed.state).toContain("SYSTEM: You are a customer support triage agent.");
      expect(transformed.state).toContain("USER: I cannot login to my account.");
      expect(transformed.questions.decision).toBeDefined();
      expect(transformed.questions.decision.type).toBe("choice");
    });

    it("derives choice questions from tool definitions when tools are provided", () => {
      const body = {
        messages: [{ role: "user", content: "Check weather in Tokyo" }],
        tools: [
          { type: "function", function: { name: "get_weather", description: "Get weather details" } },
          { type: "function", function: { name: "search_flight", description: "Search flights" } }
        ]
      };
      const transformed = executor.transformRequest("jev-latest", body, false, {});
      expect(transformed.questions.tool_selection).toBeDefined();
      expect(transformed.questions.tool_selection.type).toBe("choice");
      expect(transformed.questions.tool_selection.criteria.get_weather).toBe("Get weather details");
      expect(transformed.questions.tool_selection.criteria.search_flight).toBe("Search flights");
      expect(transformed.questions.tool_selection.criteria.none).toBeDefined();
    });

    it("executes non-streaming call and converts to OpenAI completion format", async () => {
      const mockAnswers = {
        department: { type: "choice", value: "billing", confidence: 0.98 },
        is_urgent: { type: "noul", value: true, confidence: 0.95 }
      };

      const mockResponse = new Response(JSON.stringify({
        answers: mockAnswers,
        metadata: { version: "jev-1.13.0", input_tokens: 15, output_tokens: 0 }
      }), { status: 200, headers: { "Content-Type": "application/json" } });

      proxyAwareFetch.mockResolvedValueOnce(mockResponse);

      const result = await executor.execute({
        model: "jev-latest",
        body: { messages: [{ role: "user", content: "My invoice is wrong" }] },
        stream: false,
        credentials: { apiKey: "ts_test_key" }
      });

      expect(result.response.ok).toBe(true);
      expect(result.responseFormat).toBe("openai");

      const completion = await result.response.json();
      expect(completion.object).toBe("chat.completion");
      expect(completion.choices[0].message.role).toBe("assistant");
      const contentObj = JSON.parse(completion.choices[0].message.content);
      expect(contentObj.department.value).toBe("billing");
      expect(completion.usage.prompt_tokens).toBe(15);
    });

    it("executes streaming call and returns valid OpenAI SSE stream", async () => {
      const mockAnswers = {
        outcome: { type: "choice", value: "approved", confidence: 0.99 }
      };

      const mockResponse = new Response(JSON.stringify({
        answers: mockAnswers,
        metadata: { version: "jev-1.13.0" }
      }), { status: 200, headers: { "Content-Type": "application/json" } });

      proxyAwareFetch.mockResolvedValueOnce(mockResponse);

      const result = await executor.execute({
        model: "jev-latest",
        body: { messages: [{ role: "user", content: "Approve transaction #42" }] },
        stream: true,
        credentials: { apiKey: "ts_test_key" }
      });

      expect(result.response.ok).toBe(true);
      expect(result.response.headers.get("Content-Type")).toBe("text/event-stream");

      const text = await result.response.text();
      expect(text).toContain("data: {");
      expect(text).toContain("chat.completion.chunk");
      expect(text).toContain("approved");
      expect(text).toContain("data: [DONE]");
    });
  });
});
