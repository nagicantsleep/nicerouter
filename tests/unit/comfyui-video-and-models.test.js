import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import comfyuiAdapter, { buildWanWorkflow, buildHunyuanWorkflow } from "open-sse/handlers/videoProviders/comfyui.js";
import { getVideoAdapter } from "open-sse/handlers/videoProviders/index.js";
import { getVideoConfig } from "open-sse/handlers/videoCore.js";
import { PROVIDER_MEDIA } from "open-sse/providers/index.js";
import { getProviderLiveModels } from "@/app/api/providers/[id]/models/route.js";

const originalFetch = global.fetch;

describe("ComfyUI Video Adapter", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("is registered in video adapters index", () => {
    const adapter = getVideoAdapter("comfyui");
    expect(adapter).toBeDefined();
    expect(adapter).toBe(comfyuiAdapter);
  });

  it("has videoConfig in PROVIDER_MEDIA", () => {
    const config = getVideoConfig("comfyui");
    expect(config).toBeDefined();
    expect(config.baseUrl).toContain("8188");
  });

  it("builds Wan 2.1 video workflow with correct structure and dimensions", () => {
    const wf = buildWanWorkflow({
      promptText: "cyberpunk city flying cars",
      negativePrompt: "low quality",
      width: 832,
      height: 480,
      length: 25,
      steps: 30,
      seed: 12345,
      unetName: "wan2.1_t2v_14B_bf16.safetensors",
    });

    expect(wf["37"].class_type).toBe("UNETLoader");
    expect(wf["37"].inputs.unet_name).toBe("wan2.1_t2v_14B_bf16.safetensors");
    expect(wf["38"].class_type).toBe("CLIPLoader");
    expect(wf["39"].class_type).toBe("VAELoader");
    expect(wf["6"].inputs.text).toBe("cyberpunk city flying cars");
    expect(wf["7"].inputs.text).toBe("low quality");
    expect(wf["40"].inputs.width).toBe(832);
    expect(wf["40"].inputs.height).toBe(480);
    expect(wf["40"].inputs.length).toBe(25);
    expect(wf["3"].inputs.steps).toBe(30);
    expect(wf["3"].inputs.seed).toBe(12345);
    expect(wf["28"].class_type).toBe("SaveAnimatedWEBP");
  });

  it("builds Hunyuan video workflow with correct structure", () => {
    const wf = buildHunyuanWorkflow({
      promptText: "ocean waves crashing on rocks",
      width: 640,
      height: 368,
      length: 17,
      steps: 20,
      seed: 999,
    });

    expect(wf["1"].class_type).toBe("UNETLoader");
    expect(wf["1"].inputs.unet_name).toContain("hunyuan_video");
    expect(wf["4"].inputs.text).toBe("ocean waves crashing on rocks");
    expect(wf["7"].inputs.seed).toBe(999);
  });

  it("buildRequest creates generation POST for ComfyUI /prompt endpoint", () => {
    const config = { baseUrl: "http://100.84.84.5:8188" };
    const rawBody = JSON.stringify({
      model: "wan-2.1",
      prompt: "a cat running in the park",
      size: "640x368",
      duration: 3,
    });

    const plan = comfyuiAdapter.buildRequest({
      config,
      action: "generations",
      rawBody,
      contentType: "application/json",
      credentials: null,
    });

    expect(plan.method).toBe("POST");
    expect(plan.url).toBe("http://100.84.84.5:8188/prompt");
    expect(plan.headers["Content-Type"]).toBe("application/json");
    expect(plan.headers.Authorization).toBeDefined(); // Basic auth header from fallback

    const parsed = JSON.parse(plan.body);
    expect(parsed.prompt).toBeDefined();
    expect(parsed.prompt["6"].inputs.text).toBe("a cat running in the park");
  });

  it("buildRequest for GET polls /history/{id}", () => {
    const config = { baseUrl: "http://100.84.84.5:8188" };
    const plan = comfyuiAdapter.buildRequest({
      config,
      action: null,
      requestId: "prompt-uuid-12345",
      credentials: { apiKey: "custom_key" },
    });

    expect(plan.method).toBe("GET");
    expect(plan.url).toBe("http://100.84.84.5:8188/history/prompt-uuid-12345");
  });

  it("transformResponse translates prompt_id to async job shape", () => {
    const res = comfyuiAdapter.transformResponse(
      { prompt_id: "job-abc-123", number: 1 },
      { action: "generations" }
    );

    expect(res.id).toBe("job-abc-123");
    expect(res.request_id).toBe("job-abc-123");
    expect(res.status).toBe("pending");
  });

  it("transformResponse parses completed history output into video object", () => {
    const history = {
      "job-abc-123": {
        status: { completed: true, status_str: "success" },
        outputs: {
          "28": {
            images: [
              { filename: "WanVideo_0001.webp", subfolder: "", type: "output" }
            ]
          }
        }
      }
    };

    const res = comfyuiAdapter.transformResponse(history, {
      requestId: "job-abc-123",
      config: { baseUrl: "http://100.84.84.5:8188" }
    });

    expect(res.status).toBe("completed");
    expect(res.video).toBeDefined();
    expect(res.video.url).toBe("http://100.84.84.5:8188/view?filename=WanVideo_0001.webp&subfolder=&type=output");
    expect(res.video.mime_type).toBe("image/webp");
  });

  it("transformResponse reports failed status on ComfyUI error", () => {
    const history = {
      "job-abc-123": {
        status: {
          status_str: "error",
          messages: [
            ["Execution Error", { message: "CUDA out of memory" }]
          ]
        }
      }
    };

    const res = comfyuiAdapter.transformResponse(history, {
      requestId: "job-abc-123",
      config: { baseUrl: "http://100.84.84.5:8188" }
    });

    expect(res.status).toBe("failed");
    expect(res.error).toContain("CUDA out of memory");
  });
});

describe("ComfyUI Live Model Fetcher", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fetches object_info and categorizes video vs image models", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        UNETLoader: {
          input: {
            required: {
              unet_name: [
                ["wan2.1_t2v_1.3B_bf16.safetensors", "qwen_image_2.1_int8_convrot.safetensors", "flux1-dev.safetensors"]
              ]
            }
          }
        },
        CheckpointLoaderSimple: {
          input: {
            required: {
              ckpt_name: [
                ["sd_xl_base_1.0.safetensors", "hunyuan_video_720_cfgdistill_fp8_e4m3fn.safetensors"]
              ]
            }
          }
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const result = await getProviderLiveModels("comfyui");
    expect(result.error).toBeUndefined();
    expect(result.models).toBeDefined();

    const ids = result.models.map(m => m.id);
    expect(ids).toContain("wan-2.1");
    expect(ids).toContain("hunyuan-video");
    expect(ids).toContain("wan2.1_t2v_1.3B_bf16");
    expect(ids).toContain("qwen_image_2.1_int8_convrot");

    const wanModel = result.models.find(m => m.id === "wan2.1_t2v_1.3B_bf16");
    expect(wanModel.type).toBe("video");

    const fluxModel = result.models.find(m => m.id === "flux1-dev");
    expect(fluxModel.type).toBe("image");
  });

  it("gracefully falls back to static catalog with warning when ComfyUI is unreachable", async () => {
    global.fetch.mockRejectedValueOnce(new Error("Connection refused"));

    const result = await getProviderLiveModels("comfyui");
    expect(result.models.length).toBeGreaterThan(0);
    expect(result.warning).toContain("Cannot connect to ComfyUI");
  });
});
