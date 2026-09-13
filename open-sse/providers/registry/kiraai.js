export default {
  id: "kiraai",
  priority: 265,
  alias: "kiraai",
  aliases: [
    "kira",
  ],
  uiAlias: "kira",
  display: {
    name: "KiraAI",
    icon: "psychology",
    color: "#EF4444",
    textIcon: "KR",
    website: "https://kiraai.vn",
    notice: {
      apiKeyUrl: "https://kiraai.vn",
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
      "max",
    ],
    defaultMode: "auto",
  },
  transport: {
    baseUrl: "https://kiraai.vn/api/v1/chat/completions",
    validateUrl: "https://kiraai.vn/api/v1/models",
    headers: {
      "User-Agent": "Cline/3.0.0",
    },
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://kiraai.vn/api/v1/chat/completions",
      headers: { "User-Agent": "Cline/3.0.0" },
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://kiraai.vn/api/v1/messages",
      headers: { "User-Agent": "Cline/3.0.0" },
      auth: { combined: true, header: "Authorization", scheme: "bearer", anthropicVersion: true },
    },
  ],
  models: [
    { id: "mimo-v2.5-free", name: "MiMo V2.5 (Free)" },
    { id: "qwen3.8-flash-free", name: "Qwen 3.8 Flash (Free)" },
    { id: "glm-5.3-free", name: "GLM 5.3 (Free)" },
    { id: "kira-3.5-pro", name: "Kira 3.5 Pro" },
    { id: "kira-3.5-flash", name: "Kira 3.5 Flash" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "glm-5.3", name: "GLM 5.3" },
    { id: "minimax-m3", name: "MiniMax M3" },
    { id: "grok-4.6", name: "Grok 4.6" },
    { id: "qwen3.8-max", name: "Qwen 3.8 Max" },
  ],
};
