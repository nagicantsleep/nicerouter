export default {
  id: "wusrouter",
  priority: 271,
  alias: "wr",
  aliases: [
    "wr",
    "wusrouter",
    "wusrouter-com",
    "wusrouter.com",
  ],
  uiAlias: "wr",
  display: {
    name: "WusRouter",
    icon: "hub",
    color: "#6366F1",
    textIcon: "WR",
    website: "https://wusrouter.com",
    notice: {
      apiKeyUrl: "https://wusrouter.com",
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
    baseUrl: "https://api.wusrouter.com/v1/chat/completions",
    validateUrl: "https://api.wusrouter.com/v1/models",
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.wusrouter.com/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  models: [
    { id: "agnes-3.0-flash", name: "Agnes 3.0 Flash" },
    { id: "gpt-oss-20b", name: "GPT-OSS 20B" },
    { id: "ling-3.0-flash-fin", name: "Ling 3.0 Flash Fin" },
    { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor" },
    { id: "qwen3.8-27b", name: "Qwen 3.8 27B" },
  ],
  modelsFetcher: { url: "https://api.wusrouter.com/v1/models", type: "openai" },
  passthroughModels: true,
};
