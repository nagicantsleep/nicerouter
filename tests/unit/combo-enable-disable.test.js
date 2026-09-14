import { describe, it, expect } from "vitest";
import {
  isComboModelEnabled,
  getComboModelName,
  getEnabledComboModels,
  getComboModelsFromData,
  handleComboChat,
} from "../../open-sse/services/combo.js";

describe("combo enable/disable model support", () => {
  it("correctly identifies enabled and disabled models", () => {
    expect(isComboModelEnabled("openai/gpt-4o")).toBe(true);
    expect(isComboModelEnabled({ model: "openai/gpt-4o", enabled: true })).toBe(true);
    expect(isComboModelEnabled({ model: "openai/gpt-4o", enabled: false })).toBe(false);
    expect(isComboModelEnabled({ model: "openai/gpt-4o" })).toBe(true);
  });

  it("extracts model name regardless of format", () => {
    expect(getComboModelName("openai/gpt-4o")).toBe("openai/gpt-4o");
    expect(getComboModelName({ model: "openai/gpt-4o", enabled: false })).toBe("openai/gpt-4o");
    expect(getComboModelName({ id: "claude/sonnet", enabled: true })).toBe("claude/sonnet");
  });

  it("filters disabled models from a combo list", () => {
    const rawModels = [
      "openai/gpt-4o",
      { model: "anthropic/claude-3-5-sonnet", enabled: false },
      { model: "google/gemini-2.5-flash", enabled: true },
      { model: "deepseek/deepseek-chat", enabled: false },
    ];

    const enabled = getEnabledComboModels(rawModels);
    expect(enabled).toEqual([
      "openai/gpt-4o",
      "google/gemini-2.5-flash",
    ]);
  });

  it("extracts enabled models using getComboModelsFromData", () => {
    const combos = [
      {
        name: "my-test-combo",
        models: [
          "providerA/model1",
          { model: "providerB/model2", enabled: false },
          { model: "providerC/model3", enabled: true },
        ],
      },
    ];

    const models = getComboModelsFromData("my-test-combo", combos);
    expect(models).toEqual([
      "providerA/model1",
      "providerC/model3",
    ]);
  });

  it("returns empty array if all models are disabled", () => {
    const combos = [
      {
        name: "disabled-combo",
        models: [
          { model: "m1", enabled: false },
          { model: "m2", enabled: false },
        ],
      },
    ];

    const models = getComboModelsFromData("disabled-combo", combos);
    expect(models).toEqual([]);
  });

  it("returns disabled indicator when combo itself is disabled", () => {
    const combos = [
      {
        name: "inactive-combo",
        isActive: false,
        models: ["openai/gpt-4o", "google/gemini-2.5-flash"],
      },
      {
        name: "active-combo",
        isActive: true,
        models: ["openai/gpt-4o"],
      },
    ];

    const inactiveResult = getComboModelsFromData("inactive-combo", combos);
    expect(inactiveResult).toEqual({ disabled: true, combo: combos[0] });

    const activeResult = getComboModelsFromData("active-combo", combos);
    expect(activeResult).toEqual(["openai/gpt-4o"]);
  });

  it("handleComboChat returns 503 error when combo is disabled", async () => {
    const res = await handleComboChat({
      body: {},
      models: { disabled: true },
      handleSingleModel: async () => new Response("ok"),
      log: { info: () => {}, error: () => {} },
      comboName: "my-disabled-combo",
    });

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error.code).toBe("combo_disabled");
    expect(data.error.message).toContain("my-disabled-combo");
  });

  it("handleComboChat returns 503 error when models array is empty", async () => {
    const res = await handleComboChat({
      body: {},
      models: [],
      handleSingleModel: async () => new Response("ok"),
      log: { info: () => {}, error: () => {} },
      comboName: "empty-combo",
    });

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error.code).toBe("combo_all_models_disabled");
  });
});
