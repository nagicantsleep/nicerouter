import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(() => {}),
}));

const { detectStreamError, handleStreamingResponse } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
const { handleComboChat } = await import("../../open-sse/services/combo.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

describe("Stream error detection and combo fallback", () => {
  describe("detectStreamError", () => {
    it("detects AMD Cloud / OneClick Anthropic rate limit stream error", () => {
      const sseText =
        'event: error\ndata: {"type": "error", "error": {"type": "rate_limit_error", "message": "Daily usage limit exceeded: maximum $1 per period for this OneClick user. Please try again later."}}\n\n';
      const result = detectStreamError(sseText);
      expect(result).not.toBeNull();
      expect(result.status).toBe(429);
      expect(result.message).toContain("Daily usage limit exceeded");
      expect(result.errorType).toBe("rate_limit_error");
    });

    it("detects OpenAI in-stream rate limit error", () => {
      const sseText =
        'data: {"error": {"message": "Rate limit reached for requests", "type": "requests", "code": "rate_limit_exceeded"}}\n\n';
      const result = detectStreamError(sseText);
      expect(result).not.toBeNull();
      expect(result.status).toBe(429);
      expect(result.message).toBe("Rate limit reached for requests");
      expect(result.errorCode).toBe("rate_limit_exceeded");
    });

    it("detects capacity / overload stream error with 503", () => {
      const sseText =
        'data: {"type":"response.failed","response":{"error":{"message":"Selected model is at capacity. Please try a different model.","type":"insufficient_quota"}}}\n\n';
      const result = detectStreamError(sseText);
      expect(result).not.toBeNull();
      expect(result.status).toBe(503);
      expect(result.message).toContain("Selected model is at capacity");
    });

    it("does not flag normal assistant content that mentions error as a stream error", () => {
      const normalChunk =
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"To fix this compilation error, you must import the module."}}]}\n\n';
      const result = detectStreamError(normalChunk);
      expect(result).toBeNull();
    });

    it("does not flag standard Anthropic message_start event as error", () => {
      const startChunk =
        'event: message_start\ndata: {"type": "message_start", "message": {"id": "msg_01", "role": "assistant", "model": "claude-3-7-sonnet"}}\n\n';
      const result = detectStreamError(startChunk);
      expect(result).toBeNull();
    });
  });

  describe("handleStreamingResponse with in-stream error", () => {
    it("returns success: false with 429 when upstream returns 200 OK with AMD Cloud rate limit SSE", async () => {
      const ssePayload =
        'event: error\ndata: {"type": "error", "error": {"type": "rate_limit_error", "message": "Daily usage limit exceeded: maximum $1 per period for this OneClick user. Please try again later."}}\n\n';

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(ssePayload));
          controller.close();
        },
      });

      const providerResponse = new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

      const onRequestSuccess = vi.fn();
      const streamController = { handleError: vi.fn(), handleComplete: vi.fn() };
      const reqLogger = { logError: vi.fn(), logProviderResponse: vi.fn() };

      const result = await handleStreamingResponse({
        providerResponse,
        provider: "amd",
        model: "DeepSeek-V4-Flash",
        sourceFormat: FORMATS.CLAUDE,
        targetFormat: FORMATS.CLAUDE,
        userAgent: "claude-code",
        body: { stream: true },
        stream: true,
        requestStartTime: Date.now(),
        connectionId: "conn-amd-1",
        onRequestSuccess,
        reqLogger,
        streamController,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe(429);
      expect(result.error).toContain("Daily usage limit exceeded");
      expect(onRequestSuccess).not.toHaveBeenCalled();
      expect(result.response.status).toBe(429);
    });

    it("calls onRequestSuccess and returns success: true for normal streams", async () => {
      const normalPayload =
        'event: message_start\ndata: {"type": "message_start", "message": {"id": "msg_1"}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}\n\n';

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(normalPayload));
          controller.close();
        },
      });

      const providerResponse = new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

      const onRequestSuccess = vi.fn();
      const streamController = {
        signal: new AbortController().signal,
        isConnected: () => true,
        handleError: vi.fn(),
        handleComplete: vi.fn(),
      };
      const reqLogger = { logError: vi.fn(), logProviderResponse: vi.fn() };

      const result = await handleStreamingResponse({
        providerResponse,
        provider: "amd",
        model: "DeepSeek-V4-Flash",
        sourceFormat: FORMATS.CLAUDE,
        targetFormat: FORMATS.CLAUDE,
        userAgent: "claude-code",
        body: { stream: true },
        stream: true,
        requestStartTime: Date.now(),
        connectionId: "conn-amd-1",
        onRequestSuccess,
        reqLogger,
        streamController,
      });

      expect(result.success).toBe(true);
      expect(result.response.status).toBe(200);
      expect(onRequestSuccess).toHaveBeenCalled();
    });
  });

  describe("Combo fallback on stream error", () => {
    it("falls through to the next combo model when first model fails with 429 stream error", async () => {
      const models = ["amd/DeepSeek-V4-Flash", "ms/deepseek-ai/DeepSeek-V4-Flash-0731"];
      const attempted = [];

      const handleSingleModel = vi.fn(async (body, modelStr) => {
        attempted.push(modelStr);
        if (modelStr === "amd/DeepSeek-V4-Flash") {
          // Model 1 failed due to in-stream error, returning 429
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
        // Model 2 succeeds with 200 OK stream
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
        comboName: "deepseek-v4-flash",
        comboStrategy: "fallback",
      });

      expect(res.status).toBe(200);
      expect(attempted).toEqual(["amd/DeepSeek-V4-Flash", "ms/deepseek-ai/DeepSeek-V4-Flash-0731"]);
    });

    it("falls through immediately without 2s sleep when error is quota exhaustion", async () => {
      const models = ["amd/DeepSeek-V4-Flash", "ms/deepseek-ai/DeepSeek-V4-Flash-0731"];
      const handleSingleModel = vi.fn(async (body, modelStr) => {
        if (modelStr === "amd/DeepSeek-V4-Flash") {
          return new Response(
            JSON.stringify({
              error: {
                message: "[amd/DeepSeek-V4-Flash] [429]: Daily usage limit exceeded (reset after 30s)",
              },
            }),
            { status: 503, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      });

      const t0 = Date.now();
      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const res = await handleComboChat({
        body: { stream: true },
        models,
        handleSingleModel,
        log,
        comboName: "deepseek-v4-flash",
      });

      const elapsed = Date.now() - t0;
      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(1000); // Must NOT sleep 2000ms
    });
  });

  describe("isAccountWideQuotaError", () => {
    it("recognizes AMD Cloud / OneClick daily limit as account-wide", async () => {
      const { isAccountWideQuotaError } = await import("../../src/sse/services/auth.js");
      expect(isAccountWideQuotaError(429, "Daily usage limit exceeded: maximum $1 per period for this OneClick user. Please try again later.")).toBe(true);
      expect(isAccountWideQuotaError(429, "Billing_hard_limit_reached")).toBe(true);
      expect(isAccountWideQuotaError(403, "Insufficient_quota for account")).toBe(true);
      expect(isAccountWideQuotaError(500, "Internal error")).toBe(false);
    });
  });
});
