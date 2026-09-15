import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const {
  getProviderCredentials,
  isCodexPlusOnlyModel,
  isCodexFreeAccount,
} = await import("@/sse/services/auth.js");

describe("Codex tier-aware helpers", () => {
  it("correctly identifies Plus-only / expensive models", () => {
    expect(isCodexPlusOnlyModel("gpt-5.6-sol")).toBe(true);
    expect(isCodexPlusOnlyModel("cx/gpt-5.6-sol")).toBe(true);
    expect(isCodexPlusOnlyModel("gpt-5.6-sol-review")).toBe(true);
    expect(isCodexPlusOnlyModel("gpt-5.6-terra")).toBe(true);
    expect(isCodexPlusOnlyModel("gpt-5.6-terra-review")).toBe(true);
    expect(isCodexPlusOnlyModel("gpt-6-astra")).toBe(true);
    expect(isCodexPlusOnlyModel("gpt-image-2.5")).toBe(true);
    expect(isCodexPlusOnlyModel("gpt-5.6-luna-image")).toBe(true);

    // Free-compatible models
    expect(isCodexPlusOnlyModel("gpt-5.6-luna")).toBe(false);
    expect(isCodexPlusOnlyModel("gpt-5.6-luna-review")).toBe(false);
    expect(isCodexPlusOnlyModel("gpt-5.5")).toBe(false);
    expect(isCodexPlusOnlyModel("gpt-5.4-mini")).toBe(false);
    expect(isCodexPlusOnlyModel("gpt-5.3-codex-spark")).toBe(false);
    expect(isCodexPlusOnlyModel(null)).toBe(false);
  });

  it("correctly identifies Free-tier accounts", () => {
    expect(isCodexFreeAccount({ providerSpecificData: { chatgptPlanType: "free" } })).toBe(true);
    expect(isCodexFreeAccount({ providerSpecificData: { chatgptPlanType: "plus" } })).toBe(false);
    expect(isCodexFreeAccount({ providerSpecificData: { chatgptPlanType: "pro" } })).toBe(false);
    expect(isCodexFreeAccount({ providerSpecificData: { chatgptPlanType: "team" } })).toBe(false);
    expect(isCodexFreeAccount({ displayName: "Codex Free Account 1" })).toBe(true);
    expect(isCodexFreeAccount({ name: "Personal Free" })).toBe(true);
    expect(isCodexFreeAccount({ name: "Work Account" })).toBe(false);
  });
});

describe("Codex tier-aware routing in getProviderCredentials", () => {
  const freeConn1 = {
    id: "free-1",
    displayName: "Free Account 1",
    priority: 2,
    provider: "codex",
    isActive: true,
    providerSpecificData: { chatgptPlanType: "free" },
  };
  const plusConn1 = {
    id: "plus-1",
    displayName: "Plus Account 1",
    priority: 1, // higher priority, but is Plus
    provider: "codex",
    isActive: true,
    providerSpecificData: { chatgptPlanType: "plus" },
  };
  const freeConn2 = {
    id: "free-2",
    displayName: "Free Account 2",
    priority: 3,
    provider: "codex",
    isActive: true,
    providerSpecificData: { chatgptPlanType: "free" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "fill-first" });
  });

  it("prioritizes Free accounts before Plus accounts for Luna requests", async () => {
    // List returned by DB sorted by priority: plus-1 (priority 1), free-1 (priority 2), free-2 (priority 3)
    mocks.getProviderConnections.mockResolvedValue([plusConn1, freeConn1, freeConn2]);

    const creds = await getProviderCredentials("codex", null, "gpt-5.6-luna");
    expect(creds).not.toBeNull();
    // Even though plusConn1 had priority 1, freeConn1 should be chosen first!
    expect(creds.connectionId).toBe("free-1");
  });

  it("falls back to second Free account when first is excluded", async () => {
    mocks.getProviderConnections.mockResolvedValue([plusConn1, freeConn1, freeConn2]);

    const creds = await getProviderCredentials("codex", new Set(["free-1"]), "gpt-5.6-luna");
    expect(creds).not.toBeNull();
    expect(creds.connectionId).toBe("free-2");
  });

  it("seamlessly falls back to Plus account when all Free accounts are exhausted for Luna", async () => {
    mocks.getProviderConnections.mockResolvedValue([plusConn1, freeConn1, freeConn2]);

    const creds = await getProviderCredentials("codex", new Set(["free-1", "free-2"]), "gpt-5.6-luna");
    expect(creds).not.toBeNull();
    expect(creds.connectionId).toBe("plus-1");
  });

  it("directly routes expensive models (Sol, Terra, Astra) to Plus accounts, skipping Free accounts", async () => {
    mocks.getProviderConnections.mockResolvedValue([freeConn1, freeConn2, plusConn1]);

    const solCreds = await getProviderCredentials("codex", null, "gpt-5.6-sol");
    expect(solCreds).not.toBeNull();
    expect(solCreds.connectionId).toBe("plus-1");

    const terraCreds = await getProviderCredentials("codex", null, "gpt-5.6-terra");
    expect(terraCreds).not.toBeNull();
    expect(terraCreds.connectionId).toBe("plus-1");

    const astraCreds = await getProviderCredentials("codex", null, "gpt-6-astra");
    expect(astraCreds).not.toBeNull();
    expect(astraCreds.connectionId).toBe("plus-1");
  });

  it("does not fall back to Free accounts when Plus accounts are exhausted for expensive models", async () => {
    mocks.getProviderConnections.mockResolvedValue([freeConn1, freeConn2, plusConn1]);

    // Plus-1 is excluded
    const creds = await getProviderCredentials("codex", new Set(["plus-1"]), "gpt-5.6-sol");
    // Free accounts must not be used for Sol!
    expect(creds).toBeNull();
  });
});
