import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

import { GithubExecutor, COPILOT_AUTO_MODEL, isCopilotAutoModel } from "../../open-sse/executors/github.js";
import githubRegistry from "../../open-sse/providers/registry/github.js";
import { HTTP_STATUS } from "../../open-sse/config/runtimeConfig.js";

describe("GitHub Copilot Auto / Student integration", () => {
  const exec = new GithubExecutor();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("defines COPILOT_AUTO_MODEL as gpt-4.1", () => {
    expect(COPILOT_AUTO_MODEL).toBe("gpt-4.1");
    expect(isCopilotAutoModel("auto")).toBe(true);
    expect(isCopilotAutoModel("goldeneye-free-auto")).toBe(true);
    expect(isCopilotAutoModel("gpt-4.1")).toBe(true);
    expect(isCopilotAutoModel("claude-sonnet-4.5")).toBe(false);
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
    expect(exec.isClaudeModel("gpt-4.1")).toBe(false);
    expect(exec.isClaudeModel("claude-sonnet-4.5")).toBe(true);
  });

  it("excludes auto and goldeneye-free-auto from /responses endpoint", () => {
    expect(exec.supportsResponsesEndpoint("auto")).toBe(false);
    expect(exec.supportsResponsesEndpoint("goldeneye-free-auto")).toBe(false);
    expect(exec.supportsResponsesEndpoint("gpt-4.1")).toBe(false);
  });

  it("transforms request body to use gpt-4.1 when model is auto or goldeneye-free-auto", () => {
    const body = { model: "auto", messages: [{ role: "user", content: "hi" }] };
    const transformed = exec.transformRequest("auto", body, false, {});
    expect(transformed.model).toBe("gpt-4.1");

    const bodyGolden = { model: "goldeneye-free-auto", messages: [{ role: "user", content: "hi" }] };
    const transformedGolden = exec.transformRequest("goldeneye-free-auto", bodyGolden, false, {});
    expect(transformedGolden.model).toBe("gpt-4.1");
  });

  it("routes model auto to /chat/completions with gpt-4.1", async () => {
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
    expect(calledOptions.model).toBe("gpt-4.1");
    expect(calledOptions.body.model).toBe("gpt-4.1");
    expect(result.via).toBe("chat");

    baseExecuteSpy.mockRestore();
  });

  it("gracefully falls back to gpt-4.1 when Claude model returns 400 not supported", async () => {
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

  it("gracefully falls back to gpt-4.1 when chat model returns 400 not supported", async () => {
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

  it("actually executes fallback with gpt-4.1 using real method", async () => {
    const baseExecuteSpy = vi
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(exec)), "execute")
      .mockResolvedValue({
        response: new Response(JSON.stringify({ choices: [] }), { status: 200 }),
        via: "fallback-resolved"
      });

    const result = await exec.executeWithChatCompletionsFallback({
      model: "claude-sonnet-4.5",
      body: { model: "claude-sonnet-4.5", messages: [{ role: "user", content: "test" }] },
      log: null
    });

    expect(baseExecuteSpy).toHaveBeenCalled();
    const calledOptions = baseExecuteSpy.mock.calls[0][0];
    expect(calledOptions.model).toBe("gpt-4.1");
    expect(calledOptions.body.model).toBe("gpt-4.1");
    expect(result.via).toBe("fallback-resolved");

    baseExecuteSpy.mockRestore();
  });

  it("falls back to gpt-4.1 on 403 Forbidden not supported (student plan)", async () => {
    const fallbackSpy = vi
      .spyOn(exec, "executeWithChatCompletionsFallback")
      .mockResolvedValue({ response: new Response("ok", { status: 200 }), via: "fallback-auto" });

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: "Model is not available on your plan" } }),
        { status: 403 }
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
});
