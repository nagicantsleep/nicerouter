// ComfyUI video jobs adapter (Wan 2.1 / Hunyuan / CogVideo / Custom Workflows)
import { Buffer } from "node:buffer";

const DEFAULT_COMFY_BASE_URL = "http://100.84.84.5:8188";

function getBaseUrl(config, credentials) {
  const raw = credentials?.providerSpecificData?.baseUrl || credentials?.baseUrl || config?.baseUrl || DEFAULT_COMFY_BASE_URL;
  return String(raw).replace(/\/+$/, "");
}

function getAuthHeaders(credentials) {
  const headers = { Accept: "application/json" };
  const auth = credentials?.apiKey || "naggidev:123123a@";
  if (auth) {
    const basic = auth.includes(":")
      ? Buffer.from(auth).toString("base64")
      : (auth.startsWith("Basic ") ? auth.slice(6) : Buffer.from(`naggidev:${auth}`).toString("base64"));
    headers["Authorization"] = `Basic ${basic}`;
  }
  return headers;
}

export function buildWanWorkflow({
  promptText,
  negativePrompt = "blurry, low quality, static, distorted",
  width = 640,
  height = 368,
  length = 17,
  steps = 20,
  seed = null,
  unetName = "wan2.1_t2v_1.3B_bf16.safetensors",
}) {
  const finalSeed = seed != null ? Number(seed) : Math.floor(Math.random() * 10000000);
  return {
    "37": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: unetName,
        weight_dtype: "default",
      },
    },
    "38": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
        type: "wan",
        device: "default",
      },
    },
    "39": {
      class_type: "VAELoader",
      inputs: {
        vae_name: "wan_2.1_vae.safetensors",
      },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: promptText,
        clip: ["38", 0],
      },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: negativePrompt,
        clip: ["38", 0],
      },
    },
    "40": {
      class_type: "EmptyHunyuanLatentVideo",
      inputs: {
        width,
        height,
        length,
        batch_size: 1,
      },
    },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: finalSeed,
        steps,
        cfg: 6.0,
        sampler_name: "uni_pc",
        scheduler: "simple",
        denoise: 1.0,
        model: ["37", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["40", 0],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["39", 0],
      },
    },
    "28": {
      class_type: "SaveAnimatedWEBP",
      inputs: {
        filename_prefix: "9router_WanVideo",
        fps: 16,
        lossless: false,
        quality: 85,
        method: "default",
        images: ["8", 0],
      },
    },
  };
}

export function buildHunyuanWorkflow({
  promptText,
  negativePrompt = "blurry, low quality, static",
  width = 640,
  height = 368,
  length = 17,
  steps = 20,
  seed = null,
}) {
  const finalSeed = seed != null ? Number(seed) : Math.floor(Math.random() * 10000000);
  return {
    "1": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "hunyuan_video_720_cfgdistill_fp8_e4m3fn.safetensors",
        weight_dtype: "default",
      },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "llava_llama3_fp8_scaled.safetensors",
        type: "hunyuan_video",
        device: "default",
      },
    },
    "3": {
      class_type: "VAELoader",
      inputs: {
        vae_name: "hunyuan_video_vae_bf16.safetensors",
      },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: promptText,
        clip: ["2", 0],
      },
    },
    "5": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: negativePrompt,
        clip: ["2", 0],
      },
    },
    "6": {
      class_type: "EmptyHunyuanLatentVideo",
      inputs: {
        width,
        height,
        length,
        batch_size: 1,
      },
    },
    "7": {
      class_type: "KSampler",
      inputs: {
        seed: finalSeed,
        steps,
        cfg: 6.0,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1.0,
        model: ["1", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["6", 0],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["7", 0],
        vae: ["3", 0],
      },
    },
    "9": {
      class_type: "SaveAnimatedWEBP",
      inputs: {
        filename_prefix: "9router_HunyuanVideo",
        fps: 16,
        lossless: false,
        quality: 85,
        method: "default",
        images: ["8", 0],
      },
    },
  };
}

