export default {
  id: "modelscope",
  priority: 268,
  alias: "modelscope",
  aliases: [
    "modelscope",
    "modelscope-ai",
    "modelscope.ai",
  ],
  uiAlias: "modelscope",
  display: {
    name: "ModelScope AI",
    icon: "cloud",
    color: "#624AFF",
    textIcon: "MS",
    website: "https://modelscope.ai",
    notice: {
      apiKeyUrl: "https://modelscope.ai/my/myaccesstoken",
    },
  },
  category: "apikey",
  features: {
    usage: false,
  },
  thinkingConfig: {
    options: [
      "auto",
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ],
    defaultMode: "auto",
  },
  transport: {
    baseUrl: "https://api-inference.modelscope.ai/v1/chat/completions",
    validateUrl: "https://api-inference.modelscope.ai/v1/models",
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://api-inference.modelscope.ai/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  models: [
    { id: "deepseek-ai/DeepSeek-V4-Pro", name: "DeepSeek V4 Pro", isFree: true },
    { id: "deepseek-ai/DeepSeek-V4.1-Flash", name: "DeepSeek V4.1 Flash", isFree: true },
    { id: "Qwen-Ambassador/Qwen3.8-Max", name: "Qwen 3.8 Max", isFree: true },
    { id: "Qwen-Ambassador/Qwen3.8-Flash-Next", name: "Qwen 3.8 Flash Next", isFree: true },
    { id: "Qwen/Qwen3.5-397B-A17B", name: "Qwen 3.5 397B A17B", isFree: true },
    { id: "Tencent-Hunyuan/Hy3", name: "Tencent Hy3", isFree: true },
    { id: "MiniMax/MiniMax-M3", name: "MiniMax M3", isFree: true },
    { id: "zai-org/GLM-5.2", name: "GLM 5.2", isFree: true },
    { id: "zai-org/GLM-4.7-Flash", name: "GLM 4.7 Flash", isFree: true },
    { id: "stepfun-ai/Step-3.5-Flash", name: "Step 3.5 Flash", isFree: true },
  ],
  modelsFetcher: { url: "https://api-inference.modelscope.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
