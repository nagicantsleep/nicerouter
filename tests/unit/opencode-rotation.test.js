import { describe, expect, it } from "vitest";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import opencodeRegistry from "../../open-sse/providers/registry/opencode.js";
import { FREE_PROVIDERS } from "@/shared/constants/providers.js";

describe("OpenCode Free Account Rotation & Auth Support", () => {
  it("registry configures opencode with apikey authModes and noAuth public fallback", () => {
    expect(opencodeRegistry.id).toBe("opencode");
    expect(opencodeRegistry.category).toBe("free");
    expect(opencodeRegistry.hasFree).toBe(true);
    expect(opencodeRegistry.noAuth).toBe(true);
    expect(opencodeRegistry.authModes).toEqual(["apikey"]);
    expect(opencodeRegistry.display?.website).toBe("https://opencode.ai/zen");
    expect(opencodeRegistry.display?.notice?.apiKeyUrl).toBe("https://opencode.ai/zen");

    // Check entry generated in FREE_PROVIDERS
    const freeEntry = FREE_PROVIDERS.opencode;
    expect(freeEntry).toBeDefined();
    expect(freeEntry.authModes).toEqual(["apikey"]);
    expect(freeEntry.noAuth).toBe(true);
  });

  describe("OpenCodeExecutor buildHeaders", () => {
    const executor = new OpenCodeExecutor();

    it("uses Bearer public when credentials is empty or undefined", () => {
      const headers = executor.buildHeaders(null);
      expect(headers.Authorization).toBe("Bearer public");
    });

    it("uses Bearer public when credentials accessToken is 'public'", () => {
      const headers = executor.buildHeaders({ id: "noauth", accessToken: "public" });
      expect(headers.Authorization).toBe("Bearer public");
    });

    it("uses Bearer with apiKey when user account credentials have an apiKey", () => {
      const headers = executor.buildHeaders({
        id: "conn-123",
        apiKey: "oc-zen-user-key-alpha",
        name: "Zen Account 1",
      });
      expect(headers.Authorization).toBe("Bearer oc-zen-user-key-alpha");
    });

    it("uses Bearer with accessToken when credentials have custom accessToken", () => {
      const headers = executor.buildHeaders({
        id: "conn-456",
        accessToken: "custom-token-xyz",
        name: "Zen Account 2",
      });
      expect(headers.Authorization).toBe("Bearer custom-token-xyz");
    });

    it("preserves standard x-opencode headers regardless of auth type", () => {
      const headers = executor.buildHeaders({
        apiKey: "oc-test-key",
        rawHeaders: { "user-agent": "custom-agent/1.0" },
      });
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["x-opencode-client"]).toBe("cli");
      expect(headers["x-opencode-session"]).toMatch(/^ses_[0-9a-f]{26}$/);
      expect(headers["x-opencode-request"]).toMatch(/^msg_/);
      expect(headers["x-opencode-project"]).toBe("global");
    });
  });
});
