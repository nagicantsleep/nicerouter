import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fsPromises from "fs/promises";

// Mock next/server
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

// Mock os
vi.mock("os", () => ({
  homedir: vi.fn(() => "/mock/home"),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  access: vi.fn(),
  readFile: vi.fn(),
  constants: { R_OK: 4 },
}));

let GET;

describe("GET /api/oauth/freebuff/auto-import", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../src/app/api/oauth/freebuff/auto-import/route.js");
    GET = mod.GET;
  });

  it("returns not found when no credentials file exists", async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const res = await GET();
    const data = await res.json();

    expect(data.found).toBe(false);
    expect(data.error).toContain("Freebuff credentials file not found");
  });

  it("successfully reads credentials from file", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined);
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      JSON.stringify({
        default: {
          id: "usr_freebuff_123",
          name: "Test Developer",
          email: "dev@example.com",
          authToken: "mock-freebuff-token-xyz",
          fingerprintId: "fp-id-999",
          fingerprintHash: "fp-hash-888",
        },
      })
    );

    const res = await GET();
    const data = await res.json();

    expect(data.found).toBe(true);
    expect(data.authToken).toBe("mock-freebuff-token-xyz");
    expect(data.email).toBe("dev@example.com");
    expect(data.name).toBe("Test Developer");
    expect(data.fingerprintId).toBe("fp-id-999");
  });

  it("handles malformed JSON in credentials file", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined);
    vi.mocked(fsPromises.readFile).mockResolvedValue("INVALID_JSON{");

    const res = await GET();
    const data = await res.json();

    expect(data.found).toBe(false);
    expect(data.error).toContain("Failed to parse JSON credentials");
  });
});
