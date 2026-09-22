import { describe, expect, it } from "vitest";
import {
  filterQuotasByVisibility,
  getHiddenQuotaRows,
  getGroupPaginationSummary,
  getPageSizeLabel,
  groupConnectionsByProvider,
  parseQuotaData,
  trimHiddenQuotaKeys,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("provider quota visibility", () => {
  const data = {
    quotas: {
      "gemini-pro-agent": {
        displayName: "Gemini 3.1 Pro (High)",
        used: 200,
        total: 1000,
        resetAt: "2026-07-04T00:00:00Z",
        remainingPercentage: 80,
      },
      "claude-opus-4-6-thinking": {
        displayName: "Claude Opus 4.6 (Thinking)",
        used: 100,
        total: 1000,
        resetAt: "2026-07-04T00:00:00Z",
        remainingPercentage: 90,
      },
    },
  };

  it("groups Antigravity model quotas into Gemini and Claude families", () => {
    const quotas = parseQuotaData("antigravity", data);
    expect(quotas.map((q) => q.modelKey)).toEqual([
      "gemini",
      "claude",
    ]);
    expect(quotas[0].name).toBe("Gemini (Flash / Pro)");
    expect(quotas[1].name).toBe("Claude (Sonnet / Opus)");
  });

  it("shows all quotas by default and hides configured provider rows", () => {
    const quotas = parseQuotaData("antigravity", data);
    expect(filterQuotasByVisibility("antigravity", quotas, {})).toHaveLength(2);

    const visibility = {
      antigravity: { hidden: ["claude"] },
    };
    const visible = filterQuotasByVisibility("antigravity", quotas, visibility);
    const hidden = getHiddenQuotaRows("antigravity", quotas, visibility);

    expect(visible.map((q) => q.modelKey)).toEqual(["gemini"]);
    expect(hidden.map((q) => q.modelKey)).toEqual(["claude"]);
  });

  it("trims stale or obsolete model keys", () => {
    const quotas = parseQuotaData("antigravity", data);
    const trimmed = trimHiddenQuotaKeys(["claude", "stale-model-xyz", "gemini-3.8-flash-low"], quotas);
    expect(trimmed).toEqual(["claude"]);

    const visibility = {
      antigravity: { hidden: ["claude", "stale-model-xyz"] },
    };
    const visible = filterQuotasByVisibility("antigravity", quotas, visibility);
    const hidden = getHiddenQuotaRows("antigravity", quotas, visibility);

    expect(visible.map((q) => q.modelKey)).toEqual(["gemini"]);
    expect(hidden.map((q) => q.modelKey)).toEqual(["claude"]);
  });

  it("does not apply one provider hidden list to another provider", () => {
    const quotas = parseQuotaData("antigravity", data);
    const visibility = {
      codex: { hidden: ["gemini"] },
    };
    expect(filterQuotasByVisibility("antigravity", quotas, visibility)).toHaveLength(2);
  });

  describe("groupConnectionsByProvider", () => {
    it("groups connections by provider while preserving order of items within each group", () => {
      const connections = [
        { id: "c1", provider: "claude", name: "Claude 1" },
        { id: "x1", provider: "codex", name: "Codex 1" },
        { id: "c2", provider: "claude", name: "Claude 2" },
        { id: "k1", provider: "kiro", name: "Kiro 1" },
        { id: "x2", provider: "codex", name: "Codex 2" },
      ];

      const grouped = groupConnectionsByProvider(connections);
      expect(grouped).toEqual([
        {
          provider: "claude",
          items: [
            { id: "c1", provider: "claude", name: "Claude 1" },
            { id: "c2", provider: "claude", name: "Claude 2" },
          ],
        },
        {
          provider: "codex",
          items: [
            { id: "x1", provider: "codex", name: "Codex 1" },
            { id: "x2", provider: "codex", name: "Codex 2" },
          ],
        },
        {
          provider: "kiro",
          items: [{ id: "k1", provider: "kiro", name: "Kiro 1" }],
        },
      ]);
    });

    it("returns an empty array when given an empty list", () => {
      expect(groupConnectionsByProvider([])).toEqual([]);
    });
  });

  describe("getGroupPaginationSummary", () => {
    it("formats group pagination summary with total connections count", () => {
      const summary = getGroupPaginationSummary(
        { page: 1, pageSize: 5, total: 12 },
        30,
      );
      expect(summary).toBe("Showing 1-5 of 12 provider groups (30 accounts)");
    });

    it("formats group pagination summary on the last page correctly", () => {
      const summary = getGroupPaginationSummary(
        { page: 3, pageSize: 5, total: 12 },
        30,
      );
      expect(summary).toBe("Showing 11-12 of 12 provider groups (30 accounts)");
    });

    it("handles zero total groups", () => {
      const summary = getGroupPaginationSummary(
        { page: 1, pageSize: 5, total: 0 },
        0,
      );
      expect(summary).toBe("No provider groups");
    });
  });

  describe("getPageSizeLabel", () => {
    it("returns accounts unit when isGrouped is false", () => {
      expect(getPageSizeLabel(20, false, false)).toBe("20 accounts / page");
    });

    it("returns providers unit when isGrouped is true", () => {
      expect(getPageSizeLabel(5, false, true)).toBe("5 providers / page");
    });

    it("returns Custom label when isCustomPageSize is true", () => {
      expect(getPageSizeLabel(7, true, true)).toBe("Custom: 7 / page");
    });
  });
});
