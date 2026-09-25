import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/localDb", () => ({
  getProviderConnections: vi.fn().mockResolvedValue([]),
  getCombos: vi.fn().mockResolvedValue([
    {
      id: "combo-chat-1",
      name: "smart-chat",
      kind: null,
      models: ["claude-3-5-sonnet", "gpt-4o"],
      isActive: true,
    },
    {
      id: "combo-jev-1",
      name: "jev-latest",
      kind: "systemone",
      models: ["oc/jev-1.13-free", "typesafe/jev-latest"],
      isActive: true,
    },
    {
      id: "combo-img-1",
      name: "image-fast",
      kind: "image",
      models: ["bfl/flux-pro", "openai/dall-e-3"],
      isActive: true,
    },
  ]),
  getCustomModels: vi.fn().mockResolvedValue([]),
  getModelAliases: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/lib/deletedModelsDb", () => ({
  getDeletedModels: vi.fn().mockResolvedValue({}),
}));

import { buildModelsList, GET as GET_MODELS } from "../../src/app/api/v1/models/route.js";
import { GET as GET_MODEL_PATH } from "../../src/app/api/v1/models/[...model]/route.js";

describe("Non-chat combo isolation and routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("buildModelsList(['llm']) includes chat combo but excludes non-chat combos (systemone, image)", async () => {
    const llmModels = await buildModelsList(["llm"]);
    const modelIds = llmModels.map((m) => m.id);

    expect(modelIds).toContain("smart-chat");
    expect(modelIds).not.toContain("jev-latest");
    expect(modelIds).not.toContain("image-fast");
  });

  it("GET /v1/models (called by coding CLIs) does not list jev-latest or image-fast", async () => {
    const res = await GET_MODELS(new Request("https://router.test/v1/models"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.data.map((m) => m.id);

    expect(ids).toContain("smart-chat");
    expect(ids).not.toContain("jev-latest");
    expect(ids).not.toContain("image-fast");
  });

  it("buildModelsList(['systemone']) returns only systemone combos and models", async () => {
    const sys1Models = await buildModelsList(["systemone"]);
    const modelIds = sys1Models.map((m) => m.id);

    expect(modelIds).toContain("jev-latest");
    expect(modelIds).not.toContain("smart-chat");
    expect(modelIds).not.toContain("image-fast");
  });

  it("GET /v1/models/systemone returns systemone combo list", async () => {
    const res = await GET_MODEL_PATH(
      new Request("https://router.test/v1/models/systemone"),
      { params: Promise.resolve({ model: ["systemone"] }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");
    const ids = body.data.map((m) => m.id);
    expect(ids).toContain("jev-latest");
  });

  it("GET /v1/models/image returns image combo list", async () => {
    const res = await GET_MODEL_PATH(
      new Request("https://router.test/v1/models/image"),
      { params: Promise.resolve({ model: ["image"] }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");
    const ids = body.data.map((m) => m.id);
    expect(ids).toContain("image-fast");
    expect(ids).not.toContain("jev-latest");
  });
});
