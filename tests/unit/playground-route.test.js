import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  handleChat: vi.fn(),
  getSettings: vi.fn(),
  getApiKeys: vi.fn(),
}));

vi.mock("../../src/sse/handlers/chat.js", () => ({
  handleChat: mocks.handleChat,
}));

vi.mock("open-sse/translator/index.js", () => ({
  initTranslators: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getApiKeys: mocks.getApiKeys,
}));

const { POST, OPTIONS } = await import("../../src/app/api/playground/chat/completions/route.js");

describe("Playground Chat Completions Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getApiKeys.mockResolvedValue([{ key: "test-internal-key-123", isActive: true }]);
    mocks.handleChat.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  it("handles OPTIONS CORS preflight", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("forwards POST request to handleChat", async () => {
    const req = new Request("https://router.local/api/playground/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "ds/deepseek-chat", messages: [{ role: "user", content: "hi" }] }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mocks.handleChat).toHaveBeenCalledTimes(1);
  });

  it("injects internal active API key when requireApiKey is true and no Auth header provided", async () => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });

    const req = new Request("https://router.local/api/playground/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "ds/deepseek-chat", messages: [{ role: "user", content: "hi" }] }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mocks.handleChat).toHaveBeenCalledTimes(1);

    const forwardedReq = mocks.handleChat.mock.calls[0][0];
    expect(forwardedReq.headers.get("Authorization")).toBe("Bearer test-internal-key-123");
  });
});
