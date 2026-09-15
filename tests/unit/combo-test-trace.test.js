import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseModelString, getFallbackReason, POST } from "../../src/app/api/combos/[id]/test/route.js";
import * as localDb from "../../src/lib/localDb";
import * as accountFallback from "../../open-sse/services/accountFallback.js";
import * as comboService from "../../open-sse/services/combo.js";

vi.mock("../../src/lib/localDb", () => ({
  getComboById: vi.fn(),
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  getApiKeys: vi.fn(),
  getProviderNodes: vi.fn(),
}));

vi.mock("../../src/shared/utils/machineId", () => ({
  getConsistentMachineId: vi.fn().mockResolvedValue("mock-machine-id"),
}));

describe("Combo Test & Fallback Trace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseModelString helper", () => {
    it("parses string model with provider prefix", () => {
      const parsed = parseModelString("amd/DeepSeek-V4-Flash");
      expect(parsed).toEqual({
        modelStr: "amd/DeepSeek-V4-Flash",
        provider: "amd",
        modelName: "DeepSeek-V4-Flash",
        enabled: true,
      });
    });

    it("parses object model with enabled flag", () => {
      const parsed = parseModelString({ model: "vyce/deepseek-v4-flash", enabled: false });
      expect(parsed).toEqual({
        modelStr: "vyce/deepseek-v4-flash",
        provider: "vyce",
        modelName: "deepseek-v4-flash",
        enabled: false,
      });
    });

    it("handles model string without slash", () => {
      const parsed = parseModelString("custom-model");
      expect(parsed).toEqual({
        modelStr: "custom-model",
        provider: "custom-model",
        modelName: "custom-model",
        enabled: true,
      });
    });
  });

  describe("getFallbackReason helper", () => {
    it("identifies 429 / quota limits", () => {
      expect(getFallbackReason(429, "Daily usage limit exceeded")).toBe("Rate limit / Quota exceeded (429)");
      expect(getFallbackReason(200, "User quota exceeded")).toBe("Rate limit / Quota exceeded (429)");
    });

    it("identifies account locked in cooldown", () => {
      expect(getFallbackReason(429, "All accounts locked in cooldown until tomorrow")).toBe("Account locked in cooldown");
    });

    it("identifies upstream 503 / 502 / server errors", () => {
      expect(getFallbackReason(503, "Service unavailable")).toBe("Upstream provider unavailable (503/502)");
      expect(getFallbackReason(502, "Bad gateway")).toBe("Upstream provider unavailable (503/502)");
    });

    it("identifies authentication errors", () => {
      expect(getFallbackReason(401, "Invalid API key")).toBe("Authentication / API key error (401/403)");
      expect(getFallbackReason(403, "Forbidden access")).toBe("Authentication / API key error (401/403)");
    });

    it("identifies missing credentials", () => {
      expect(getFallbackReason(500, "No active connections configured")).toBe("No active credentials configured");
    });
  });

  describe("POST /api/combos/[id]/test route handler", () => {
    it("returns 404 if combo is not found", async () => {
      vi.mocked(localDb.getComboById).mockResolvedValueOnce(null);

      const req = new Request("http://localhost/api/combos/notfound/test", {
        method: "POST",
        body: JSON.stringify({ prompt: "ping" }),
      });
      const res = await POST(req, { params: Promise.resolve({ id: "notfound" }) });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Combo not found");
    });

    it("correctly traces fallback when step 1 is locked in cooldown and step 2 succeeds", async () => {
      const mockCombo = {
        id: "combo-123",
        name: "test-combo",
        models: ["amd/DeepSeek-V4-Flash", "vyce/deepseek-v4-flash", "google/gemini-2.5-flash"],
      };

      vi.mocked(localDb.getComboById).mockResolvedValueOnce(mockCombo);
      vi.mocked(localDb.getSettings).mockResolvedValueOnce({});
      vi.mocked(localDb.getApiKeys).mockResolvedValueOnce([{ key: "sk-test", isActive: true }]);

      // Mock connections: amd is locked with modelLock___all
      vi.mocked(localDb.getProviderConnections).mockImplementation(async ({ provider }) => {
        if (provider === "amd") {
          return [
            {
              id: "conn-amd-1",
              name: "AMD Acc 1",
              isActive: true,
              modelLock___all: "2026-09-16T00:00:00.000Z",
              lastError: "Daily usage limit exceeded",
              errorCode: 429,
            },
          ];
        }
        if (provider === "vyce") {
          return [{ id: "conn-vyce-1", name: "Vyce Acc", isActive: true }];
        }
        return [];
      });

      // Mock global fetch for the HTTP request to vyce
      global.fetch = vi.fn().mockImplementation(async (url, options) => {
        const body = JSON.parse(options.body);
        if (body.model === "vyce/deepseek-v4-flash") {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                choices: [{ message: { content: "Hello from Vyce!" } }],
                usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
              }),
          };
        }
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ error: "Unexpected error" }),
        };
      });

      const req = new Request("http://localhost/api/combos/combo-123/test", {
        method: "POST",
        body: JSON.stringify({ prompt: "Say hello", testAll: false }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "combo-123" }) });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.comboId).toBe("combo-123");
      expect(data.overallStatus).toBe("success");
      expect(data.winningModel).toBe("vyce/deepseek-v4-flash");
      expect(data.winningStep).toBe(2);
      expect(data.winningOutput).toBe("Hello from Vyce!");

      // Verify steps:
      // Step 1 (AMD): skipped 0ms due to DB lock, nextAction: fallback_to_vyce/deepseek-v4-flash
      expect(data.steps[0]).toMatchObject({
        step: 1,
        model: "amd/DeepSeek-V4-Flash",
        provider: "amd",
        ok: false,
        skipped: true,
        latencyMs: 0,
        status: 429,
        fallbackReason: "Rate limit / Quota exceeded (429)",
        nextAction: "fallback_to_vyce/deepseek-v4-flash",
      });

      // Step 2 (Vyce): executed, ok: true, outputPreview: "Hello from Vyce!", nextAction: "served"
      expect(data.steps[1]).toMatchObject({
        step: 2,
        model: "vyce/deepseek-v4-flash",
        provider: "vyce",
        ok: true,
        skipped: false,
        outputPreview: "Hello from Vyce!",
        nextAction: "served",
      });

      // Step 3 (Google): skipped because step 2 succeeded and testAll: false
      expect(data.steps[2]).toMatchObject({
        step: 3,
        model: "google/gemini-2.5-flash",
        skipped: true,
        nextAction: "not_needed",
      });
    });

    it("marks overallStatus as all_failed if all models fail", async () => {
      const mockCombo = {
        id: "combo-fail",
        name: "failing-combo",
        models: ["prov1/mod1", "prov2/mod2"],
      };

      vi.mocked(localDb.getComboById).mockResolvedValueOnce(mockCombo);
      vi.mocked(localDb.getSettings).mockResolvedValueOnce({});
      vi.mocked(localDb.getApiKeys).mockResolvedValueOnce([]);
      vi.mocked(localDb.getProviderConnections).mockResolvedValue([]); // No connections

      const req = new Request("http://localhost/api/combos/combo-fail/test", {
        method: "POST",
        body: JSON.stringify({ prompt: "test" }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "combo-fail" }) });
      const data = await res.json();

      expect(data.overallStatus).toBe("all_failed");
      expect(data.winningModel).toBeNull();
      expect(data.steps[0].nextAction).toBe("fallback_to_prov2/mod2");
      expect(data.steps[1].nextAction).toBe("end_all_failed");
    });

    it("correctly marks disabled models as skipped in fallback trace", async () => {
      const mockCombo = {
        id: "combo-disabled",
        name: "combo-with-disabled",
        models: [
          { model: "amd/DeepSeek-V4-Flash", enabled: false },
          "vyce/deepseek-v4-flash",
        ],
      };

      vi.mocked(localDb.getComboById).mockResolvedValueOnce(mockCombo);
      vi.mocked(localDb.getSettings).mockResolvedValueOnce({});
      vi.mocked(localDb.getApiKeys).mockResolvedValueOnce([{ key: "sk-test", isActive: true }]);
      vi.mocked(localDb.getProviderConnections).mockResolvedValueOnce([
        { id: "conn-1", provider: "vyce", isActive: true },
      ]);

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
      });

      const req = new Request("http://localhost/api/combos/combo-disabled/test", {
        method: "POST",
        body: JSON.stringify({ prompt: "hi" }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "combo-disabled" }) });
      const data = await res.json();

      expect(data.overallStatus).toBe("success");
      expect(data.steps[0]).toMatchObject({
        step: 1,
        model: "amd/DeepSeek-V4-Flash",
        skipped: true,
        error: "Model disabled in combo settings",
        fallbackReason: "Model disabled in combo",
        nextAction: "fallback_to_vyce/deepseek-v4-flash",
      });
      expect(data.steps[1]).toMatchObject({
        step: 2,
        model: "vyce/deepseek-v4-flash",
        ok: true,
        skipped: false,
        nextAction: "served",
      });
    });

    it("correctly resolves alias (cx -> codex) and custom nodes (vb -> custom-id) to find credentials", async () => {
      const mockCombo = {
        id: "combo-luna",
        name: "gpt-5.6-luna",
        models: ["cx/gpt-5.6-luna", "vb/gpt-5.6-luna"],
      };

      vi.mocked(localDb.getComboById).mockResolvedValueOnce(mockCombo);
      vi.mocked(localDb.getSettings).mockResolvedValueOnce({});
      vi.mocked(localDb.getApiKeys).mockResolvedValueOnce([{ key: "sk-test", isActive: true }]);

      // Mock provider nodes for "vb"
      vi.mocked(localDb.getProviderNodes).mockResolvedValue([
        { id: "node-viber-1", prefix: "vb" },
      ]);

      // Connections: codex has no connection (fails with 500), but node-viber-1 has active connection!
      vi.mocked(localDb.getProviderConnections).mockImplementation(async ({ provider }) => {
        if (provider === "codex") return [];
        if (provider === "node-viber-1") return [{ id: "conn-vb-1", name: "Viber Acc", isActive: true }];
        return [];
      });

      global.fetch = vi.fn().mockImplementation(async (url, options) => {
        const body = JSON.parse(options.body);
        if (body.model === "vb/gpt-5.6-luna") {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ choices: [{ message: { content: "Hello Luna!" } }] }),
          };
        }
        return { ok: false, status: 500, text: async () => JSON.stringify({ error: "Failed" }) };
      });

      const req = new Request("http://localhost/api/combos/combo-luna/test", {
        method: "POST",
        body: JSON.stringify({ prompt: "hi" }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "combo-luna" }) });
      const data = await res.json();

      expect(data.overallStatus).toBe("success");
      expect(data.winningModel).toBe("vb/gpt-5.6-luna");
      expect(data.winningStep).toBe(2);
      expect(data.steps[0]).toMatchObject({
        step: 1,
        model: "cx/gpt-5.6-luna",
        provider: "cx",
        ok: false,
        skipped: true,
        fallbackReason: "No active credentials configured",
        nextAction: "fallback_to_vb/gpt-5.6-luna",
      });
      expect(data.steps[1]).toMatchObject({
        step: 2,
        model: "vb/gpt-5.6-luna",
        provider: "vb",
        ok: true,
        outputPreview: "Hello Luna!",
        nextAction: "served",
      });
    });

    it("streams events when stream: true is requested", async () => {
      const mockCombo = {
        id: "combo-stream",
        name: "Stream Combo",
        models: ["vyce/deepseek-v4-flash"],
      };

      vi.mocked(localDb.getComboById).mockResolvedValueOnce(mockCombo);
      vi.mocked(localDb.getSettings).mockResolvedValueOnce({});
      vi.mocked(localDb.getApiKeys).mockResolvedValueOnce([{ key: "sk-test", isActive: true }]);
      vi.mocked(localDb.getProviderConnections).mockImplementation(async () => [
        { id: "conn-vyce-1", name: "Vyce", isActive: true },
      ]);

      global.fetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: "Streaming Hello" } }] }),
      }));

      const req = new Request("http://localhost/api/combos/combo-stream/test", {
        method: "POST",
        body: JSON.stringify({ prompt: "hi", stream: true }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "combo-stream" }) });
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const text = await res.text();
      expect(text).toContain('"type":"init"');
      expect(text).toContain('"type":"step_start"');
      expect(text).toContain('"type":"step_complete"');
      expect(text).toContain('"type":"complete"');
      expect(text).toContain("Streaming Hello");
    });
  });
});
