import { describe, it, expect, beforeEach } from "vitest";
import { recordRateHit, getRateStats } from "../../src/lib/db/repos/usageRepo.js";

describe("RPM & TPM real-time rate tracking", () => {
  beforeEach(() => {
    if (global._rateWindow) {
      global._rateWindow.length = 0;
    }
  });

  it("calculates current RPM and TPM from hits", () => {
    // 2 requests started
    recordRateHit({ model: "claude-opus-5", provider: "claude", isRequest: true });
    recordRateHit({ model: "claude-opus-5", provider: "claude", isRequest: true });

    // 2 requests completed with tokens
    recordRateHit({
      model: "claude-opus-5",
      provider: "claude",
      tokens: 2500,
      promptTokens: 2000,
      completionTokens: 500,
      isRequest: false
    });
    recordRateHit({
      model: "claude-opus-5",
      provider: "claude",
      tokens: 7500,
      promptTokens: 7000,
      completionTokens: 500,
      isRequest: false
    });

    const stats = getRateStats();
    expect(stats.currentRpm).toBe(2);
    expect(stats.currentTpm).toBe(10000);
    expect(stats.currentInputTpm).toBe(9000);
    expect(stats.currentOutputTpm).toBe(1000);
    expect(stats.rpmByModel["claude-opus-5"]).toBe(2);
    expect(stats.tpmByModel["claude-opus-5"]).toBe(10000);
    expect(stats.rpmByProvider["claude"]).toBe(2);
    expect(stats.tpmByProvider["claude"]).toBe(10000);
  });

  it("prunes hits older than 60 seconds", () => {
    const oldTimestamp = Date.now() - 70000;
    global._rateWindow.push({
      ts: oldTimestamp,
      model: "claude-opus-5",
      provider: "claude",
      tokens: 50000,
      isRequest: true
    });

    // Recent hit
    recordRateHit({ model: "gpt-5.6-sol", provider: "codex", tokens: 1000, isRequest: true });

    const stats = getRateStats();
    expect(stats.currentRpm).toBe(1);
    expect(stats.rpmByModel["claude-opus-5"]).toBeUndefined();
    expect(stats.rpmByModel["gpt-5.6-sol"]).toBe(1);
  });

  it("integrates rate stats into getUsageStats output", async () => {
    const { getUsageStats } = await import("../../src/lib/db/repos/usageRepo.js");
    recordRateHit({ model: "claude-opus-5", provider: "claude", isRequest: true });
    recordRateHit({
      model: "claude-opus-5",
      provider: "claude",
      tokens: 3000,
      isRequest: false,
    });

    const stats = await getUsageStats("today");
    expect(stats).toHaveProperty("currentRpm");
    expect(stats).toHaveProperty("currentTpm");
    expect(stats).toHaveProperty("peakRpm10m");
    expect(stats).toHaveProperty("peakTpm10m");
    expect(stats.currentRpm).toBeGreaterThanOrEqual(1);
    expect(stats.currentTpm).toBeGreaterThanOrEqual(3000);
  });
});
