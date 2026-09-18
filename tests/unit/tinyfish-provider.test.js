import { afterEach, describe, expect, it, vi } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { buildSearchRequest } from "../../open-sse/handlers/search/callers.js";
import { normalizeSearchResponse } from "../../open-sse/handlers/search/normalizers.js";
import { handleFetchCore } from "../../open-sse/handlers/fetch/index.js";
import { AI_PROVIDERS, getProvidersByKind } from "@/shared/constants/providers.js";

const CONFIG = {
  id: "tinyfish",
  baseUrl: "https://api.search.tinyfish.ai",
  method: "GET",
  authType: "apikey",
  authHeader: "x-api-key",
  searchTypes: ["web"],
  defaultMaxResults: 10,
  maxMaxResults: 50,
};

const SEARCH_PARAMS = {
  query: "artificial intelligence agent infrastructure",
  searchType: "web",
  maxResults: 10,
  token: "tf_test_key_123",
  country: "US",
  language: "en",
  domainFilter: ["example.com", "-spam.com"],
};

const SEARCH_RESPONSE = {
  query: "artificial intelligence agent infrastructure",
  results: [
    {
      position: 1,
      site_name: "tinyfish.ai",
      title: "TinyFish — Web Infrastructure for AI Agents",
      snippet: "Real-time web search and page fetch API optimized for LLM agents.",
      url: "https://tinyfish.ai",
      date: "2026-09-01T00:00:00Z",
    },
    {
      position: 2,
      site_name: "example.com",
      title: "AI Agents Overview",
      snippet: "An introduction to AI agent architectures.",
      url: "https://example.com/ai",
    },
  ],
  total_results: 42,
  page: 0,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TinyFish search and fetch provider", () => {
  it("registers tinyfish in registry and AI_PROVIDERS for both webSearch and webFetch", () => {
    const entry = REGISTRY.find((candidate) => candidate.id === "tinyfish");

    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      id: "tinyfish",
      alias: "tinyfish",
      category: "apikey",
      authType: "apikey",
      serviceKinds: ["webSearch", "webFetch"],
      searchConfig: {
        baseUrl: "https://api.search.tinyfish.ai",
        method: "GET",
        authType: "apikey",
        authHeader: "x-api-key",
        costPerQuery: 0,
      },
      fetchConfig: {
        baseUrl: "https://api.fetch.tinyfish.ai",
        method: "POST",
        authType: "apikey",
        authHeader: "x-api-key",
        costPerQuery: 0,
      },
    });

    expect(AI_PROVIDERS.tinyfish?.searchConfig).toEqual(entry.searchConfig);
    expect(AI_PROVIDERS.tinyfish?.fetchConfig).toEqual(entry.fetchConfig);
    expect(getProvidersByKind("webSearch").map((p) => p.id)).toContain("tinyfish");
    expect(getProvidersByKind("webFetch").map((p) => p.id)).toContain("tinyfish");
  });

  it("builds GET search request with X-API-Key header and search parameters", () => {
    const request = buildSearchRequest(CONFIG, SEARCH_PARAMS);
    const url = new URL(request.url);

    expect(url.origin + url.pathname).toBe("https://api.search.tinyfish.ai/");
    expect(url.searchParams.get("query")).toBe("artificial intelligence agent infrastructure");
    expect(url.searchParams.get("location")).toBe("US");
    expect(url.searchParams.get("language")).toBe("en");
    expect(url.searchParams.get("include_domains")).toBe("example.com");
    expect(url.searchParams.get("exclude_domains")).toBe("spam.com");
    expect(url.search).not.toContain("tf_test_key_123");

    expect(request.init).toEqual({
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-API-Key": "tf_test_key_123",
      },
    });
  });

  it("throws an error if API key is missing when building request", () => {
    expect(() => buildSearchRequest(CONFIG, { ...SEARCH_PARAMS, token: "" })).toThrow(
      "TinyFish requires an API key"
    );
  });

  it("normalizes TinyFish search responses into unified SearchResult shape", () => {
    const normalized = normalizeSearchResponse("tinyfish", SEARCH_RESPONSE, SEARCH_PARAMS.query, "web");

    expect(normalized.totalResults).toBe(42);
    expect(normalized.results).toHaveLength(2);
    expect(normalized.results[0]).toMatchObject({
      title: "TinyFish — Web Infrastructure for AI Agents",
      url: "https://tinyfish.ai",
      display_url: "tinyfish.ai",
      snippet: "Real-time web search and page fetch API optimized for LLM agents.",
      position: 1,
      published_at: "2026-09-01T00:00:00Z",
      citation: { provider: "tinyfish", rank: 1 },
    });
    expect(normalized.results[1]).toMatchObject({
      title: "AI Agents Overview",
      url: "https://example.com/ai",
      position: 2,
    });
  });

  it("handles webFetch via handleFetchCore for tinyfish", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        results: [
          {
            url: "https://tinyfish.ai",
            final_url: "https://tinyfish.ai/docs",
            title: "TinyFish Documentation",
            description: "Documentation for TinyFish APIs",
            format: "markdown",
            text: "# TinyFish APIs\n\nSearch and Fetch documentation.",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleFetchCore({
      url: "https://tinyfish.ai",
      format: "markdown",
      provider: "tinyfish",
      providerConfig: { costPerQuery: 0 },
      credentials: { apiKey: "tf_live_key" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.fetch.tinyfish.ai",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-api-key": "tf_live_key",
        }),
        body: JSON.stringify({ urls: ["https://tinyfish.ai"], format: "markdown" }),
      })
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      provider: "tinyfish",
      url: "https://tinyfish.ai/docs",
      title: "TinyFish Documentation",
      content: {
        format: "markdown",
        text: "# TinyFish APIs\n\nSearch and Fetch documentation.",
      },
      usage: { fetch_cost_usd: 0 },
    });
  });
});
