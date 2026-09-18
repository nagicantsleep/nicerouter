import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  pickProxyPoolId: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: mocks.getProxyPools,
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: mocks.pickProxyPoolId,
}));

vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const { getProviderCredentials, markAccountUnavailable, resetProxyRateLimits } = await import("@/sse/services/auth.js");

describe("OpenCode Free Pool priority before Key Pool", () => {
  const userZenKeyAccount = {
    id: "zen-conn-1",
    connectionName: "My Personal Zen Key",
    provider: "opencode",
    isActive: true,
    apiKey: "oc-zen-personal-key-12345",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetProxyRateLimits();
    mocks.getSettings.mockResolvedValue({ providerStrategies: {} });
    mocks.getProxyPools.mockResolvedValue([]);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
      proxyPoolId: null,
      vercelRelayUrl: "",
    });
    mocks.getProviderConnections.mockResolvedValue([userZenKeyAccount]);
  });

  it("prioritizes Public Free Pool first even when user has personal Zen keys", async () => {
    const creds = await getProviderCredentials("opencode", null, "muse-spark-1.3-contributor-free");

    expect(creds).toBeDefined();
    expect(creds.id).toBe("noauth");
    expect(creds.connectionId).toBe("noauth");
    expect(creds.accessToken).toBe("public");
    expect(creds.apiKey).toBeUndefined();
  });

  it("falls back to user Key Pool when noauth is excluded (e.g. rate-limited/failed)", async () => {
    const creds = await getProviderCredentials(
      "opencode",
      new Set(["noauth"]),
      "muse-spark-1.3-contributor-free"
    );

    expect(creds).toBeDefined();
    expect(creds.connectionId).toBe("zen-conn-1");
    expect(creds.apiKey).toBe("oc-zen-personal-key-12345");
  });

  it("markAccountUnavailable returns shouldFallback: true on noauth rate limit (429)", async () => {
    const res = await markAccountUnavailable("noauth", 429, "Rate limit exceeded", "opencode", "mimo-v2.5-free");
    expect(res.shouldFallback).toBe(true);
  });

  it("respects preferredConnectionId if a specific user connection is explicitly requested", async () => {
    const creds = await getProviderCredentials(
      "opencode",
      null,
      "muse-spark-1.3-contributor-free",
      { preferredConnectionId: "zen-conn-1" }
    );

    expect(creds).toBeDefined();
    expect(creds.connectionId).toBe("zen-conn-1");
    expect(creds.apiKey).toBe("oc-zen-personal-key-12345");
  });

  describe("Proxy pool auto-failover on rate limit for noauth", () => {
    const pool1 = { id: "pool-1", name: "Pool Alpha", proxyUrl: "http://alpha:8080", isActive: true };
    const pool2 = { id: "pool-2", name: "Pool Beta", proxyUrl: "http://beta:8080", isActive: true };

    beforeEach(() => {
      mocks.getProxyPools.mockResolvedValue([pool1, pool2]);
      mocks.getSettings.mockResolvedValue({
        providerStrategies: {
          opencode: {
            proxyPoolId: "pool-1",
            rotateStrategy: "none",
          },
        },
      });
      mocks.resolveConnectionProxyConfig.mockImplementation(async ({ proxyPoolId }) => ({
        connectionProxyEnabled: !!proxyPoolId,
        connectionProxyUrl: proxyPoolId === "pool-1" ? pool1.proxyUrl : pool2.proxyUrl,
        connectionNoProxy: "",
        proxyPoolId,
        vercelRelayUrl: "",
      }));
    });

    it("starts with configured proxy pool (pool-1)", async () => {
      const creds = await getProviderCredentials("opencode", null, "mimo-v2.5-free");
      expect(creds).toBeDefined();
      expect(creds.connectionId).toBe("noauth:pool-1");
      expect(creds.connectionName).toContain("Pool Alpha");
      expect(creds.providerSpecificData.connectionProxyPoolId).toBe("pool-1");
    });

    it("automatically switches to pool-2 when pool-1 hits 429 and is excluded in retry loop", async () => {
      // Step 1: Request with pool-1 fails with 429
      const res = await markAccountUnavailable("noauth:pool-1", 429, "Rate limit reached", "opencode", "mimo-v2.5-free");
      expect(res.shouldFallback).toBe(true);

      // Step 2: Next retry excludes noauth:pool-1
      const excludeSet = new Set(["noauth:pool-1"]);
      const nextCreds = await getProviderCredentials("opencode", excludeSet, "mimo-v2.5-free");

      expect(nextCreds).toBeDefined();
      expect(nextCreds.connectionId).toBe("noauth:pool-2");
      expect(nextCreds.connectionName).toContain("Pool Beta");
      expect(nextCreds.providerSpecificData.connectionProxyPoolId).toBe("pool-2");
    });

    it("switches to Direct connection when all proxy pools are rate-limited", async () => {
      // Pool 1 and Pool 2 are both excluded
      const excludeSet = new Set(["noauth:pool-1", "noauth:pool-2"]);
      const directCreds = await getProviderCredentials("opencode", excludeSet, "mimo-v2.5-free");

      expect(directCreds).toBeDefined();
      expect(directCreds.connectionId).toBe("noauth:__direct__");
      expect(directCreds.connectionName).toContain("Direct");
      expect(directCreds.providerSpecificData.connectionProxyEnabled).toBe(false);
    });

    it("skips rate-limited proxy in subsequent requests due to active cooldown", async () => {
      // Mark pool-1 as rate-limited with cooldown
      await markAccountUnavailable("noauth:pool-1", 429, "Rate limit reached", "opencode", "mimo-v2.5-free");

      // A fresh request (without excludeSet) should automatically skip pool-1 and pick pool-2
      const freshCreds = await getProviderCredentials("opencode", null, "mimo-v2.5-free");
      expect(freshCreds).toBeDefined();
      expect(freshCreds.connectionId).toBe("noauth:pool-2");
    });

    it("falls back to user keys when all proxy pools and direct are exhausted", async () => {
      const excludeSet = new Set(["noauth:pool-1", "noauth:pool-2", "noauth:__direct__"]);
      const keyCreds = await getProviderCredentials("opencode", excludeSet, "mimo-v2.5-free");

      expect(keyCreds).toBeDefined();
      expect(keyCreds.connectionId).toBe("zen-conn-1");
      expect(keyCreds.apiKey).toBe("oc-zen-personal-key-12345");
    });
  });
});
