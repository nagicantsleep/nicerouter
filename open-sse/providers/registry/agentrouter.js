export default {
  id: "agentrouter",
  priority: 261,
  alias: "agentrouter",
  aliases: [
    "ar",
  ],
  uiAlias: "ar",
  display: {
    name: "AgentRouter",
    icon: "alt_route",
    color: "#10B981",
    textIcon: "AR",
    website: "https://agentrouter.org",
    notice: {
      apiKeyUrl: "https://agentrouter.org",
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
    baseUrl: "https://agentrouter.org/v1/chat/completions",
    validateUrl: "https://agentrouter.org/v1/models",
    headers: {
      "User-Agent": "Cline/3.0.0",
    },
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://agentrouter.org/v1/chat/completions",
      headers: { "User-Agent": "Cline/3.0.0" },
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://agentrouter.org/v1/messages",
      headers: { "User-Agent": "Cline/3.0.0" },
      auth: { combined: true, header: "Authorization", scheme: "bearer", anthropicVersion: true },
    },
  ],
  models: [
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "claude-opus-5", name: "Claude Opus 5" },
    { id: "glm-5.3", name: "GLM 5.3" },
    { id: "gpt-5.6-sol", name: "GPT 5.6 Sol" },
    { id: "gpt-6-astra", name: "GPT 6 Astra" },
  ],
};
