import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Proxy Change Cooldown Reset & Test Model with All Keys", () => {
  it("PUT /api/providers/[id] resets cooldown and model locks when proxy is updated", async () => {
    // Mock getProviderConnectionById and updateProviderConnection
    const mockConnection = {
      id: "conn-123",
      provider: "xiaomi-mimo",
      name: "test@example.com",
      testStatus: "unavailable",
      lastError: "[402]: Paid Model - Credits Required",
      lastErrorAt: "2026-09-25T00:00:00.000Z",
      errorCode: 402,
      rateLimitedUntil: "2026-09-26T00:00:00.000Z",
      backoffLevel: 3,
      modelLock___all: "2026-09-26T10:00:00.000Z",
      "modelLock_mimo-v2.6-flash": "2026-09-26T10:00:00.000Z",
      providerSpecificData: {
        proxyPoolId: "old-pool",
      },
    };

    let updatedPatch = null;

    vi.doMock("@/models", () => ({
      getProviderConnectionById: vi.fn(async () => mockConnection),
      getProxyPoolById: vi.fn(async (id) => ({ id, name: "New Pool", isActive: true })),
      updateProviderConnection: vi.fn(async (id, patch) => {
        updatedPatch = patch;
        return { ...mockConnection, ...patch };
      }),
      deleteProviderConnection: vi.fn(),
    }));

    const { PUT } = await import("../../src/app/api/providers/[id]/route.js");

    const req = new Request("http://localhost/api/providers/conn-123", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proxyPoolId: "new-pool" }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "conn-123" }) });
    expect(res.status).toBe(200);

    // Verify cooldown and errors were reset
    expect(updatedPatch).not.toBeNull();
    expect(updatedPatch.testStatus).toBe("active");
    expect(updatedPatch.lastError).toBeNull();
    expect(updatedPatch.lastErrorAt).toBeNull();
    expect(updatedPatch.errorCode).toBeNull();
    expect(updatedPatch.rateLimitedUntil).toBeNull();
    expect(updatedPatch.backoffLevel).toBe(0);
    expect(updatedPatch.modelLock___all).toBeNull();
    expect(updatedPatch["modelLock_mimo-v2.6-flash"]).toBeNull();
    expect(updatedPatch.providerSpecificData?.proxyPoolId).toBe("new-pool");

    vi.doUnmock("@/models");
  });

  it("POST /api/models/test with allKeys: true runs test across all provider connections", async () => {
    const mockConnections = [
      { id: "conn-1", name: "Key 1", provider: "openai", isActive: true },
      { id: "conn-2", name: "Key 2", provider: "openai", isActive: true },
    ];

    vi.doMock("@/lib/localDb", () => ({
      getProviderConnections: vi.fn(async () => mockConnections),
    }));

    vi.doMock("../../src/app/api/models/test/ping.js", () => ({
      pingModelByKind: vi.fn(async (model, kind, baseUrl, options) => {
        if (options?.connectionId === "conn-1") {
          return { ok: true, latencyMs: 50, status: 200 };
        }
        return { ok: false, error: "HTTP 402: Credits Required", status: 402, latencyMs: 60 };
      }),
    }));

    const { POST } = await import("../../src/app/api/models/test/route.js");

    const req = new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-4o",
        allKeys: true,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.total).toBe(2);
    expect(data.passed).toBe(1);
    expect(data.failed).toBe(1);
    expect(data.results).toHaveLength(2);
    expect(data.results[0].connectionId).toBe("conn-1");
    expect(data.results[0].ok).toBe(true);
    expect(data.results[1].connectionId).toBe("conn-2");
    expect(data.results[1].ok).toBe(false);

    vi.doUnmock("@/lib/localDb");
    vi.doUnmock("../../src/app/api/models/test/ping.js");
  });
});
