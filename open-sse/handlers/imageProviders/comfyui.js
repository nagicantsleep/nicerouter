// ComfyUI — local & remote GPU accelerated workflow runner
import { Buffer } from "node:buffer";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const defaultComfyUrl = PROVIDER_MEDIA["comfyui"]?.imageConfig?.baseUrl;
const BASE_URL = (defaultComfyUrl && !defaultComfyUrl.includes("localhost") && !defaultComfyUrl.includes("127.0.0.1"))
  ? defaultComfyUrl
  : "http://100.84.84.5:8188";

function buildQwenWorkflow(promptText, width = 1024, height = 1024, steps = 20, isUncensored = false) {
  const seed = Math.floor(Math.random() * 1000000);
  const unetNode = isUncensored
    ? {
        "inputs": {
          "unet_name": "qwen-image-2.1-UC-Q8_0.gguf"
        },
        "class_type": "UnetLoaderGGUF"
      }
    : {
        "inputs": {
          "unet_name": "qwen_image_2.1_int8_convrot.safetensors",
          "weight_dtype": "default"
        },
        "class_type": "UNETLoader"
      };

  const clipName = isUncensored
    ? "qwen3vl_8b_bf16_heretic.safetensors"
    : "qwen3vl_8b_int8_convrot.safetensors";

  return {
    "1": unetNode,
    "2": {
      "inputs": {
        "clip_name": clipName,
        "type": "qwen_image",
        "device": "default"
      },
      "class_type": "CLIPLoader"
    },
    "3": {
      "inputs": {
        "vae_name": "qwen_image_2.1_vae_bf16.safetensors"
      },
      "class_type": "VAELoader"
    },
    "4": {
      "inputs": {
        "prompt": promptText,
        "negative_prompt": "blurry, distorted, low quality",
        "resolution": Math.max(width, height),
        "clip": ["2", 0]
      },
      "class_type": "TextEncodeQwenImage21"
    },
    "5": {
      "inputs": {
        "width": width,
        "height": height,
        "batch_size": 1
      },
      "class_type": "EmptyLatentImage"
    },
    "6": {
      "inputs": {
        "seed": seed,
        "steps": steps,
        "cfg": 2.5,
        "sampler_name": "euler",
        "scheduler": "simple",
        "denoise": 1.0,
        "model": ["1", 0],
        "positive": ["4", 0],
        "negative": ["4", 1],
        "latent_image": ["5", 0]
      },
      "class_type": "KSampler"
    },
    "7": {
      "inputs": {
        "samples": ["6", 0],
        "vae": ["3", 0]
      },
      "class_type": "VAEDecode"
    },
    "8": {
      "inputs": {
        "filename_prefix": isUncensored ? "9router_QwenImage_UC" : "9router_QwenImage",
        "images": ["7", 0]
      },
      "class_type": "SaveImage"
    }
  };
}

function buildWanWorkflow(promptText, width = 640, height = 368, length = 17, steps = 20) {
  const seed = Math.floor(Math.random() * 1000000);
  return {
    "37": {
      "class_type": "UNETLoader",
      "inputs": {
        "unet_name": "wan2.1_t2v_1.3B_bf16.safetensors",
        "weight_dtype": "default"
      }
    },
    "38": {
      "class_type": "CLIPLoader",
      "inputs": {
        "clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
        "type": "wan",
        "device": "default"
      }
    },
    "39": {
      "class_type": "VAELoader",
      "inputs": {
        "vae_name": "wan_2.1_vae.safetensors"
      }
    },
    "6": {
      "class_type": "CLIPTextEncode",
      "inputs": {
        "text": promptText,
        "clip": ["38", 0]
      }
    },
    "7": {
      "class_type": "CLIPTextEncode",
      "inputs": {
        "text": "blurry, low quality, static",
        "clip": ["38", 0]
      }
    },
    "40": {
      "class_type": "EmptyHunyuanLatentVideo",
      "inputs": {
        "width": width,
        "height": height,
        "length": length,
        "batch_size": 1
      }
    },
    "3": {
      "class_type": "KSampler",
      "inputs": {
        "seed": seed,
        "steps": steps,
        "cfg": 6.0,
        "sampler_name": "uni_pc",
        "scheduler": "simple",
        "denoise": 1.0,
        "model": ["37", 0],
        "positive": ["6", 0],
        "negative": ["7", 0],
        "latent_image": ["40", 0]
      }
    },
    "8": {
      "class_type": "VAEDecode",
      "inputs": {
        "samples": ["3", 0],
        "vae": ["39", 0]
      }
    },
    "28": {
      "class_type": "SaveAnimatedWEBP",
      "inputs": {
        "filename_prefix": "9router_WanVideo",
        "fps": 16,
        "lossless": false,
        "quality": 85,
        "method": "default",
        "images": ["8", 0]
      }
    }
  };
}

