import { describe, it, expect, vi, beforeEach } from "vitest";
import { FreebuffExecutor } from "../../open-sse/executors/freebuff.js";
import { FreebuffService } from "../../src/lib/oauth/services/freebuff.js";
import * as proxyFetch from "../../open-sse/utils/proxyFetch.js";

describe("FreebuffExecutor", () => {
  let executor;

  beforeEach(() => {
    executor = new FreebuffExecutor();
    vi.restoreAllMocks();
  });

  it("builds correct URL and headers", () => {
    expect(executor.buildUrl()).toBe("https://www.codebuff.com/api/v1/chat/completions");

    const headers = executor.buildHeaders({ accessToken: "test-token-123" }, true);
    expect(headers["Authorization"]).toBe("Bearer test-token-123");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["User-Agent"]).toContain("Freebuff-CLI");
    expect(headers["Accept"]).toBe("text/event-stream");
  });

  it("ensures session and agent run with caching", async () => {
    const fetchSpy = vi.spyOn(proxyFetch, "proxyAwareFetch");

    // 1. Mock session creation
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "active",
          instanceId: "inst-abc-123",
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        }),
        { status: 200 }
      )
    );

    // 2. Mock start agent run
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          runId: "run-xyz-789",
        }),
        { status: 200 }
      )
    );

    const session = await executor.ensureSessionAndRun(
      "test-token-caching",
      "google/gemini-2.5-flash-lite"
    );

    expect(session.instanceId).toBe("inst-abc-123");
    expect(session.runId).toBe("run-xyz-789");
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Call again with same token -> should use in-memory cache and not fetch again
    const cachedSession = await executor.ensureSessionAndRun(
      "test-token-caching",
      "google/gemini-2.5-flash-lite"
    );
    expect(cachedSession.instanceId).toBe("inst-abc-123");
    expect(cachedSession.runId).toBe("run-xyz-789");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("handles waiting room queue error gracefully", async () => {
    const fetchSpy = vi.spyOn(proxyFetch, "proxyAwareFetch");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "queued",
          position: 4,
          estimatedWaitMs: 15000,
        }),
        { status: 200 }
      )
    );

    await expect(
      executor.ensureSessionAndRun("test-token-queue", "google/gemini-2.5-flash-lite")
    ).rejects.toThrow(/waiting room queued/i);
  });

  it("injects codebuff_metadata and executes completion", async () => {
    const fetchSpy = vi.spyOn(proxyFetch, "proxyAwareFetch");

    // Mock session
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "active",
          instanceId: "inst-exec-1",
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        }),
        { status: 200 }
      )
    );

    // Mock agent run
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ runId: "run-exec-1" }),
        { status: 200 }
      )
    );

    // Mock chat completion
    fetchSpy.mockImplementationOnce(async (url, opts) => {
      const body = JSON.parse(opts.body);
      expect(body.codebuff_metadata).toBeDefined();
      expect(body.codebuff_metadata.run_id).toBe("run-exec-1");
      expect(body.codebuff_metadata.freebuff_instance_id).toBe("inst-exec-1");
      expect(body.codebuff_metadata.cost_mode).toBe("free");
      expect(typeof body.codebuff_metadata.client_id).toBe("string");
      expect(body.model).toBe("mimo/mimo-v2.5");

      return new Response(JSON.stringify({ choices: [{ message: { content: "Hello!" } }] }), {
        status: 200,
      });
    });

    const result = await executor.execute({
      model: "freebuff/mimo/mimo-v2.5",
      body: { messages: [{ role: "user", content: "Hi" }] },
      stream: false,
      credentials: { accessToken: "test-token-exec" },
    });

    expect(result.response.ok).toBe(true);
    const data = await result.response.json();
    expect(data.choices[0].message.content).toBe("Hello!");
  });

  it("parses error responses correctly", () => {
    const errorJson = JSON.stringify({
      error: "free_mode_invalid_agent_model",
      message: "Model not supported in free mode",
    });
    const parsed = executor.parseError({ status: 400 }, errorJson);
    expect(parsed.status).toBe(400);
    expect(parsed.message).toBe("Model not supported in free mode");
  });
});

describe("FreebuffService", () => {
  it("extracts user info from credentials.json format", () => {
    const service = new FreebuffService();
    const info = service.extractUserInfo("some.jwt.token", {
      default: {
        id: "usr_123",
        name: "Test User",
        email: "test@example.com",
      },
    });

    expect(info.email).toBe("test@example.com");
    expect(info.name).toBe("Test User");
    expect(info.id).toBe("usr_123");
  });
});
