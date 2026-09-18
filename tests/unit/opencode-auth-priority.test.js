import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn().mockResolvedValue([]),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: vi.fn(),
}));

vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const { getProviderCredentials, markAccountUnavailable } = await import("@/sse/services/auth.js");

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
    mocks.getSettings.mockResolvedValue({ providerStrategies: {} });
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
});
