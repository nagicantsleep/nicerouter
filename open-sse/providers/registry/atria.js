export default {
  id: "atria",
  priority: 267,
  alias: "atria",
  aliases: [
    "atria-asi",
    "atria",
  ],
  uiAlias: "atria",
  display: {
    name: "Atria ASI",
    icon: "sparkles",
    color: "#10B981",
    textIcon: "ATRIA",
    website: "https://atria-asi.ai",
    notice: {
      apiKeyUrl: "https://atria-asi.ai",
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
    baseUrl: "https://api.atria-asi.ai/v1/chat/completions",
    validateUrl: "https://api.atria-asi.ai/v1/models",
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.atria-asi.ai/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  models: [
    { id: "Atria-Dawn-Preview", name: "Atria Dawn Preview", isFree: true },
  ],
  modelsFetcher: { url: "https://api.atria-asi.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