export default {
  buildRequest({ config, action, requestId, rawBody, contentType, credentials }) {
    const base = getBaseUrl(config, credentials);
    const headers = getAuthHeaders(credentials);

    if (requestId) {
      // GET poll: fetch history for the prompt_id
      return {
        method: "GET",
        url: `${base}/history/${encodeURIComponent(requestId)}`,
        headers,
      };
    }

    if (action !== "generations") {
      return { error: `ComfyUI video supports 'generations' only (got '${action}')` };
    }

    let parsedBody = {};
    if (rawBody) {
      try {
        parsedBody = typeof rawBody === "string" ? JSON.parse(rawBody) : JSON.parse(rawBody.toString("utf8"));
      } catch {
        return { error: "Invalid JSON body for ComfyUI video request" };
      }
    }

    // Direct workflow object support
    if (typeof parsedBody.prompt === "object" && parsedBody.prompt !== null) {
      return {
        method: "POST",
        url: `${base}/prompt`,
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: parsedBody.prompt }),
      };
    }

    const promptText = typeof parsedBody.prompt === "string" ? parsedBody.prompt : "";
    if (!promptText) {
      return { error: "Missing prompt for video generation" };
    }

    // Parse dimensions (must be multiple of 16 for Wan / Hunyuan VAE)
    const [rawW, rawH] = (parsedBody.size || "640x368").split("x").map(Number);
    const width = Math.max(256, Math.min(1920, Math.round((rawW || 640) / 16) * 16));
    const height = Math.max(256, Math.min(1920, Math.round((rawH || 368) / 16) * 16));

    // Parse length (number of frames). Wan 2.1 requires 4n + 1 frames (e.g. 17, 33, 49, 65, 81)
    let rawLength = 17;
    if (parsedBody.length) rawLength = Number(parsedBody.length);
    else if (parsedBody.duration) rawLength = Math.max(9, Math.min(81, Math.round(Number(parsedBody.duration) * 16)));
    else if (parsedBody.seconds) rawLength = Math.max(9, Math.min(81, Math.round(Number(parsedBody.seconds) * 16)));

    const n = Math.max(1, Math.round((rawLength - 1) / 4));
    const length = Math.min(81, n * 4 + 1);

    const steps = Number(parsedBody.steps) || 20;
    const seed = parsedBody.seed != null ? parsedBody.seed : null;
    const negativePrompt = parsedBody.negative_prompt || "blurry, low quality, static, distorted";

    const modelName = String(parsedBody.model || "").toLowerCase();

    let workflow;
    if (modelName.includes("hunyuan")) {
      workflow = buildHunyuanWorkflow({ promptText, negativePrompt, width, height, length, steps, seed });
    } else {
      let unetName = "wan2.1_t2v_1.3B_bf16.safetensors";
      if (modelName.endsWith(".safetensors") || modelName.endsWith(".gguf")) {
        unetName = parsedBody.model;
      } else if (modelName.includes("14b") || modelName.includes("14-b")) {
        unetName = modelName.includes("fp8")
          ? "wan2.1_t2v_14B_fp8_e4m3fn.safetensors"
          : "wan2.1_t2v_14B_bf16.safetensors";
      } else if (modelName.includes("fp8")) {
        unetName = "wan2.1_t2v_1.3B_fp8_e4m3fn.safetensors";
      }
      workflow = buildWanWorkflow({ promptText, negativePrompt, width, height, length, steps, seed, unetName });
    }

    return {
      method: "POST",
      url: `${base}/prompt`,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
    };
  },

  transformResponse(json, ctx = {}) {
    // Case 1: Response from POST /prompt -> contains prompt_id
    if (json?.prompt_id) {
      const id = json.prompt_id;
      return {
        id,
        request_id: id,
        status: "pending",
        created: Math.floor(Date.now() / 1000),
      };
    }

    // Case 2: Response from GET /history/{requestId}
    const requestId = ctx.requestId;
    const base = getBaseUrl(ctx.config, ctx.credentials);

    const promptHistory = (requestId && json?.[requestId]) ? json[requestId] : (json && typeof json === "object" ? Object.values(json)[0] : null);

    if (!promptHistory) {
      return {
        id: requestId,
        request_id: requestId,
        status: "pending",
      };
    }

    // Check for execution error
    if (promptHistory.status?.status_str === "error") {
      const msgs = promptHistory.status?.messages?.map((m) => m[1]?.message || m[0]).join("; ") || "ComfyUI execution failed";
      return {
        id: requestId,
        request_id: requestId,
        status: "failed",
        error: msgs,
      };
    }

    // Check for completed outputs
    const outputs = promptHistory.outputs || {};
    let matchedFile = null;

    for (const nodeId of Object.keys(outputs)) {
      const nodeOutput = outputs[nodeId];
      const files = nodeOutput.videos || nodeOutput.animated || nodeOutput.gifs || nodeOutput.images || [];
      if (files.length > 0) {
        matchedFile = files[0];
        break;
      }
    }

    if (matchedFile) {
      const filename = matchedFile.filename || "";
      const subfolder = matchedFile.subfolder || "";
      const type = matchedFile.type || "output";
      const fileUrl = `${base}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;

      const isMp4 = filename.toLowerCase().endsWith(".mp4");
      const isWebp = filename.toLowerCase().endsWith(".webp");
      const isGif = filename.toLowerCase().endsWith(".gif");
      const mimeType = isMp4 ? "video/mp4" : isWebp ? "image/webp" : isGif ? "image/gif" : "video/webm";

      return {
        id: requestId,
        request_id: requestId,
        status: "completed",
        video: {
          url: fileUrl,
          mime_type: mimeType,
        },
        videos: [
          {
            url: fileUrl,
            mime_type: mimeType,
          },
        ],
      };
    }

    if (promptHistory.status?.completed) {
      return {
        id: requestId,
        request_id: requestId,
        status: "completed",
        video: null,
        videos: [],
      };
    }

    return {
      id: requestId,
      request_id: requestId,
      status: "in_progress",
    };
  },
};