export default {
  noAuth: true,
  buildUrl: (_model, credentials) => {
    const raw = credentials?.providerSpecificData?.baseUrl || credentials?.baseUrl || BASE_URL;
    const base = String(raw).replace(/\/+$/, "");
    return `${base}/prompt`;
  },
  buildHeaders: () => ({ "Content-Type": "application/json" }),
  buildBody: (model, body) => {
    if (typeof body.prompt === "object" && body.prompt !== null) {
      return { prompt: body.prompt };
    }
    const promptText = typeof body.prompt === "string" ? body.prompt : String(body.prompt || "");
    const [w, h] = (body.size || "1024x1024").split("x").map(Number);
    const width = w || 1024;
    const height = h || 1024;

    const lowerModel = String(model || "").toLowerCase();
    if (lowerModel.includes("wan")) {
      return { prompt: buildWanWorkflow(promptText, 640, 368, 17, 20) };
    }
    const isUncensored = lowerModel.includes("uncensor") || lowerModel.includes("-uc") || lowerModel.includes("heretic");
    return { prompt: buildQwenWorkflow(promptText, width, height, 20, isUncensored) };
  },
  parseResponse: async (response, ctx) => {
    const resData = await response.json();
    const promptId = resData.prompt_id;
    if (!promptId) {
      throw new Error(resData.error ? JSON.stringify(resData.error) : "Failed to queue ComfyUI prompt");
    }

    const baseUrl = ctx.url.replace(/\/prompt$/, "");
    const maxWaitMs = 120000;
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 1000));
      const histRes = await fetch(`${baseUrl}/history/${promptId}`);
      if (!histRes.ok) continue;
      const history = await histRes.json();
      const promptHistory = history[promptId];
      if (!promptHistory) continue;

      const status = promptHistory.status;
      if (status?.status_str === "error") {
        const msgs = status?.messages?.map((m) => m[1]?.message || m[0]).join("; ") || "ComfyUI execution error";
        throw new Error(`ComfyUI execution failed: ${msgs}`);
      }

      if (status?.completed || promptHistory.outputs) {
        const outputs = promptHistory.outputs || {};
        for (const nodeId of Object.keys(outputs)) {
          const nodeOutput = outputs[nodeId];
          const files = nodeOutput.images || nodeOutput.animated || [];
          if (files.length > 0) {
            const file = files[0];
            const fileUrl = `${baseUrl}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder || "")}&type=${encodeURIComponent(file.type || "output")}`;
            const imgRes = await fetch(fileUrl);
            const arrayBuf = await imgRes.arrayBuffer();
            const b64 = Buffer.from(arrayBuf).toString("base64");
            return {
              created: Math.floor(Date.now() / 1000),
              data: [{ b64_json: b64, url: fileUrl }],
            };
          }
        }
      }
    }
    throw new Error("ComfyUI generation timed out after 120s");
  },
  normalize: (responseBody) => responseBody,
};
