import { describe, it, expect, vi } from "vitest";
import { isQuotaExhaustionError, handleComboChat } from "../../open-sse/services/combo.js";
import { isAccountWideQuotaError, markAccountUnavailable } from "../../src/sse/services/auth.js";
import { autoDisableComboModel } from "../../src/sse/services/model.js";
import * as localDb from "@/lib/localDb";

describe("Combo Fallback Auto-Disable on Quota Exhaustion", () => {
  describe("isQuotaExhaustionError", () => {
    it("identifies AMD Cloud / OneClick daily limit as quota exhaustion", () => {
      const msg = "Daily usage limit exceeded: maximum $1 per period for this OneClick user. Please try again later.";
      expect(isQuotaExhaustionError(429, msg)).toBe(true);
      expect(isAccountWideQuotaError(429, msg)).toBe(true);
    });

    it("identifies OpenAI quota exceeded as quota exhaustion", () => {
      const msg = "You exceeded your current quota, please check your plan and billing details.";
      expect(isQuotaExhaustionError(429, msg)).toBe(true);
      expect(isAccountWideQuotaError(429, msg)).toBe(true);
    });

    it("identifies HTTP 402 with quota/credit context and out of credits", () => {
      expect(isQuotaExhaustionError(402, "Payment Required: insufficient credit balance")).toBe(true);
      expect(isQuotaExhaustionError(402, "Payment Required")).toBe(false); // Bare 402 without quota context is model-scoped (e.g. GitHub Copilot)
      expect(isQuotaExhaustionError(400, "account has run out of credits")).toBe(true);
      expect(isQuotaExhaustionError(403, "insufficient balance")).toBe(true);
      expect(isQuotaExhaustionError(429, "billing_hard_limit_reached")).toBe(true);
    });

    it("identifies no active credentials as quota exhaustion for combo disable", () => {
      expect(isQuotaExhaustionError(404, "No active credentials for provider: amd")).toBe(true);
      expect(isQuotaExhaustionError(503, "[amd/DeepSeek-V4-Flash] No active credentials")).toBe(true);
    });

    it("does not flag transient rate limits or 5xx server errors as quota exhaustion", () => {
      expect(isQuotaExhaustionError(429, "Rate limit reached: 5 requests per minute")).toBe(false);
      expect(isQuotaExhaustionError(500, "Internal server error")).toBe(false);
      expect(isQuotaExhaustionError(502, "Bad gateway")).toBe(false);
      expect(isQuotaExhaustionError(503, "Service temporarily overloaded")).toBe(false);
    });
  });

  describe("handleComboChat with onModelQuotaExceeded", () => {
    it("calls onModelQuotaExceeded when model fails with AMD daily quota limit", async () => {
      const onModelQuotaExceeded = vi.fn(async () => true);
      const models = ["amd/DeepSeek-V4-Flash", "ms/deepseek-ai/DeepSeek-V4-Flash-0731"];
      const attempted = [];

      const handleSingleModel = vi.fn(async (body, modelStr) => {
        attempted.push(modelStr);
        if (modelStr === "amd/DeepSeek-V4-Flash") {
          return new Response(
            JSON.stringify({
              error: {
                message: "Daily usage limit exceeded: maximum $1 per period for this OneClick user. Please try again later.",
                type: "rate_limit_error",
              },
            }),
            { status: 429, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      });

      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const res = await handleComboChat({
        body: { stream: true },
        models,
        handleSingleModel,
        log,
        comboName: "test-deepseek-combo",
        comboStrategy: "fallback",
        onModelQuotaExceeded,
      });

      expect(res.status).toBe(200);
      expect(attempted).toEqual(["amd/DeepSeek-V4-Flash", "ms/deepseek-ai/DeepSeek-V4-Flash-0731"]);
      expect(onModelQuotaExceeded).toHaveBeenCalledTimes(1);
      expect(onModelQuotaExceeded).toHaveBeenCalledWith(
        "test-deepseek-combo",
        "amd/DeepSeek-V4-Flash",
        429,
        expect.stringContaining("Daily usage limit exceeded")
      );
    });

    it("does not call onModelQuotaExceeded for ordinary transient 503 errors", async () => {
      const onModelQuotaExceeded = vi.fn(async () => true);
      const models = ["providerA/model1", "providerB/model2"];

      const handleSingleModel = vi.fn(async (body, modelStr) => {
        if (modelStr === "providerA/model1") {
          return new Response(
            JSON.stringify({ error: { message: "Service temporarily unavailable" } }),
            { status: 503, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("ok", { status: 200 });
      });

      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const res = await handleComboChat({
        body: {},
        models,
        handleSingleModel,
        log,
        comboName: "transient-combo",
        onModelQuotaExceeded,
      });

      expect(res.status).toBe(200);
      expect(onModelQuotaExceeded).not.toHaveBeenCalled();
    });
  });

  describe("autoDisableComboModel", () => {
    it("disables the failed model in combo.models and calls updateCombo", async () => {
      const mockCombo = {
        id: "combo-123",
        name: "test-combo",
        models: ["amd/DeepSeek-V4-Flash", "ms/deepseek-ai/DeepSeek-V4-Flash-0731"],
      };

      vi.spyOn(localDb, "getComboByName").mockResolvedValue(mockCombo);
      const updateSpy = vi.spyOn(localDb, "updateCombo").mockResolvedValue({ ...mockCombo });

      const result = await autoDisableComboModel(
        "test-combo",
        "amd/DeepSeek-V4-Flash",
        429,
        "Daily usage limit exceeded"
      );

      expect(result).toBe(true);
      expect(updateSpy).toHaveBeenCalledWith("combo-123", {
        models: [
          { model: "amd/DeepSeek-V4-Flash", enabled: false },
          "ms/deepseek-ai/DeepSeek-V4-Flash-0731",
        ],
      });
    });

    it("handles already object-formatted models in combo", async () => {
      const mockCombo = {
        id: "combo-456",
        name: "obj-combo",
        models: [
          { model: "amd/DeepSeek-V4-Flash", enabled: true, priority: 1 },
          { model: "ms/deepseek", enabled: true },
        ],
      };

      vi.spyOn(localDb, "getComboByName").mockResolvedValue(mockCombo);
      const updateSpy = vi.spyOn(localDb, "updateCombo").mockResolvedValue({ ...mockCombo });

      const result = await autoDisableComboModel("obj-combo", "amd/DeepSeek-V4-Flash", 429, "Limit");

      expect(result).toBe(true);
      expect(updateSpy).toHaveBeenCalledWith("combo-456", {
        models: [
          { model: "amd/DeepSeek-V4-Flash", enabled: false, priority: 1 },
          { model: "ms/deepseek", enabled: true },
        ],
      });
    });
  });

  describe("markAccountUnavailable auto-disabling connection", () => {
    it("sets isActive: false on connection when error is daily quota exceeded", async () => {
      const mockConn = {
        id: "conn-amd-1",
        provider: "amd",
        name: "AMD Key 1",
        isActive: true,
      };

      vi.spyOn(localDb, "getProviderConnections").mockResolvedValue([mockConn]);
      const updateConnSpy = vi.spyOn(localDb, "updateProviderConnection").mockResolvedValue({ ...mockConn, isActive: false });

      await markAccountUnavailable(
        "conn-amd-1",
        429,
        "Daily usage limit exceeded: maximum $1 per period for this OneClick user. Please try again later.",
        "amd",
        "DeepSeek-V4-Flash"
      );

      expect(updateConnSpy).toHaveBeenCalledWith(
        "conn-amd-1",
        expect.objectContaining({
          isActive: false,
          testStatus: "unavailable",
          errorCode: 429,
        })
      );
    });

    it("does not set isActive: false on connection for transient 503 errors", async () => {
      const mockConn = {
        id: "conn-other-1",
        provider: "openai",
        name: "OpenAI Key",
        isActive: true,
      };

      vi.spyOn(localDb, "getProviderConnections").mockResolvedValue([mockConn]);
      const updateConnSpy = vi.spyOn(localDb, "updateProviderConnection").mockResolvedValue({ ...mockConn });

      await markAccountUnavailable(
        "conn-other-1",
        503,
        "Service temporarily overloaded",
        "openai",
        "gpt-4o"
      );

      expect(updateConnSpy).toHaveBeenCalledWith(
        "conn-other-1",
        expect.not.objectContaining({
          isActive: false,
        })
      );
    });
  });
});
