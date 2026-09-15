import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

import { GithubExecutor, COPILOT_AUTO_MODEL } from "../../open-sse/executors/github.js";
import githubRegistry from "../../open-sse/providers/registry/github.js";
import { HTTP_STATUS } from "../../open-sse/config/runtimeConfig.js";

describe("GitHub Copilot Auto / Student integration", () => {
  const exec = new GithubExecutor();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("defines COPILOT_AUTO_MODEL as goldeneye-free-auto", () => {
    expect(COPILOT_AUTO_MODEL).toBe("goldeneye-free-auto");
  });

  it("exposes auto model in github registry", () => {
    const autoModel = githubRegistry.models.find((m) => m.id === "auto");
    expect(autoModel).toBeDefined();
    expect(autoModel.name).toContain("Auto");
    const goldenEye = githubRegistry.models.find((m) => m.id === "goldeneye-free-auto");
    expect(goldenEye).toBeDefined();
  });

  it("does not classify auto or goldeneye-free-auto as Claude models", () => {
    expect(exec.isClaudeModel("auto")).toBe(false);
    expect(exec.isClaudeModel("goldeneye-free-auto")).toBe(false);
    expect(exec.isClaudeModel("claude-sonnet-4.5")).toBe(true);
  });

  it("excludes auto and goldeneye-free-auto from /responses endpoint", () => {
    expect(exec.supportsResponsesEndpoint("auto")).toBe(false);
    expect(exec.supportsResponsesEndpoint("goldeneye-free-auto")).toBe(false);
  });

  it("transforms request body to use goldeneye-free-auto when model is auto", () => {
    const body = { model: "auto", messages: [{ role: "user", content: "hi" }] };
    const transformed = exec.transformRequest("auto", body, false, {});
    expect(transformed.model).toBe("goldeneye-free-auto");
  });

  it("routes model auto to /chat/completions with goldeneye-free-auto", async () => {
    const baseExecuteSpy = vi
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(exec)), "execute")
      .mockResolvedValue({
        response: new Response(JSON.stringify({ choices: [] }), { status: 200 }),
        via: "chat"
      });

    const result = await exec.execute({
      model: "auto",
      body: { model: "auto", messages: [{ role: "user", content: "hello" }] },
      log: null
    });

    expect(baseExecuteSpy).toHaveBeenCalled();
    const calledOptions = baseExecuteSpy.mock.calls[0][0];
    expect(calledOptions.model).toBe("goldeneye-free-auto");
    expect(calledOptions.body.model).toBe("goldeneye-free-auto");
    expect(result.via).toBe("chat");

    baseExecuteSpy.mockRestore();
  });

  it("gracefully falls back to goldeneye-free-auto when Claude model returns 400 not supported", async () => {
    const fallbackSpy = vi
      .spyOn(exec, "executeWithChatCompletionsFallback")
      .mockResolvedValue({ response: new Response("ok", { status: 200 }), via: "fallback-auto" });

    // Simulate /v1/messages returning 400 model not supported
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: "The requested model is not supported" } }),
        { status: HTTP_STATUS.BAD_REQUEST }
      )
    );

    const result = await exec.executeWithMessagesEndpoint({
      model: "claude-sonnet-4.5",
      body: { messages: [{ role: "user", content: "test" }] },
      credentials: { accessToken: "ghu_dummy" },
      log: null
    });

    expect(fallbackSpy).toHaveBeenCalled();
    expect(result.via).toBe("fallback-auto");

    fallbackSpy.mockRestore();
  });

  it("gracefully falls back to goldeneye-free-auto when chat model returns 400 not supported", async () => {
    // Simulate /chat/completions returning 400 The requested model is not supported
    const errResp = new Response(
      JSON.stringify({ message: "The requested model is not supported" }),
      { status: HTTP_STATUS.BAD_REQUEST }
    );

    const baseExecuteSpy = vi
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(exec)), "execute")
      .mockResolvedValue({
        response: errResp,
        via: "chat"
      });

    const fallbackSpy = vi
      .spyOn(exec, "executeWithChatCompletionsFallback")
      .mockResolvedValue({ response: new Response("ok", { status: 200 }), via: "fallback-auto" });

    // Use gemini model which doesn't support /responses
    const result = await exec.execute({
      model: "gemini-2.5-pro",
      body: { model: "gemini-2.5-pro", messages: [{ role: "user", content: "test" }] },
      log: null
    });

    expect(fallbackSpy).toHaveBeenCalled();
    expect(result.via).toBe("fallback-auto");

    baseExecuteSpy.mockRestore();
    fallbackSpy.mockRestore();
  });
});
