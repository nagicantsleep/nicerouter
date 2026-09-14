export default {
  id: "orca",
  priority: 265,
  alias: "orca",
  aliases: [
    "orcarouter",
    "orca",
  ],
  uiAlias: "orca",
  display: {
    name: "OrcaRouter",
    icon: "waves",
    color: "#06B6D4",
    textIcon: "OR",
    website: "https://www.orcarouter.ai",
    notice: {
      apiKeyUrl: "https://www.orcarouter.ai",
    },
  },
  category: "apikey",
  features: {
    usage: true,
    usageApikey: true,
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
    baseUrl: "https://api.orcarouter.ai/v1/chat/completions",
    validateUrl: "https://api.orcarouter.ai/v1/models",
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.orcarouter.ai/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://api.orcarouter.ai/v1/messages",
      auth: { combined: true, header: "Authorization", scheme: "bearer", anthropicVersion: true },
    },
  ],
  models: [
    { id: "orcarouter/free", name: "OrcaRouter Free" },
    { id: "orcarouter/fusion", name: "OrcaRouter Fusion" },
    { id: "orcarouter/fusion-flash", name: "OrcaRouter Fusion Flash" },
    { id: "orcarouter/fusion-mini", name: "OrcaRouter Fusion Mini" },
    { id: "orcarouter/auto", name: "OrcaRouter Auto" },
    { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
    { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet" },
    { id: "openai/gpt-4o", name: "GPT-4o" },
    { id: "openai/gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "deepseek/deepseek-chat", name: "DeepSeek Chat" },
    { id: "deepseek/deepseek-r1", name: "DeepSeek R1" },
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  ],
};
