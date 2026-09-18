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
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "mimo-v2.5", name: "MiMo V2.5" },
    { id: "hy3", name: "Hunyuan 3" },
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "glm-5.2", name: "GLM 5.2" },
  ],
  features: {
    usage: true,
    usageApikey: true,
  },
};
