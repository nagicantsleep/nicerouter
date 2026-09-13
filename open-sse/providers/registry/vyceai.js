export default {
  id: "vyceai",
  priority: 264,
  alias: "vyceai",
  aliases: [
    "vyce",
  ],
  uiAlias: "vyce",
  display: {
    name: "VyceAI",
    icon: "psychology",
    color: "#8B5CF6",
    textIcon: "VY",
    website: "https://vyceai.com",
    notice: {
      apiKeyUrl: "https://vyceai.com",
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
    baseUrl: "https://vyceai.com/v1/chat/completions",
    validateUrl: "https://vyceai.com/v1/models",
    headers: {
      "User-Agent": "Cline/3.0.0",
    },
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://vyceai.com/v1/chat/completions",
      headers: { "User-Agent": "Cline/3.0.0" },
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://vyceai.com/v1/messages",
      headers: { "User-Agent": "Cline/3.0.0" },
      auth: { combined: true, header: "Authorization", scheme: "bearer", anthropicVersion: true },
    },
    {
      format: "openai-responses",
      baseUrl: "https://vyceai.com/v1/responses",
      headers: { "User-Agent": "Cline/3.0.0" },
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  models: [
    { id: "gpt-5.6-new", name: "GPT 5.6 New" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-flash-lr", name: "DeepSeek V4 Flash LR" },
    { id: "nemotron-ultra-550b", name: "Nemotron Ultra 550B" },
    { id: "nemotron-vision", name: "Nemotron Vision" },
    { id: "grok-imagine-2", name: "Grok Imagine 2" },
  ],
};
