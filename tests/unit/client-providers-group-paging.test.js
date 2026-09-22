import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
}));

vi.mock("../../src/lib/oauth/providers", () => ({
  backfillCodexEmails: vi.fn().mockResolvedValue(undefined),
}));

import { GET } from "../../src/app/api/providers/client/route.js";
import { getProviderConnections } from "../../src/lib/localDb";

describe("GET /api/providers/client group paging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockConnections = [
    { id: "c1", provider: "claude", authType: "oauth", isActive: true, priority: 1, name: "Claude 1" },
    { id: "c2", provider: "claude", authType: "oauth", isActive: true, priority: 2, name: "Claude 2" },
    { id: "x1", provider: "codex", authType: "oauth", isActive: true, priority: 1, name: "Codex 1" },
    { id: "x2", provider: "codex", authType: "oauth", isActive: true, priority: 2, name: "Codex 2" },
    { id: "g1", provider: "deepseek", authType: "oauth", isActive: true, priority: 1, name: "DeepSeek 1" },
    { id: "k1", provider: "kiro", authType: "oauth", isActive: true, priority: 1, name: "Kiro 1" },
  ];

  it("paginates by provider groups when groupBy=provider is specified", async () => {
    getProviderConnections.mockResolvedValueOnce(mockConnections);

    // Page 1 with pageSize 2 providers
    const req = new Request("http://localhost:20128/api/providers/client?groupBy=provider&page=1&pageSize=2");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.pagination.groupBy).toBe("provider");
    expect(data.pagination.page).toBe(1);
    expect(data.pagination.pageSize).toBe(2);
    expect(data.pagination.total).toBe(4); // 4 unique providers: claude, codex, gemini, kiro
    expect(data.pagination.totalPages).toBe(2);
    expect(data.pagination.totalConnections).toBe(6);

    // Page 1 should contain all accounts for first 2 providers (claude, codex)
    const returnedProviders = Array.from(new Set(data.connections.map((c) => c.provider)));
    expect(returnedProviders).toHaveLength(2);
    expect(returnedProviders).toEqual(["claude", "codex"]);
    expect(data.connections).toHaveLength(4); // 2 claude + 2 codex
  });

  it("returns the next page of provider groups on page 2", async () => {
    getProviderConnections.mockResolvedValueOnce(mockConnections);

    const req = new Request("http://localhost:20128/api/providers/client?groupBy=provider&page=2&pageSize=2");
    const res = await GET(req);
    const data = await res.json();

    expect(data.pagination.page).toBe(2);
    const returnedProviders = Array.from(new Set(data.connections.map((c) => c.provider)));
    expect(returnedProviders).toHaveLength(2);
    expect(returnedProviders).toEqual(["deepseek", "kiro"]);
    expect(data.connections).toHaveLength(2); // 1 deepseek + 1 kiro
  });

  it("maintains default flat connection pagination when groupBy is not specified", async () => {
    getProviderConnections.mockResolvedValueOnce(mockConnections);

    const req = new Request("http://localhost:20128/api/providers/client?page=1&pageSize=3");
    const res = await GET(req);
    const data = await res.json();

    expect(data.pagination.groupBy).toBeUndefined();
    expect(data.pagination.total).toBe(6); // 6 total connections
    expect(data.pagination.pageSize).toBe(3);
    expect(data.connections).toHaveLength(3);
  });
});
