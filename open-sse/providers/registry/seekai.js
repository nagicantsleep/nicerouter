export default {
  id: "seekai",
  priority: 262,
  alias: "seekai",
  aliases: [
    "sk",
  ],
  uiAlias: "sk",
  display: {
    name: "SeekAI",
    icon: "neurology",
    color: "#6366F1",
    textIcon: "SK",
    website: "https://seekai.cc",
    notice: {
      apiKeyUrl: "https://seekai.cc",
    },
  },
  category: "apikey",
  thinkingConfig: {
    options: [
      "auto",
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ],
    defaultMode: "auto",
  },
  transport: {
    baseUrl: "https://seekai.cc/v1/chat/completions",
    validateUrl: "https://seekai.cc/v1/models",
    headers: {
      "User-Agent": "Cline/3.0.0",
    },
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://seekai.cc/v1/chat/completions",
      headers: { "User-Agent": "Cline/3.0.0" },
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://seekai.cc/v1/messages",
      headers: { "User-Agent": "Cline/3.0.0" },
      auth: { combined: true, header: "Authorization", scheme: "bearer", anthropicVersion: true },
    },
  ],
  models: [
    { id: "deepseek-ai/DeepSeek-V4-Flash-0731", name: "DeepSeek V4 Flash 0731" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-pro-0813", name: "DeepSeek V4 Pro 0813" },
    { id: "grok-4.6", name: "Grok 4.6" },
    { id: "glm-5.3", name: "GLM 5.3" },
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash" },
    { id: "qwen3.8-flash", name: "Qwen 3.8 Flash" },
    { id: "gemma-4-31b", name: "Gemma 4 31B" },
    { id: "mimo-v2.5", name: "MiMo V2.5" },
    { id: "hy3", name: "Hunyuan 3" },
  ],
};
