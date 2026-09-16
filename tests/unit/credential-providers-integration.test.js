import { describe, it, expect } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("Credential Providers Integration (B.AI, OrcaRouter, Atria ASI)", () => {
  it("registry has modelsFetcher and passthroughModels for bai, orca, and atria", () => {
    const bai = REGISTRY.find((e) => e.id === "bai");
    expect(bai).toBeDefined();
    expect(bai.passthroughModels).toBe(true);
    expect(bai.modelsFetcher).toMatchObject({
      url: "https://api.b.ai/v1/models",
      type: "openai",
    });

    const orca = REGISTRY.find((e) => e.id === "orca");
    expect(orca).toBeDefined();
    expect(orca.passthroughModels).toBe(true);
    expect(orca.modelsFetcher).toMatchObject({
      url: "https://api.orcarouter.ai/v1/models",
      type: "openai",
    });

    const atria = REGISTRY.find((e) => e.id === "atria");
    expect(atria).toBeDefined();
    expect(atria.passthroughModels).toBe(true);
    expect(atria.modelsFetcher).toMatchObject({
      url: "https://api.atria-asi.ai/v1/models",
      type: "openai",
    });

    const modelscope = REGISTRY.find((e) => e.id === "modelscope");
    expect(modelscope).toBeDefined();
    expect(modelscope.passthroughModels).toBe(true);
    expect(modelscope.modelsFetcher).toMatchObject({
      url: "https://api-inference.modelscope.ai/v1/models",
      type: "openai",
    });

    const onerouter = REGISTRY.find((e) => e.id === "onerouter");
    expect(onerouter).toBeDefined();
    expect(onerouter.passthroughModels).toBe(true);
    expect(onerouter.modelsFetcher).toMatchObject({
      url: "https://llm.onerouter.pro/v1/models",
      type: "openai",
    });
  });

  it("orca registry includes free models", () => {
    const orca = REGISTRY.find((e) => e.id === "orca");
    const freeModels = orca.models.filter((m) => m.isFree);
    const freeIds = freeModels.map((m) => m.id);
    expect(freeIds).toContain("orcarouter/free");
    expect(freeIds).toContain("deepseek/deepseek-v4-flash-free");
    expect(freeIds).toContain("tencent/hy3-free");
    expect(freeIds).toContain("z-ai/glm-5.3-flash-free");
  });

  it("bai registry includes working free models", () => {
    const bai = REGISTRY.find((e) => e.id === "bai");
    const freeModels = bai.models.filter((m) => m.isFree);
    const freeIds = freeModels.map((m) => m.id);
    expect(freeIds).toContain("hy3");
    expect(freeIds).toContain("qwen3.8-flash");
    expect(freeIds).toContain("mimo-v2.5");
  });

  it("atria registry includes Atria-Dawn-Preview as free model", () => {
    const atria = REGISTRY.find((e) => e.id === "atria");
    const freeModels = atria.models.filter((m) => m.isFree);
    expect(freeModels.map((m) => m.id)).toContain("Atria-Dawn-Preview");
  });

  it("DefaultExecutor builds correct headers and URL for bai, orca, and atria", () => {
    const baiExec = new DefaultExecutor("bai");
    const baiHeaders = baiExec.buildHeaders({ apiKey: "sk-bai-test" });
    expect(baiHeaders.Authorization).toBe("Bearer sk-bai-test");
    expect(baiExec.buildUrl("hy3", false)).toBe("https://api.b.ai/v1/chat/completions");

    const orcaExec = new DefaultExecutor("orca");
    const orcaHeaders = orcaExec.buildHeaders({ apiKey: "sk-orca-test" });
    expect(orcaHeaders.Authorization).toBe("Bearer sk-orca-test");
    expect(orcaExec.buildUrl("orcarouter/free", false)).toBe("https://api.orcarouter.ai/v1/chat/completions");

    const atriaExec = new DefaultExecutor("atria");
    const atriaHeaders = atriaExec.buildHeaders({ apiKey: "atr_test" });
    expect(atriaHeaders.Authorization).toBe("Bearer atr_test");
    expect(atriaExec.buildUrl("Atria-Dawn-Preview", false)).toBe("https://api.atria-asi.ai/v1/chat/completions");

    const msExec = new DefaultExecutor("modelscope");
    const msHeaders = msExec.buildHeaders({ apiKey: "ms-test-key" });
    expect(msHeaders.Authorization).toBe("Bearer ms-test-key");
    expect(msExec.buildUrl("deepseek-ai/DeepSeek-V4-Pro", false)).toBe("https://api-inference.modelscope.ai/v1/chat/completions");

    const oneExec = new DefaultExecutor("onerouter");
    const oneHeaders = oneExec.buildHeaders({ apiKey: "sk-onerouter-test" });
    expect(oneHeaders.Authorization).toBe("Bearer sk-onerouter-test");
    expect(oneExec.buildUrl("deepseek/deepseek-v4-flash:free", false)).toBe("https://llm.onerouter.pro/v1/chat/completions");

    const wrExec = new DefaultExecutor("wusrouter");
    const wrHeaders = wrExec.buildHeaders({ apiKey: "sk-wus-test" });
    expect(wrHeaders.Authorization).toBe("Bearer sk-wus-test");
    expect(wrExec.buildUrl("agnes-3.0-flash", false)).toBe("https://api.wusrouter.com/v1/chat/completions");

    const wrAliasExec = new DefaultExecutor("wr");
    expect(wrAliasExec.buildUrl("agnes-3.0-flash", false)).toBe("https://api.wusrouter.com/v1/chat/completions");
  });

  it("wusrouter registry has alias wr, modelsFetcher and passthroughModels", () => {
    const wr = REGISTRY.find((e) => e.id === "wusrouter");
    expect(wr).toBeDefined();
    expect(wr.alias).toBe("wr");
    expect(wr.aliases).toContain("wr");
    expect(wr.passthroughModels).toBe(true);
    expect(wr.modelsFetcher).toMatchObject({
      url: "https://api.wusrouter.com/v1/models",
      type: "openai",
    });
  });
});
