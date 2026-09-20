import { describe, it, expect } from "vitest";
import {
  tokenizeQuery,
  normalizeForSearch,
  matchModelKeywords,
  calculateModelRelevance,
  sortModelsByRelevance,
} from "../../src/shared/utils/modelSearch.js";

describe("modelSearch utility", () => {
  describe("tokenizeQuery", () => {
    it("splits query by spaces and removes empty tokens", () => {
      expect(tokenizeQuery("  nemotron   3   ultra ")).toEqual(["nemotron", "3", "ultra"]);
      expect(tokenizeQuery("")).toEqual([]);
      expect(tokenizeQuery(null)).toEqual([]);
    });
  });

  describe("normalizeForSearch", () => {
    it("returns raw, spaced, and compact forms", () => {
      const res = normalizeForSearch("glm-5.3-flash");
      expect(res.raw).toBe("glm-5.3-flash");
      expect(res.spaced).toBe("glm 5 3 flash");
      expect(res.compact).toBe("glm53flash");
    });
  });

  describe("matchModelKeywords", () => {
    it("matches multi-token keywords out of order or with gaps (nemotron ultra -> nemotron-3-ultra)", () => {
      const model = {
        id: "nemotron-3-ultra-550b",
        name: "Nemotron 3 Ultra 550B",
        value: "nvidia/nemotron-3-ultra-550b",
      };
      expect(matchModelKeywords(model, "nemotron ultra")).toBe(true);
      expect(matchModelKeywords(model, "ultra nemotron")).toBe(true);
      expect(matchModelKeywords(model, "nemotron 3 ultra")).toBe(true);
      expect(matchModelKeywords(model, "550b ultra")).toBe(true);
      expect(matchModelKeywords(model, "nemotron llama")).toBe(false);
    });

    it("matches regardless of dashes, dots, or spaces (glm 5-3 flash / glm 5.3 flash / glm 5 3 flash)", () => {
      const model = {
        id: "glm-5.3-flash",
        name: "GLM 5.3 Flash",
        value: "zhipu/glm-5.3-flash",
      };
      expect(matchModelKeywords(model, "glm 5-3 flash")).toBe(true);
      expect(matchModelKeywords(model, "glm 5.3 flash")).toBe(true);
      expect(matchModelKeywords(model, "glm 5 3 flash")).toBe(true);
      expect(matchModelKeywords(model, "glm-flash")).toBe(true);
      expect(matchModelKeywords(model, "5-3")).toBe(true);
      expect(matchModelKeywords(model, "5.3")).toBe(true);
      expect(matchModelKeywords(model, "53")).toBe(true);
    });

    it("matches compact alphanumeric terms (gpt4o -> gpt-4o)", () => {
      const model = {
        id: "gpt-4o",
        name: "GPT-4o",
        value: "openai/gpt-4o",
      };
      expect(matchModelKeywords(model, "gpt4o")).toBe(true);
      expect(matchModelKeywords(model, "gpt 4o")).toBe(true);
      expect(matchModelKeywords(model, "gpt-4o")).toBe(true);
      expect(matchModelKeywords(model, "4o")).toBe(true);
    });

    it("matches candidates given as simple string (e.g. combo names)", () => {
      expect(matchModelKeywords("Fast Claude 3.7", "claude fast")).toBe(true);
      expect(matchModelKeywords("Backup Sonnet", "sonnet")).toBe(true);
      expect(matchModelKeywords("Backup Sonnet", "gpt")).toBe(false);
    });

    it("matches using provider context (openrouter deepseek -> provider: openrouter, model: deepseek)", () => {
      const model = {
        id: "deepseek-chat",
        name: "DeepSeek V3",
        value: "openrouter/deepseek/deepseek-chat",
      };
      const context = { providerName: "OpenRouter", providerAlias: "openrouter" };
      expect(matchModelKeywords(model, "openrouter deepseek", context)).toBe(true);
      expect(matchModelKeywords(model, "openrouter v3", context)).toBe(true);
      expect(matchModelKeywords(model, "openai deepseek", context)).toBe(false);
    });

    it("returns true on empty or whitespace query", () => {
      const model = { id: "test-model", name: "Test Model", value: "test/test-model" };
      expect(matchModelKeywords(model, "")).toBe(true);
      expect(matchModelKeywords(model, "   ")).toBe(true);
      expect(matchModelKeywords(model, null)).toBe(true);
    });
  });

  describe("calculateModelRelevance & sortModelsByRelevance", () => {
    it("ranks exact match higher than partial and substring matches", () => {
      const exact = { id: "gpt-4o", name: "GPT-4o", value: "openai/gpt-4o" };
      const partial = { id: "gpt-4o-mini", name: "GPT-4o Mini", value: "openai/gpt-4o-mini" };
      const longTail = { id: "openai/gpt-4o-2024-11-20", name: "GPT-4o (2024-11-20)", value: "openai/gpt-4o-2024-11-20" };

      const scoreExact = calculateModelRelevance(exact, "gpt-4o");
      const scorePartial = calculateModelRelevance(partial, "gpt-4o");
      const scoreLongTail = calculateModelRelevance(longTail, "gpt-4o");

      expect(scoreExact).toBeGreaterThan(scorePartial);
      expect(scorePartial).toBeGreaterThan(scoreLongTail);
    });

    it("sorts models with most relevant first when search query is active", () => {
      const models = [
        { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku", value: "anthropic/claude-3-haiku" },
        { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet", value: "anthropic/claude-3-7-sonnet" },
        { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", value: "anthropic/claude-3-5-sonnet" },
      ];

      const sorted = sortModelsByRelevance(models, "3.7 sonnet");
      expect(sorted[0].id).toBe("claude-3-7-sonnet");
    });

    it("falls back to added-first alphabetical sort when query is empty", () => {
      const models = [
        { id: "b-model", name: "B Model", value: "p/b" },
        { id: "a-model", name: "A Model", value: "p/a" },
        { id: "c-model", name: "C Model", value: "p/c" },
      ];

      const sorted = sortModelsByRelevance(models, "", {}, ["p/c"]);
      expect(sorted[0].value).toBe("p/c");
      expect(sorted[1].value).toBe("p/a");
      expect(sorted[2].value).toBe("p/b");
    });
  });
});
